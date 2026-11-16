/*
 * Lê os leads do WOODS (só leitura) e transforma no formato das tabelas do Woods Web.
 * Sem Electron nem rede: dá para testar com `npm test`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SLUG_OK, lerFicha } from '../public/util.js';

export const PRINTS = ['a-390', 'b-390', 'a-1440', 'b-1440'];
const texto = (v, max) => (String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max) || null);

/** Instagram da ficha ("- Instagram: https://www.instagram.com/x/ (@x, 508 seguidores)" ou "@x") → URL do perfil, ou null */
export function instagram(md) {
  const v = (md.match(/^- Instagram:[ \t]*(.*)$/m) || [])[1]?.trim() || '';
  const u = v.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i)?.[1] || v.match(/^@?([A-Za-z0-9._]{1,30})$/)?.[1];
  return u ? `https://www.instagram.com/${u}/` : null;
}

const nicho = (md) => (md.startsWith('---') ? (md.split('---')[1].match(/^nicho:[ \t]*(.*)$/m) || [])[1]?.trim() : '') || '';

/** Endereço do WOODS no GitHub, lido do .git/config (sem rodar git). null se não for GitHub */
export function repositorio(woods) {
  try {
    const cfg = fs.readFileSync(path.join(woods, '.git', 'config'), 'utf8');
    const url = cfg.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1] || '';
    const m = url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (!m) return null;
    const ramo = fs.readFileSync(path.join(woods, '.git', 'HEAD'), 'utf8').match(/^ref: refs\/heads\/(\S+)/)?.[1] || 'main';
    return { base: `https://github.com/${m[1]}/${m[2]}`, ramo };
  } catch {
    return null;
  }
}

/**
 * Datas pelo git. Ficha ou print igual ao último commit usa a data desse commit, e não a do arquivo:
 * um clone novo ou um pull trocam a data do arquivo sem mudar o conteúdo, e aí um PC com o WOODS atrasado
 * pareceria ter a versão mais nova. Arquivo com mudança local (ou fora do git) usa a data do arquivo.
 * A criação é o primeiro commit da ficha (no lugar da data do arquivo, que reinicia num clone novo).
 *
 * git(args) → stdout (roda dentro do WOODS). Devolve ler() → quando(rel, st) → { atualizado, criado } em ms.
 * O histórico só é relido quando o HEAD muda.
 */
export function criarDatasGit(git) {
  let cache = { head: '', ultima: new Map(), primeira: new Map() };
  const ALVOS = ['vault/20-leads/*.md', 'sites/*/prints/*.jpg'];
  return function ler() {
    const head = git(['rev-parse', 'HEAD']).trim();
    if (head !== cache.head) {
      const ultima = new Map();
      const primeira = new Map();
      let data = 0;
      const log = git(['-c', 'core.quotepath=off', 'log', '--format=%x00%cI', '--name-only', '--no-renames', '--', ...ALVOS]);
      for (const linha of log.split('\n')) {
        if (linha.startsWith('\0')) { data = Date.parse(linha.slice(1).trim()) || 0; continue; }
        const f = linha.trim();
        if (!f || !data) continue;
        if (!ultima.has(f)) ultima.set(f, data); // o log vem do mais novo para o mais velho
        primeira.set(f, data);
      }
      cache = { head, ultima, primeira };
    }
    const status = git(['-c', 'core.quotepath=off', 'status', '--porcelain', '-z', '--untracked-files=all', '--', 'vault/20-leads', 'sites/*/prints']);
    const sujos = new Set(status.split('\0').filter(Boolean).map((e) => e.slice(3)));
    const { ultima, primeira } = cache;
    return (rel, st) => {
      const mtime = Math.round(st.mtimeMs);
      return {
        atualizado: sujos.has(rel) || !ultima.has(rel) ? mtime : ultima.get(rel),
        criado: primeira.get(rel) ?? Math.round(st.birthtimeMs || st.mtimeMs),
      };
    };
  };
}

/** Sem git: a data do arquivo */
const pelaData = (_rel, st) => ({ atualizado: Math.round(st.mtimeMs), criado: Math.round(st.birthtimeMs || st.mtimeMs) });

