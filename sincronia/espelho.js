/*
 * Espelho do WOODS entre computadores (PC de casa, notebooks). Sem Electron: dá para testar com `npm test`.
 *
 * Cada computador tira uma "foto" da pasta do WOODS (tudo o que o .gitignore não exclui, inclusive o que ainda não
 * tem commit) e manda essa foto ao GitHub numa referência própria, refs/painel/espelho, que NÃO é um branch:
 * o Cloudflare não publica nada a partir dela e o `main` não muda. O main só muda quando o Claude faz o push do lead
 * aprovado, como antes. Assim os três computadores funcionam como se fossem um só.
 *
 * Foto = commit cuja árvore é a pasta inteira e cujo 1º pai é o HEAD daquele computador (os commits locais vão junto).
 * O 2º pai é a foto anterior, então a referência só anda para frente (push sem --force: quem chegar atrasado é recusado
 * e tenta de novo na próxima rodada, nunca apaga o trabalho de outro).
 *
 * Rodada:
 *   nada mudou em lugar nenhum      → nada
 *   só este PC mudou                → manda a foto nova
 *   só a nuvem mudou                → traz a pasta para igual à nuvem (e o HEAD, se lá tiver commits novos)
 *   os dois mudaram                 → junta (merge de 3 vias, sem mexer na pasta antes de dar certo) e manda o resultado
 *   o mesmo arquivo mudou nos dois  → CONFLITO: nada é alterado; o painel pergunta qual versão fica (a outra fica guardada)
 *
 * Fica de fora: o que o .gitignore exclui (node_modules, dist, .env, .wrangler) e o .claude/settings.local.json
 * (as permissões "Sempre", que vão juntas pelas preferências e se somam em vez de uma apagar a outra).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gravarJson, lerJson } from './fila.js';
import { SLUG_OK } from '../public/util.js';

export const REF = 'refs/painel/espelho';
export const REF_RAMO = 'refs/heads/painel-espelho'; // reserva, se o GitHub recusar referências fora de refs/heads
const LOCAL_REMOTO = 'refs/painel/remoto';
const FORA = ':(exclude).claude/settings.local.json';
// Os commits da foto nunca vão para o main; a assinatura deles é fixa para não depender da configuração
const ASSINATURA = {
  GIT_AUTHOR_NAME: 'Painel Woods', GIT_AUTHOR_EMAIL: 'painel@woods.local',
  GIT_COMMITTER_NAME: 'Painel Woods', GIT_COMMITTER_EMAIL: 'painel@woods.local',
};

export class ErroEspelho extends Error {
  constructor(msg, { tipo = 'outro' } = {}) {
    super(msg);
    this.tipo = tipo; // 'rede' (tenta de novo sozinho), 'login' (precisa entrar no GitHub), 'outro'
  }
}

/** Roda o git e devolve { codigo, saida, erro } sem lançar. env: objeto ou função (lida a cada chamada) */
export function executorGit({ exe = 'git', env = process.env, acompanhar = (p) => p } = {}) {
  return (args, { cwd, env: extra = {} } = {}) => new Promise((ok) => {
    const base = typeof env === 'function' ? env() : env;
    let p;
    try {
      p = acompanhar(spawn(exe, ['-c', 'core.quotepath=false', '-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=30', ...args], { cwd, env: { ...base, ...extra }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      ok({ codigo: -1, saida: '', erro: e.message });
      return;
    }
    let saida = '';
    let erro = '';
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { erro += d; });
    p.on('error', (e) => ok({ codigo: -1, saida, erro: e.message }));
    p.on('close', (codigo) => ok({ codigo, saida, erro }));
  });
}

/** Traduz a saída do git num erro que o painel sabe mostrar */
export function classificar(texto) {
  const t = String(texto || '');
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission to .* denied|Repository not found|returned error: 40[13]|Invalid username or (password|token)/i.test(t)) {
    return new ErroEspelho('O GitHub recusou o acesso ao WOODS. Entre no GitHub de novo nas Configurações (passo 2).', { tipo: 'login' });
  }
  if (/Could not resolve host|unable to access|Failed to connect|timed out|Connection (reset|refused|timed out)|early EOF|unexpected disconnect|remote end hung up|Operation timed out|SSL|schannel/i.test(t)) {
    return new ErroEspelho('Sem conexão com o GitHub. O espelho tenta de novo sozinho.', { tipo: 'rede' });
  }
  return new ErroEspelho(t.trim().split('\n').slice(-3).join(' ').slice(0, 300) || 'O git falhou');
}

/** Leads tocados por uma lista de arquivos (sites/<slug>/… e vault/20-leads/<slug>.md) */
export function leadsDe(arquivos) {
  const slugs = new Set();
  for (const f of arquivos) {
    const m = f.match(/^sites\/([^/]+)\//) || f.match(/^vault\/20-leads\/([^/]+)\.md$/);
    if (m && SLUG_OK.test(m[1])) slugs.add(m[1]);
  }
  return [...slugs];
}

/**
 * woods: pasta do repositório; dados: pasta do app (espelho.json); git: executorGit(...);
 * maquina: nome do computador (vai na mensagem da foto); registrar: log
 */
export function criarEspelho({ woods, dados, git, maquina = '', registrar = () => {}, agora = () => Date.now() }) {
  const ARQ = path.join(dados, 'espelho.json');
  const est = lerJson(ARQ, { base: '', usaRamo: false, conflito: null, ultimaSincronia: null, ultimoErro: '' });
  let emDia = false;
  let rodando = null;
  const salvar = () => gravarJson(ARQ, est);
  const iso = () => new Date(agora()).toISOString();
  const ref = () => (est.usaRamo ? REF_RAMO : REF);

  // ---------- git ----------
  async function g(args, o = {}) {
    const r = await git(args, { cwd: woods, ...o });
    if (r.codigo !== 0) throw classificar(`${r.erro}\n${r.saida}`);
    return r.saida.trim();
  }
  const sim = async (args) => (await git(args, { cwd: woods })).codigo === 0;
  const existe = (sha) => sim(['cat-file', '-e', `${sha}^{commit}`]);
  const ancestral = (a, b) => sim(['merge-base', '--is-ancestor', a, b]);
  const arvore = (c) => g(['rev-parse', `${c}^{tree}`]);
  const pai = (c) => g(['rev-parse', `${c}^1`]);

  let indice = '';
  async function idx() {
    if (!indice) indice = path.resolve(woods, await g(['rev-parse', '--git-path', 'painel-espelho.index']));
    return indice;
  }
  const comIdx = async () => ({ env: { GIT_INDEX_FILE: await idx() } });

  /** Árvore da pasta como ela está agora, num índice à parte (o índice do git do WOODS não é tocado) */
  async function arvoreLocal() {
    const tmp = await idx();
    const real = path.resolve(woods, await g(['rev-parse', '--git-path', 'index']));
    if (fs.existsSync(real)) fs.copyFileSync(real, tmp); else fs.rmSync(tmp, { force: true });
    const o = await comIdx();
    await g(['add', '-A', '--', '.', FORA], o);
    return g(['write-tree'], o);
  }

  const foto = (t, pais, msg) => g(['commit-tree', t, ...pais.flatMap((p) => ['-p', p]), '-m', msg], { env: ASSINATURA });

  async function ramoAtual() {
    const r = await git(['symbolic-ref', '-q', 'HEAD'], { cwd: woods });
    return r.codigo === 0 ? r.saida.trim() : '';
  }

  /** Move o HEAD (o branch atual) sem mexer na pasta. velho: confere o valor anterior (não atropela um commit novo) */
  async function moverHead(novo, velho) {
    if (novo === velho) return;
    const ramo = await ramoAtual();
    await g(ramo ? ['update-ref', ramo, novo, ...(velho ? [velho] : [])] : ['update-ref', '--no-deref', 'HEAD', novo, ...(velho ? [velho] : [])]);
  }

  /** Leva a pasta da árvore `de` (= pasta de agora) para `para`. Devolve os arquivos que mudaram */
  async function aplicar(de, para) {
    if (de === para) return [];
    const mudados = (await g(['diff-tree', '-r', '--name-only', '--no-commit-id', de, para])).split('\n').filter(Boolean);
    await g(['read-tree', '-m', '-u', de, para], await comIdx());
    return mudados;
  }

  async function lerRemoto() {
    const linha = await g(['ls-remote', 'origin', ref()], { env: { GCM_INTERACTIVE: 'never' } });
    return linha.split(/\s+/)[0] || '';
  }

  async function buscar(r) {
    if (await existe(r)) return;
    await g(['fetch', '--no-tags', '--quiet', 'origin', `+${ref()}:${LOCAL_REMOTO}`], { env: { GCM_INTERACTIVE: 'never' } });
  }

  /** Manda a foto. false = alguém mandou outra antes (tenta de novo na próxima rodada) */
  async function enviar(sha) {
    const r = await git(['push', '--porcelain', 'origin', `${sha}:${ref()}`], { cwd: woods, env: { GCM_INTERACTIVE: 'never' } });
    if (r.codigo === 0) return true;
    const texto = `${r.saida}\n${r.erro}`;
    if (/non-fast-forward|fetch first|\[rejected\]|stale info/i.test(texto)) return false;
    if (/\[remote rejected\]/.test(texto) && !est.usaRamo) {
      // O GitHub não aceitou refs/painel/*: passa a usar um branch próprio (veja docs/sincronia.md, Cloudflare)
      registrar(`espelho: ${REF} recusada (${texto.trim().slice(0, 200)}); usando ${REF_RAMO}`);
      est.usaRamo = true;
      est.base = '';
      salvar();
      const err = new ErroEspelho('Trocando a referência do espelho.', { tipo: 'rede' });
      err.repetir = true;
      throw err;
    }
    throw classificar(texto);
  }

  async function publicar(t, pais) {
    const sha = await foto(t, pais, `painel: ${maquina || 'computador'} ${iso()}`);
    if (!(await enviar(sha))) return false;
    est.base = sha;
    return true;
  }

  function conflito(c) {
    est.conflito = { ...c, em: iso() };
    emDia = false;
    salvar();
    return { mudados: [], conflito: est.conflito };
  }

  // ---------- Rodada ----------
  async function rodada() {
    const R = await lerRemoto();
    if (R) await buscar(R);
    const B = est.base && (await existe(est.base)) ? est.base : '';
    const H = await g(['rev-parse', 'HEAD']);
    const TL = await arvoreLocal();
    const TB = B ? await arvore(B) : '';
    const HB = B ? await pai(B) : '';
    const localMudou = !B || TL !== TB || H !== HB;

    if (!R || R === B) {
      if (localMudou || !R) await publicar(TL, B ? [H, B] : [H]);
      est.conflito = null;
      return { mudados: [] };
    }

    // A nuvem tem algo novo
    const TR = await arvore(R);
    const HR = await pai(R);
    const c = est.conflito;
    if (c && c.remoto === R && c.arvore === TL && c.head === H) return { mudados: [], conflito: c }; // nada novo: continua

    if (!localMudou && (await ancestral(H, R))) {
      const mudados = await aplicar(TL, TR);
      await moverHead(HR, H);
      if (mudados.length || HR !== H) await g(['reset', '-q']);
      est.base = R;
      est.conflito = null;
      return { mudados };
    }

    // Os dois mudaram: junta
    let base = B && (await ancestral(B, R)) ? B : '';
    if (!base) {
      const mb = await git(['merge-base', H, HR], { cwd: woods });
      base = mb.codigo === 0 ? mb.saida.trim() : '';
    }
    const dados = { remoto: R, arvore: TL, head: H };
    if (!base) return conflito({ ...dados, motivo: 'As duas pastas do WOODS não têm nada em comum.', arquivos: [] });
    let NH;
    if (H === HR || (await ancestral(H, R))) NH = HR;
    else if (await ancestral(HR, H)) NH = H;
    else return conflito({ ...dados, motivo: 'Há commits diferentes neste computador e em outro.', arquivos: [] });

    const CL = await foto(TL, [H], 'painel: pasta local (temporário)');
    const m = await git(['merge-tree', '--write-tree', '--name-only', '--no-messages', `--merge-base=${base}`, CL, R], { cwd: woods });
    if (m.codigo === 1) {
      const arquivos = [...new Set(m.saida.split('\n').slice(1).map((l) => l.trim()).filter(Boolean))];
      return conflito({ ...dados, motivo: 'O mesmo arquivo mudou aqui e em outro computador.', arquivos });
    }
    if (m.codigo !== 0) throw classificar(`${m.erro}\n${m.saida}`);
    const TM = m.saida.split('\n')[0].trim();
    const mudados = await aplicar(TL, TM);
    await moverHead(NH, H);
    if (mudados.length || NH !== H) await g(['reset', '-q']);
    est.base = R; // o que a nuvem tinha já está aqui; se o envio abaixo perder a corrida, junta de novo na próxima
    est.conflito = null;
    if (TM !== TR || NH !== HR) await publicar(TM, [NH, R]);
    return { mudados };
  }

  function resultado(r) {
    const mudados = r.mudados || [];
    return {
      mudados,
      leads: leadsDe(mudados),
      pacotes: mudados.some((f) => /^package(-lock)?\.json$/.test(f)),
      conflito: r.conflito || null,
    };
  }

  /** Uma rodada. Lança ErroEspelho (rede, login, outro); conflito volta no resultado */
  function sincronizar() {
    if (rodando) return rodando;
    rodando = (async () => {
      try {
        if (!fs.existsSync(path.join(woods, '.git'))) { emDia = true; return resultado({}); }
        let r;
        try {
          r = await rodada();
        } catch (e) {
          if (!e.repetir) throw e;
          r = await rodada();
        }
        if (!r.conflito) { emDia = true; est.ultimaSincronia = iso(); est.ultimoErro = ''; }
        salvar();
        return resultado(r);
      } catch (e) {
        emDia = false;
        est.ultimoErro = e.message;
        salvar();
        throw e instanceof ErroEspelho ? e : classificar(e.message);
      } finally {
        rodando = null;
      }
    })();
    return rodando;
  }

  /**
   * Resolve um conflito. 'local': a versão deste computador vale para todos. 'nuvem': fica a da nuvem e a deste
   * computador é guardada em refs/painel/backup/<data> (dá para recuperar com o git). Nada se perde nos dois casos:
   * a foto vencedora tem a outra no histórico.
   */
  async function resolver(lado) {
    if (rodando) await rodando.catch(() => {});
    if (!est.conflito) return situacao();
    if (!['local', 'nuvem'].includes(lado)) throw new ErroEspelho('Escolha local ou nuvem');
    const R = await lerRemoto();
    if (!R) { est.conflito = null; salvar(); await sincronizar(); return situacao(); }
    await buscar(R);
    const H = await g(['rev-parse', 'HEAD']);
    const TL = await arvoreLocal();
    if (lado === 'local') {
      if (!(await publicar(TL, [H, R]))) throw new ErroEspelho('Outro computador mandou uma versão nova agora. Tente de novo.', { tipo: 'rede' });
    } else {
      const guardada = await foto(TL, [H], `painel: guardado antes de ficar com a versão da nuvem (${maquina})`);
      const nome = `refs/painel/backup/${iso().replace(/[:.]/g, '-')}`;
      await g(['update-ref', nome, guardada]);
      registrar(`espelho: versão local guardada em ${nome} (${guardada})`);
      await aplicar(TL, await arvore(R));
      await moverHead(await pai(R), '');
      await g(['reset', '-q']);
      est.base = R;
    }
    est.conflito = null;
    est.ultimaSincronia = iso();
    est.ultimoErro = '';
    emDia = true;
    salvar();
    return situacao();
  }

  function situacao() {
    return {
      emDia, sincronizando: Boolean(rodando), ultimaSincronia: est.ultimaSincronia, ultimoErro: est.ultimoErro,
      conflito: est.conflito ? { motivo: est.conflito.motivo, arquivos: est.conflito.arquivos, em: est.conflito.em } : null,
      referencia: ref(),
    };
  }

  return { sincronizar, resolver, situacao, emDia: () => emDia };
}
