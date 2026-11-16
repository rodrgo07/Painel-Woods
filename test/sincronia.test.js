// Sincronização com o Woods Web: mapeamento do WOODS, fila offline, idempotência e erros. Supabase falso, sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lerProjeto, lerProjetos, paraLinha, eventos, eventoDaConversa, instagram, repositorio, idEstavel, criarDatasGit } from '../sincronia/mapa.js';
import { Fila, espera, ESPERA_MIN, ESPERA_MAX, MAX_TENTATIVAS, lerJson } from '../sincronia/fila.js';
import { conferirConfig } from '../sincronia/supabase.js';
import { criarServico } from '../sincronia/servico.js';
import { limpar } from '../nucleo.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nuvem-teste-'));
const escrever = (base, arq, conteudo = 'x') => {
  fs.mkdirSync(path.dirname(path.join(base, arq)), { recursive: true });
  fs.writeFileSync(path.join(base, arq), conteudo);
};
const ficha = ({ status = 'pesquisa', cidade = 'Cotia', ig = 'https://www.instagram.com/limapetsalon/ (@limapetsalon, 508 seguidores)', linkA = '' } = {}) => `---
status: ${status}
responsavel: R Host
nicho: petshop
cidade: ${cidade}
---
# Lima Pet Salon
- Slug: lima-pet-salon
- Instagram: ${ig}
- WhatsApp: (11) 99999-0000

## Entrega
- Link variante A: ${linkA}
- Link variante B:
`;