/** Um lead do WOODS como ele está no disco agora. quando: veja criarDatasGit */
export function lerProjeto(woods, slug, repo = repositorio(woods), quando = pelaData) {
  const ficha = path.join(woods, 'vault', '20-leads', `${slug}.md`);
  const md = fs.readFileSync(ficha, 'utf8');
  const datas = quando(`vault/20-leads/${slug}.md`, fs.statSync(ficha));
  const f = lerFicha(md);
  const pasta = path.join(woods, 'sites', slug);
  const tem = (...p) => fs.existsSync(path.join(pasta, ...p));
  const print = (n) => {
    const st = fs.statSync(path.join(pasta, 'prints', `${n}.jpg`), { throwIfNoEntry: false });
    return st ? quando(`sites/${slug}/prints/${n}.jpg`, st).atualizado : 0;
  };
  return {
    slug,
    nome: texto(f.nome, 300) || slug,
    instagram: instagram(md),
    cidade: texto(f.cidade, 200),
    responsavel: texto(f.responsavel, 100),
    nicho: texto(nicho(md), 100),
    status: texto(f.status, 60),
    variante_a_pronta: tem('dist', 'a', 'index.html'),
    variante_b_pronta: tem('dist', 'b', 'index.html'),
    url_a: f.links.a || null,
    url_b: f.links.b || null,
    repositorio_url: repo && fs.existsSync(pasta) ? `${repo.base}/tree/${repo.ramo}/sites/${slug}` : null,
    criado_local_em: new Date(datas.criado).toISOString(),
    atualizado_local_em: new Date(datas.atualizado).toISOString(),
    prints: Object.fromEntries(PRINTS.map((n) => [n, print(n)]).filter(([, v]) => v)),
  };
}

/** Todos os leads do WOODS (fichas válidas em vault/20-leads, sem os modelos _*.md) */
export function lerProjetos(woods, quando = pelaData) {
  const dir = path.join(woods, 'vault', '20-leads');
  if (!fs.existsSync(dir)) return [];
  const repo = repositorio(woods);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && SLUG_OK.test(f.slice(0, -3)))
    .map((f) => lerProjeto(woods, f.slice(0, -3), repo, quando));
}

/** Linha da tabela projetos (sem o owner_id, que entra na hora de enviar) */
export function paraLinha(p, erro = null) {
  const { prints, ...linha } = p;
  return { ...linha, removido_em: null, erro_sincronia: erro ? String(erro).slice(0, 500) : null };
}

/** uuid estável a partir de um texto: o mesmo evento gera sempre o mesmo id (reenvio não duplica) */
export function idEstavel(chave) {
  const h = crypto.createHash('sha256').update(chave).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const PUBLICADOS = ['publicado', 'ligado', 'fechado'];

/**
 * Eventos entre a foto anterior de um projeto e a de agora.
 * `antes` vazio: projeto novo ('criado', ou 'importado' na primeira sincronização de tudo).
 */
export function eventos(antes, depois, { primeira = false, agora = new Date().toISOString() } = {}) {
  const s = depois.slug;
  const ev = (tipo, detalhe, chave, em = agora) => ({ id: idEstavel(`${s}:${tipo}:${chave}`), projeto_slug: s, tipo, detalhe, ocorrido_em: em });
  if (!antes) {
    return [primeira
      ? ev('importado', { status: depois.status }, 'importado', depois.atualizado_local_em)
      : ev('criado', { status: depois.status }, 'criado', depois.criado_local_em)];
  }
  const lista = [];
  const quando = depois.atualizado_local_em;
  if (antes.status !== depois.status) {
    lista.push(ev('status', { de: antes.status, para: depois.status }, `${antes.status}>${depois.status}@${quando}`, quando));
  }
  for (const v of ['a', 'b']) {
    if (!antes[`variante_${v}_pronta`] && depois[`variante_${v}_pronta`]) lista.push(ev(`variante_${v}_pronta`, {}, quando));
  }
  if (Object.keys(antes.prints || {}).length < PRINTS.length && Object.keys(depois.prints || {}).length === PRINTS.length) {
    lista.push(ev('previas_prontas', {}, quando));
  }
  const pub = (p) => PUBLICADOS.includes(p.status) || Boolean(p.url_a || p.url_b);
  if (!pub(antes) && pub(depois)) lista.push(ev('publicado', { url_a: depois.url_a, url_b: depois.url_b }, quando, quando));
  return lista;
}

/** Evento ao vivo da conversa (linha JSON que o painel manda à janela) → evento do histórico, ou null. Nada do conteúdo vai junto */
export function eventoDaConversa(slug, linha, rodandoAntes) {
  if (!SLUG_OK.test(slug || '')) return null;
  let e;
  try { e = JSON.parse(linha); } catch { return null; }
  const em = new Date(Number(e.em) || Date.now()).toISOString();
  const ev = (tipo) => ({ id: idEstavel(`${slug}:${tipo}:${em}`), projeto_slug: slug, tipo, detalhe: {}, ocorrido_em: em });
  if (e.t === 'estado' && e.rodando && !rodandoAntes) return ev('trabalho_iniciado');
  if (e.t === 'fim') return ev(e.ok ? 'trabalho_concluido' : 'trabalho_com_erro');
  return null;
}