/** WOODS de mentira: um lead completo, um modelo e um arquivo com nome inválido */
function woodsFalso() {
  const w = tmp();
  escrever(w, 'vault/20-leads/lima-pet-salon.md', ficha());
  escrever(w, 'vault/20-leads/_modelo-lead.md', ficha());
  escrever(w, 'vault/20-leads/Nome Errado.md', ficha());
  escrever(w, 'sites/lima-pet-salon/dist/a/index.html');
  escrever(w, '.git/config', '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://github.com/rodrgo07/WOODS\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
  escrever(w, '.git/HEAD', 'ref: refs/heads/main\n');
  return w;
}
const prints = (w, ...nomes) => nomes.forEach((n) => escrever(w, `sites/lima-pet-salon/prints/${n}.jpg`, `jpg-${n}`));
const ANON = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.assinatura`;
const SERVICE = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.assinatura`;

// ---------- Mapeamento ----------
test('lerProjeto: campos reais da ficha, variantes, prints e repositório', () => {
  const w = woodsFalso();
  prints(w, 'a-390', 'a-1440');
  const p = lerProjeto(w, 'lima-pet-salon');
  assert.equal(p.nome, 'Lima Pet Salon');
  assert.equal(p.status, 'pesquisa');
  assert.equal(p.cidade, 'Cotia');
  assert.equal(p.responsavel, 'R Host');
  assert.equal(p.nicho, 'petshop');
  assert.equal(p.instagram, 'https://www.instagram.com/limapetsalon/');
  assert.equal(p.variante_a_pronta, true);
  assert.equal(p.variante_b_pronta, false);
  assert.equal(p.url_a, null, 'link vazio não vira URL');
  assert.equal(p.repositorio_url, 'https://github.com/rodrgo07/WOODS/tree/main/sites/lima-pet-salon');
  assert.deepEqual(Object.keys(p.prints).sort(), ['a-1440', 'a-390']);
  assert.ok(!Number.isNaN(Date.parse(p.criado_local_em)) && !Number.isNaN(Date.parse(p.atualizado_local_em)));
  assert.equal(paraLinha(p).prints, undefined, 'prints não vão na linha do projeto');
  assert.equal(paraLinha(p, 'falhou').erro_sincronia, 'falhou');

  assert.deepEqual(lerProjetos(w).map((x) => x.slug), ['lima-pet-salon'], 'sem _modelo e sem nome inválido');
  assert.deepEqual(lerProjetos(tmp()), [], 'WOODS ainda não baixado');
});

test('instagram e repositório: só o que dá para afirmar', () => {
  assert.equal(instagram('- Instagram: @fiots.estetica'), 'https://www.instagram.com/fiots.estetica/');
  assert.equal(instagram('- Instagram: fiots'), 'https://www.instagram.com/fiots/');
  assert.equal(instagram('- Instagram:\n- WhatsApp: 1'), null);
  assert.equal(instagram('- Instagram: não achei o perfil'), null);
  const w = tmp();
  escrever(w, '.git/config', '[remote "origin"]\n\turl = git@gitlab.com:x/y.git\n');
  assert.equal(repositorio(w), null, 'não é GitHub: sem link');
  assert.equal(repositorio(tmp()), null, 'sem .git');
  escrever(w, '.git/config', '[remote "origin"]\n\turl = git@github.com:rodrgo07/WOODS.git\n');
  escrever(w, '.git/HEAD', 'ref: refs/heads/dev\n');
  assert.deepEqual(repositorio(w), { base: 'https://github.com/rodrgo07/WOODS', ramo: 'dev' });
});

test('eventos: importado, criado, status, variantes, prévias e publicação', () => {
  const base = { slug: 's', status: 'pesquisa', variante_a_pronta: false, variante_b_pronta: false, url_a: null, url_b: null, prints: {}, criado_local_em: '2026-11-09T00:00:00.000Z', atualizado_local_em: '2026-11-09T00:00:00.000Z' };
  assert.deepEqual(eventos(undefined, base, { primeira: true }).map((e) => e.tipo), ['importado']);
  assert.deepEqual(eventos(undefined, base).map((e) => e.tipo), ['criado']);
  assert.deepEqual(eventos(base, base), [], 'nada mudou: nenhum evento');
  const pronto = { ...base, status: 'site pronto', variante_a_pronta: true, variante_b_pronta: true, atualizado_local_em: '2026-11-10T00:00:00.000Z',
    prints: { 'a-390': 1, 'b-390': 1, 'a-1440': 1, 'b-1440': 1 } };
  const ev = eventos(base, pronto);
  assert.deepEqual(ev.map((e) => e.tipo), ['status', 'variante_a_pronta', 'variante_b_pronta', 'previas_prontas']);
  assert.deepEqual(ev[0].detalhe, { de: 'pesquisa', para: 'site pronto' });
  assert.deepEqual(eventos(base, pronto).map((e) => e.id), ev.map((e) => e.id), 'mesmo evento, mesmo id');
  const pub = eventos(pronto, { ...pronto, status: 'publicado', url_a: 'https://s-a.pages.dev/' });
  assert.deepEqual(pub.map((e) => e.tipo), ['status', 'publicado']);
  assert.equal(pub[1].detalhe.url_a, 'https://s-a.pages.dev/');
  assert.match(idEstavel('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('eventos da conversa: só início e fim, nada do conteúdo', () => {
  const em = Date.UTC(2026, 10, 15);
  assert.equal(eventoDaConversa('s', JSON.stringify({ t: 'estado', rodando: true, em }), false).tipo, 'trabalho_iniciado');
  assert.equal(eventoDaConversa('s', JSON.stringify({ t: 'estado', rodando: true, em }), true), null, 'já estava rodando');
  const fim = eventoDaConversa('s', JSON.stringify({ t: 'fim', ok: false, erro: 'segredo da conversa', custo: 2, em }), true);
  assert.equal(fim.tipo, 'trabalho_com_erro');
  assert.deepEqual(fim.detalhe, {});
  assert.equal(eventoDaConversa('s', JSON.stringify({ t: 'claude', texto: 'oi', em })), null);
  assert.equal(eventoDaConversa('../x', JSON.stringify({ t: 'fim', ok: true })), null);
  assert.equal(eventoDaConversa('s', '{quebrado'), null);
});

// ---------- Fila ----------
test('fila: mesma chave substitui, espera dobra até o teto, erro permanente desiste', () => {
  const f = new Fila();
  f.adicionar({ chave: 'projeto:a', dados: 1 }, 0);
  f.adicionar({ chave: 'evento:1', dados: 2 }, 0);
  f.adicionar({ chave: 'projeto:a', dados: 3 }, 0);
  assert.deepEqual(f.itens.map((o) => [o.chave, o.dados]), [['projeto:a', 3], ['evento:1', 2]], 'só a versão nova, na mesma vez');

  assert.equal(espera(1, () => 0), ESPERA_MIN);
  assert.equal(espera(2, () => 0), ESPERA_MIN * 2);
  assert.equal(espera(50, () => 0), ESPERA_MAX);
  assert.ok(espera(1, () => 1) <= ESPERA_MIN * 1.2);

  assert.equal(f.falhar('evento:1', 'sem rede', { agora: 0, sorte: () => 0 }), false);
  assert.deepEqual(f.prontas(0).map((o) => o.chave), ['projeto:a'], 'a que falhou espera');
  assert.equal(f.prontas(ESPERA_MIN).length, 2);
  for (let i = 0; i < 100; i++) f.falhar('evento:1', 'sem rede', { agora: 0 }); // temporário: nunca desiste
  assert.equal(f.tamanho, 2);
  f.liberar(0);
  assert.equal(f.prontas(0).length, 2, 'liberar tenta já');

  let desistiu = false;
  for (let i = 0; i < MAX_TENTATIVAS; i++) desistiu = f.falhar('projeto:a', 'recusado', { permanente: true, agora: 0 });
  assert.equal(desistiu, true);
  assert.deepEqual(f.itens.map((o) => o.chave), ['evento:1']);
  assert.deepEqual(JSON.parse(JSON.stringify(new Fila(JSON.parse(JSON.stringify(f))))), JSON.parse(JSON.stringify(f)), 'volta igual do disco');
});

test('conferirConfig: só a chave pública e URL https', () => {
  assert.deepEqual(conferirConfig({ url: ' https://abc.supabase.co/ ', anonKey: ANON }), { url: 'https://abc.supabase.co', anonKey: ANON });
  assert.ok(conferirConfig({ url: 'http://127.0.0.1:54321', anonKey: 'sb_publishable_abcdefghijkl' }));
  assert.throws(() => conferirConfig({ url: 'https://abc.supabase.co', anonKey: SERVICE }), /service_role/);
  assert.throws(() => conferirConfig({ url: 'https://abc.supabase.co', anonKey: 'sb_secret_abcdefghijkl' }), /secreta/);
  assert.throws(() => conferirConfig({ url: 'http://abc.supabase.co', anonKey: ANON }), /https/);
  assert.throws(() => conferirConfig({ url: 'https://abc.supabase.co/rest/v1', anonKey: ANON }), /sem caminho/);
  assert.throws(() => conferirConfig({ url: 'abc', anonKey: ANON }), /inválida/);
  assert.throws(() => conferirConfig({ url: 'https://abc.supabase.co', anonKey: 'qualquer' }), /inválida/);
  assert.equal(limpar('erro sb_secret_abcdefghijklmn'), 'erro [segredo]');
});

// ---------- Serviço com um Supabase falso ----------
const UID = '11111111-1111-4111-8111-111111111111';
const SOCIO = '22222222-2222-4222-8222-222222222222';
const EQ = '99999999-9999-4999-8999-999999999999';
const CONTAS = { 'eu@woods.com': UID, 'socio@woods.com': SOCIO };
/**
 * Supabase de mentira com o que a migration garante: chaves por equipe, RLS (só a própria equipe e só em nome próprio)
 * e a trava que ignora a versão mais velha de projetos e prévias.
 */
function supabaseFalso() {
  const s = { tabelas: { projetos: new Map(), eventos: new Map(), previas: new Map(), dispositivos: new Map(), andamento: new Map() }, arquivos: new Map(), pedidos: [],
    membros: [{ equipe_id: EQ, usuario_id: UID, nome: 'R Host' }, { equipe_id: EQ, usuario_id: SOCIO, nome: 'L Host' }],
    offline: false, falha500: false, renovacoes: 0, tokens: new Map(), renovacoes_validas: new Map(), recusarProjeto: false };
  const CHAVES = { projetos: ['equipe_id', 'slug'], previas: ['equipe_id', 'projeto_slug', 'nome'], eventos: ['id'], dispositivos: ['id'], andamento: ['equipe_id', 'projeto_slug'] };
  const filtrar = (linhas, params) => linhas.filter((l) => [...params].every(([k, v]) => {
    if (['select', 'order', 'limit'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(l[k]) === v.slice(3);
    if (v === 'is.true') return l[k] === true;
    throw new Error(`filtro não suportado no falso: ${k}=${v}`);
  }));
  const resposta = (status, corpo) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
  s.fetch = async (url, { method, headers, body }) => {
    if (s.offline) throw new TypeError('fetch failed');
    const u = new URL(url);
    s.pedidos.push(`${method} ${u.pathname}`);
    assert.equal(headers.apikey, ANON, 'sempre a chave pública');
    if (u.pathname === '/auth/v1/token') {
      const d = JSON.parse(body);
      let quem;
      if (u.searchParams.get('grant_type') === 'password') {
        quem = CONTAS[d.email];
        if (d.password !== 'senha-certa' || !quem) return resposta(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      } else {
        quem = [...s.renovacoes_validas].find(([, r]) => r === d.refresh_token)?.[0];
        if (!quem) return resposta(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      }
      s.renovacoes += 1;
      const acesso = `acesso-${s.renovacoes + 1}`;
      s.tokens.set(quem, acesso);
      s.renovacoes_validas.set(quem, `renova-${s.renovacoes + 1}`);
      const email = Object.keys(CONTAS).find((e) => CONTAS[e] === quem);
      return resposta(200, { access_token: acesso, refresh_token: s.renovacoes_validas.get(quem), expires_in: 3600, user: { id: quem, email } });
    }
    const eu = [...s.tokens].find(([, t]) => headers.Authorization === `Bearer ${t}`)?.[0];
    if (!eu) return resposta(401, { message: 'JWT expired' });
    const equipes = s.membros.filter((m) => m.usuario_id === eu).map((m) => m.equipe_id);
    if (s.falha500) return resposta(503, { message: 'indisponível' });
    if (u.pathname === '/auth/v1/logout') return resposta(204);
    if (u.pathname.startsWith('/storage/v1/object/previas/')) {
      const nome = decodeURIComponent(u.pathname.slice('/storage/v1/object/previas/'.length));
      if (!equipes.includes(nome.split('/')[0])) return resposta(403, { message: 'new row violates row-level security policy' });
      s.arquivos.set(nome, String(body));
      return resposta(200, { Key: 'ok' });
    }
    const tabela = u.pathname.replace('/rest/v1/', '');
    const daEquipe = (l) => equipes.includes(l.equipe_id);
    if (method === 'GET') {
      const linhas = tabela === 'membros' ? s.membros : [...s.tabelas[tabela].values()];
      return resposta(200, filtrar(linhas.filter(daEquipe), u.searchParams));
    }
    if (method === 'PATCH') {
      const mudar = JSON.parse(body);
      assert.equal(mudar.owner_id, eu, 'só escreve em nome próprio');
      for (const l of filtrar([...s.tabelas[tabela].values()].filter(daEquipe), u.searchParams)) Object.assign(l, mudar);
      return resposta(204);
    }
    if (tabela === 'projetos' && s.recusarProjeto) return resposta(400, { code: '23514', message: 'violates check constraint' });
    const chaves = CHAVES[tabela];
    assert.equal(u.searchParams.get('on_conflict') || 'id', chaves.join(','), 'on_conflict igual à chave da tabela');
    for (const linha of JSON.parse(body)) {
      assert.equal(linha.owner_id, eu, 'só escreve em nome próprio');
      if (!daEquipe(linha)) return resposta(403, { message: 'new row violates row-level security policy' });
      if (!['projetos', 'dispositivos'].includes(tabela) && !s.tabelas.projetos.has(`${linha.equipe_id},${linha.projeto_slug}`)) {
        return resposta(409, { code: '23503', message: 'foreign key' });
      }
      const k = chaves.map((c) => linha[c]).join(',');
      const atual = s.tabelas[tabela].get(k);
      const ignorar = headers.Prefer.includes('ignore');
      const velha = atual && ['projetos', 'previas'].includes(tabela) && Date.parse(linha.atualizado_local_em) < Date.parse(atual.atualizado_local_em);
      if (!(ignorar && atual) && !velha) s.tabelas[tabela].set(k, { ...atual, ...linha });
    }
    return resposta(201);
  };
  return s;
}
const cofreFalso = { disponivel: () => true, cifrar: (t) => Buffer.from(`cifrado:${t}`).toString('base64'), decifrar: (b) => Buffer.from(b, 'base64').toString().replace(/^cifrado:/, '') };

function montar({ woods = woodsFalso(), dados = tmp(), sb = supabaseFalso(), relogio = { t: Date.UTC(2026, 10, 15) }, git = null, maquina = 'PC' } = {}) {
  const servico = criarServico({ dados, woods, fetch: sb.fetch, cofre: cofreFalso, git, versao: '1.0.0', maquina, agora: () => relogio.t });
  return { servico, sb, woods, dados, relogio };
}
const conectar = (s, email = 'eu@woods.com') => s.conectar({ url: 'https://abc.supabase.co', anonKey: ANON, email, senha: 'senha-certa' });

test('conectar: senha errada não grava nada; certa guarda só o token cifrado', async () => {
  const { servico, dados } = montar();
  await assert.rejects(servico.conectar({ url: 'https://abc.supabase.co', anonKey: ANON, email: 'eu@woods.com', senha: 'errada' }), /Invalid login/);
  assert.equal(fs.existsSync(path.join(dados, 'nuvem.json')), false);
  await assert.rejects(servico.conectar({ url: 'https://abc.supabase.co', anonKey: SERVICE, email: 'eu@woods.com', senha: 'senha-certa' }), /service_role/);

  const s = await conectar(servico);
  await servico.sincronizar();
  assert.equal(s.conectado, true);
  const salvo = fs.readFileSync(path.join(dados, 'nuvem.json'), 'utf8');
  assert.ok(!salvo.includes('senha-certa') && !salvo.includes('renova-') && !salvo.includes('acesso-'), 'sem senha nem token em texto puro');
  const vis = JSON.stringify(servico.situacao());
  assert.ok(!vis.includes('renova-') && !vis.includes('acesso-'), 'a página nunca recebe tokens');

  const d = await servico.desconectar();
  assert.equal(d.conectado, false);
  assert.equal(lerJson(path.join(dados, 'nuvem.json'), {}).renovacao, '');
});

test('sincronização inicial e repetida: tudo uma vez, sem duplicar', async () => {
  const { servico, sb, woods } = montar();
  prints(woods, 'a-390', 'b-390', 'a-1440', 'b-1440');
  await conectar(servico);
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.size, 1);
  const p = sb.tabelas.projetos.get(`${EQ},lima-pet-salon`);
  assert.equal(p.status, 'pesquisa');
  assert.equal(p.prints, undefined);
  assert.deepEqual([...sb.tabelas.eventos.values()].map((e) => e.tipo), ['importado']);
  assert.equal(sb.tabelas.previas.size, 4);
  assert.equal(sb.arquivos.get(`${EQ}/lima-pet-salon/a-390.jpg`), 'jpg-a-390');
  assert.equal(sb.tabelas.dispositivos.size, 1);
  assert.equal(servico.situacao().pendentes, 0);
  assert.ok(servico.situacao().ultimaSincronia);

  const antes = sb.pedidos.length;
  await servico.sincronizar();
  assert.equal(sb.pedidos.length, antes, 'nada mudou: nenhum pedido novo');

  // Mudança de status no WOODS: uma linha atualizada e um evento
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'publicado', linkA: 'https://lima-pet-salon-a.pages.dev/' }));
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.size, 1, 'upsert: mesma linha');
  assert.equal(sb.tabelas.projetos.get(`${EQ},lima-pet-salon`).url_a, 'https://lima-pet-salon-a.pages.dev/');
  assert.deepEqual([...sb.tabelas.eventos.values()].map((e) => e.tipo).sort(), ['importado', 'publicado', 'status']);
});

test('estado local apagado: refazer a sincronização não duplica eventos nem projetos', async () => {
  const woods = woodsFalso();
  const sb = supabaseFalso();
  const a = montar({ woods, sb });
  await conectar(a.servico);
  await a.servico.sincronizar();
  const b = montar({ woods, sb }); // outra pasta de dados, mesma conta
  await conectar(b.servico);
  await b.servico.sincronizar();
  assert.equal(sb.tabelas.projetos.size, 1);
  assert.equal(sb.tabelas.eventos.size, 1, 'o id do "importado" é o mesmo');
});

test('sem internet: o app segue, a fila espera no disco e envia quando a conexão volta', async () => {
  const dados = tmp();
  const woods = woodsFalso();
  const sb = supabaseFalso();
  const relogio = { t: Date.UTC(2026, 10, 15) };
  const um = montar({ dados, woods, sb, relogio });
  await conectar(um.servico);
  await um.servico.sincronizar();
  sb.offline = true;
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'site pronto' }));
  const s = await um.servico.sincronizar(); // não lança
  assert.equal(s.pendentes, 2, 'projeto e evento de status na fila');
  assert.match(s.ultimoErro, /Sem conexão/);
  assert.equal(sb.tabelas.projetos.get(`${EQ},lima-pet-salon`).status, 'pesquisa');

  // O app fecha e abre de novo, ainda sem rede: a fila continua lá
  const dois = montar({ dados, woods, sb, relogio });
  assert.equal(dois.servico.situacao().pendentes, 2);
  sb.offline = false;
  await dois.servico.sincronizar();
  assert.equal(dois.servico.situacao().pendentes, 2, 'respeita a espera antes de tentar de novo');
  relogio.t += ESPERA_MAX;
  await dois.servico.sincronizar();
  assert.equal(dois.servico.situacao().pendentes, 0);
  assert.equal(dois.servico.situacao().ultimoErro, '');
  assert.equal(sb.tabelas.projetos.get(`${EQ},lima-pet-salon`).status, 'site pronto');
  assert.ok([...sb.tabelas.eventos.values()].some((e) => e.tipo === 'status'));
});

test('Supabase fora (503) é temporário; dado recusado (400) vira problema de sincronização sem travar a fila', async () => {
  const { servico, sb, woods, relogio } = montar();
  await conectar(servico);
  sb.falha500 = true;
  await servico.sincronizar();
  assert.ok(servico.situacao().pendentes > 0);
  sb.falha500 = false;
  relogio.t += ESPERA_MAX;
  await servico.sincronizar();
  assert.equal(servico.situacao().pendentes, 0);

  sb.recusarProjeto = true;
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ cidade: 'Barueri' }));
  prints(woods, 'a-390');
  await servico.sincronizar();
  assert.ok(sb.tabelas.previas.has(`${EQ},lima-pet-salon,a-390`), 'o resto da fila seguiu');
  for (let i = 0; i < 12; i++) { relogio.t += ESPERA_MAX; await servico.sincronizar(); }
  assert.equal(servico.situacao().pendentes, 0, 'desistiu do erro permanente');
  sb.recusarProjeto = false;
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ cidade: 'Carapicuíba' }));
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${EQ},lima-pet-salon`).cidade, 'Carapicuíba');
});

test('sessão: token vencido renova sozinho; renovação recusada pede para conectar de novo', async () => {
  const { servico, sb, woods, relogio, dados } = montar();
  await conectar(servico);
  await servico.sincronizar();
  relogio.t += 2 * 3600_000; // o token de acesso venceu
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'aprovado' }));
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${EQ},lima-pet-salon`).status, 'aprovado');
  assert.ok(cofreFalso.decifrar(lerJson(path.join(dados, 'nuvem.json'), {}).renovacao) === sb.renovacoes_validas.get(UID), 'guarda o token de renovação novo');

  sb.renovacoes_validas.set(UID, 'revogado');
  relogio.t += 2 * 3600_000;
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'ligado' }));
  const s = await servico.sincronizar();
  assert.equal(s.expirada, true);
  assert.ok(s.pendentes > 0, 'o que mudou espera a reconexão');
});

test('evento da conversa: lead novo entra antes do evento, e desconectado nada é enviado', async () => {
  const { servico, sb, woods } = montar();
  servico.aoEvento('lima-pet-salon', JSON.stringify({ t: 'estado', rodando: true, em: 1 }));
  assert.equal(servico.situacao().pendentes, 0, 'sem conta conectada: ignora');
  await conectar(servico);
  await servico.sincronizar();
  escrever(woods, 'vault/20-leads/pet-novo.md', ficha().replace('# Lima Pet Salon', '# Pet Novo'));
  servico.aoEvento('pet-novo', JSON.stringify({ t: 'estado', rodando: true, em: Date.UTC(2026, 10, 15, 12) }));
  servico.aoEvento('pet-novo', JSON.stringify({ t: 'claude', texto: 'conteúdo da conversa', em: 2 }));
  servico.aoEvento('pet-novo', JSON.stringify({ t: 'fim', ok: true, em: Date.UTC(2026, 10, 15, 13) }));
  await servico.sincronizar();
  const tipos = [...sb.tabelas.eventos.values()].filter((e) => e.projeto_slug === 'pet-novo').map((e) => e.tipo);
  assert.deepEqual(tipos.sort(), ['criado', 'trabalho_concluido', 'trabalho_iniciado']);
  assert.ok(![...sb.tabelas.eventos.values()].some((e) => JSON.stringify(e).includes('conteúdo da conversa')));
  servico.parar();
});

// ---------- Equipe: você e o sócio ----------
/** git de mentira: a ficha e os prints do lead commitados em `data`, sem mudança local */
const gitFalso = (data, { sujos = [] } = {}) => (args) => {
  if (args[0] === 'rev-parse') return `head-${data}\n`;
  if (args.includes('log')) {
    const arqs = ['vault/20-leads/lima-pet-salon.md', ...['a-390', 'b-390', 'a-1440', 'b-1440'].map((n) => `sites/lima-pet-salon/prints/${n}.jpg`)];
    return `\0${data}\n\n${arqs.join('\n')}\n`;
  }
  if (args.includes('status')) return sujos.map((f) => ` M ${f}\0`).join('');
  throw new Error(`git ${args.join(' ')}`);
};

test('equipe: o sócio vê o que você enviou, e o WOODS atrasado dele não volta o status', async () => {
  const sb = supabaseFalso();
  const relogio = { t: Date.UTC(2026, 10, 15) };
  const woodsEu = woodsFalso();
  escrever(woodsEu, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'site pronto' }));
  prints(woodsEu, 'a-390');
  const woodsSocio = woodsFalso(); // clone feito agora, mas sem o meu último commit
  prints(woodsSocio, 'a-390');
  escrever(woodsSocio, 'sites/lima-pet-salon/prints/a-390.jpg', 'print-velho');
  const eu = montar({ woods: woodsEu, sb, relogio, git: gitFalso('2026-11-12T10:00:00-03:00'), maquina: 'PC-R' });
  const socio = montar({ woods: woodsSocio, sb, relogio, git: gitFalso('2026-11-08T10:00:00-03:00'), maquina: 'PC-L' });

  await conectar(eu.servico);
  await eu.servico.sincronizar();
  const s = await conectar(socio.servico, 'socio@woods.com');
  assert.equal(s.nome, 'L Host', 'nome na equipe vem da tabela membros');
  await socio.servico.sincronizar();

  const p = sb.tabelas.projetos.get(`${EQ},lima-pet-salon`);
  assert.equal(sb.tabelas.projetos.size, 1, 'um lead só para a equipe');
  assert.equal(p.status, 'site pronto', 'a versão velha do sócio foi ignorada');
  assert.equal(p.atualizado_local_em, '2026-11-12T13:00:00.000Z', 'a data é a do commit, não a do arquivo');
  assert.equal(p.criado_local_em, '2026-11-12T13:00:00.000Z');
  assert.equal(sb.arquivos.get(`${EQ}/lima-pet-salon/a-390.jpg`), 'jpg-a-390', 'o print velho do sócio não trocou o meu');
  assert.equal(sb.tabelas.dispositivos.size, 2, 'os dois PCs aparecem');

  // O sócio atualiza o WOODS e muda o lead: agora a versão dele é a mais nova
  escrever(woodsSocio, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'aprovado' }));
  const socio2 = montar({ woods: woodsSocio, sb, relogio, dados: socio.dados, git: gitFalso('2026-11-14T10:00:00-03:00'), maquina: 'PC-L' });
  await socio2.servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${EQ},lima-pet-salon`).status, 'aprovado');
  assert.equal(sb.tabelas.projetos.get(`${EQ},lima-pet-salon`).owner_id, SOCIO, 'owner_id = quem enviou por último');
});

test('mudança local ainda sem commit usa a data do arquivo', () => {
  const w = woodsFalso();
  const quando = criarDatasGit(gitFalso('2026-11-01T00:00:00Z', { sujos: ['vault/20-leads/lima-pet-salon.md'] }))();
  const p = lerProjeto(w, 'lima-pet-salon', undefined, quando);
  assert.notEqual(p.atualizado_local_em, '2026-11-01T00:00:00.000Z');
  assert.equal(p.criado_local_em, '2026-11-01T00:00:00.000Z', 'criação continua sendo o primeiro commit');
});

test('em andamento: o sócio vê quem está com o Claude no lead, até terminar ou o PC sumir', async () => {
  const sb = supabaseFalso();
  const relogio = { t: Date.UTC(2026, 10, 15, 12) };
  const woods = woodsFalso();
  const eu = montar({ woods, sb, relogio, maquina: 'PC-R' });
  const socio = montar({ woods: woodsFalso(), sb, relogio, maquina: 'PC-L' });
  await conectar(eu.servico);
  await conectar(socio.servico, 'socio@woods.com');
  await eu.servico.sincronizar();
  await socio.servico.sincronizar();

  const livre = await socio.servico.consultar('lima-pet-salon');
  assert.deepEqual(livre, { projeto: { responsavel: 'R Host', status: 'pesquisa' }, andamento: null });
  assert.deepEqual(await socio.servico.consultar('nao-existe'), { projeto: null, andamento: null });

  eu.servico.aoEvento('lima-pet-salon', JSON.stringify({ t: 'estado', rodando: true, em: relogio.t }));
  await eu.servico.sincronizar();
  const ocupado = await socio.servico.consultar('lima-pet-salon');
  assert.deepEqual(ocupado.andamento, { quem: 'R Host', computador: 'PC-R', desde: new Date(relogio.t).toISOString() });
  assert.equal((await eu.servico.consultar('lima-pet-salon')).andamento, null, 'o meu próprio trabalho não me avisa');

  // PC fechado à força: depois de 15 min sem sinal o aviso some; ao abrir de novo, o app solta o que ficou
  relogio.t += 16 * 60_000;
  assert.equal((await socio.servico.consultar('lima-pet-salon')).andamento, null);
  const eu2 = montar({ woods, sb, relogio, dados: eu.dados, maquina: 'PC-R' });
  eu2.servico.iniciar();
  await eu2.servico.sincronizar();
  eu2.servico.parar();
  assert.equal(sb.tabelas.andamento.get(`${EQ},lima-pet-salon`).ativo, false);

  // Parar pelo botão (sem resultado do Claude) também solta
  eu2.servico.aoEvento('lima-pet-salon', JSON.stringify({ t: 'estado', rodando: true, em: relogio.t }));
  await eu2.servico.sincronizar();
  assert.equal(sb.tabelas.andamento.get(`${EQ},lima-pet-salon`).ativo, true);
  eu2.servico.aoEvento('lima-pet-salon', JSON.stringify({ t: 'estado', rodando: false, em: relogio.t + 1 }));
  await eu2.servico.sincronizar();
  assert.equal(sb.tabelas.andamento.get(`${EQ},lima-pet-salon`).ativo, false);
  eu2.servico.parar();
});

test('lead apagado do WOODS some do painel; muitos sumindo de uma vez não apaga nada', async () => {
  const { servico, sb, woods } = montar();
  for (const n of ['b', 'c', 'd', 'e', 'f']) escrever(woods, `vault/20-leads/pet-${n}.md`, ficha());
  await conectar(servico);
  await servico.sincronizar();
  fs.rmSync(path.join(woods, 'vault/20-leads/pet-b.md'));
  await servico.sincronizar();
  assert.ok(sb.tabelas.projetos.get(`${EQ},pet-b`).removido_em, 'marcado como removido');
  assert.equal(sb.tabelas.projetos.get(`${EQ},pet-c`).removido_em, null);
  escrever(woods, 'vault/20-leads/pet-b.md', ficha({ status: 'aprovado' }));
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${EQ},pet-b`).removido_em, null, 'voltou: aparece de novo');

  fs.rmSync(path.join(woods, 'vault/20-leads'), { recursive: true });
  await servico.sincronizar();
  assert.ok([...sb.tabelas.projetos.values()].every((p) => !p.removido_em), 'pasta sumiu: não marca nada');
});

test('conta fora de qualquer equipe não conecta; conexão antiga descobre a equipe sozinha', async () => {
  const sb = supabaseFalso();
  sb.membros = sb.membros.filter((m) => m.usuario_id !== SOCIO);
  const a = montar({ sb });
  await assert.rejects(conectar(a.servico, 'socio@woods.com'), /nenhuma equipe/);
  assert.equal(fs.existsSync(path.join(a.dados, 'nuvem.json')), false);

  // Painel conectado antes desta versão: nuvem.json sem equipe
  const b = montar({ sb });
  await conectar(b.servico);
  await b.servico.sincronizar();
  const arq = path.join(b.dados, 'nuvem.json');
  fs.writeFileSync(arq, JSON.stringify({ ...JSON.parse(fs.readFileSync(arq, 'utf8')), equipeId: '' }));
  sb.tabelas.projetos.clear();
  const c = montar({ sb, woods: b.woods, dados: b.dados });
  await c.servico.sincronizar();
  assert.equal(sb.tabelas.projetos.size, 1, 'reenviou para a equipe');
  assert.equal(c.servico.situacao().equipe, true);
});

test('criarDatasGit com o git de verdade', { skip: spawnSync('git', ['--version']).status !== 0 && 'sem git nesta máquina' }, () => {
  const w = woodsFalso();
  fs.rmSync(path.join(w, '.git'), { recursive: true });
  const g = (...a) => spawnSync('git', a, { cwd: w, encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: '2026-11-01T12:00:00Z', GIT_AUTHOR_DATE: '2026-11-01T12:00:00Z' } });
  g('init', '-q'); g('add', '.'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'um');
  escrever(w, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'aprovado' }));
  const env2 = { ...process.env, GIT_COMMITTER_DATE: '2026-11-05T12:00:00Z', GIT_AUTHOR_DATE: '2026-11-05T12:00:00Z' };
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'dois'], { cwd: w, env: env2 });
  const git = (args) => spawnSync('git', args, { cwd: w, encoding: 'utf8' }).stdout;
  const ler = criarDatasGit(git);
  let p = lerProjeto(w, 'lima-pet-salon', undefined, ler());
  assert.equal(p.atualizado_local_em, '2026-11-05T12:00:00.000Z');
  assert.equal(p.criado_local_em, '2026-11-01T12:00:00.000Z');
  escrever(w, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'publicado' }));
  p = lerProjeto(w, 'lima-pet-salon', undefined, ler());
  assert.ok(Date.parse(p.atualizado_local_em) > Date.parse('2026-11-10'), 'mudou sem commit: data do arquivo');
});
