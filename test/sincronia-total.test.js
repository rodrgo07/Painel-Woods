// Sincronização entre computadores pelo Supabase: conversas e sessões do Claude, travas, preferências
// e a proteção contra um computador atrasado. Supabase falso, sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { criarServico } from '../sincronia/servico.js';
import { pastaSessoes, paraNuvem, daNuvem, juntarLinhas, juntarPreferencias, normalizar, lerPermissoes, gravarPermissoes, lerSessoes } from '../sincronia/conversas.js';
import { supabaseFalso, UID, ANON } from './supabase-falso.js';

const tmp = (p = 'total-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const escrever = (arq, conteudo) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, conteudo); };
const cofre = { disponivel: () => true, cifrar: (t) => Buffer.from(t).toString('base64'), decifrar: (b) => Buffer.from(b, 'base64').toString() };
const SID = '0d6c1a3e-1111-4c3b-9b0e-123456789abc';
const linha = (t, texto, em) => JSON.stringify({ t, texto, em });

/** Um computador: pasta de dados, WOODS (com um lead) e pasta do Claude próprias; a mesma conta no Supabase */
function computador(sb, nome, { relogio = { t: Date.UTC(2026, 10, 16, 12) }, ocupado = () => null, emDia = () => true } = {}) {
  const raiz = tmp(`${nome}-`);
  const woods = path.join(raiz, 'Users', nome, 'AppData', 'PainelWoods', 'WOODS');
  escrever(path.join(woods, 'vault/20-leads/lima-pet-salon.md'), '---\nstatus: pesquisa\n---\n# Lima Pet Salon\n');
  const dados = path.join(raiz, 'dados');
  fs.mkdirSync(path.join(dados, 'conversas'), { recursive: true });
  const claude = path.join(raiz, 'claude');
  const prefs = { modelo: 'claude-opus-5-5', gitNome: '', gitEmail: '' };
  const preferencias = {
    ler: () => ({ ...prefs, permissoes: lerPermissoes(woods) }),
    aplicar: (p) => { Object.assign(prefs, { modelo: p.modelo, gitNome: p.gitNome, gitEmail: p.gitEmail }); gravarPermissoes(woods, p.permissoes); },
  };
  const baixadas = [];
  const servico = criarServico({
    dados, woods, fetch: sb.fetch, cofre, maquina: nome, agora: () => relogio.t, claude, ocupado, emDia, preferencias,
    aoBaixarConversa: (slug) => baixadas.push(slug),
  });
  const sessao = () => path.join(pastaSessoes(claude, woods), `${SID}.jsonl`);
  return { nome, woods, dados, claude, prefs, servico, relogio, baixadas, sessao, painel: () => path.join(dados, 'conversas', 'lima-pet-salon.jsonl') };
}
const conectar = (pc) => pc.servico.conectar({ url: 'https://abc.supabase.co', anonKey: ANON, email: 'eu@woods.com', senha: 'senha-certa' });
const transcricao = (woods, ...msgs) => msgs.map((m) => JSON.stringify({ sessionId: SID, cwd: woods, message: m })).join('\n') + '\n';

test('conversa e sessão do Claude vão de um computador para o outro, com o caminho do WOODS de cada um', async () => {
  const sb = supabaseFalso();
  const pc = computador(sb, 'casa');
  const nb = computador(sb, 'notebook');
  escrever(pc.painel(), `${linha('eu', 'faz o lead', 1)}\n${linha('claude', 'feito', 2)}\n`);
  escrever(pc.sessao(), transcricao(pc.woods, 'oi', `editei ${path.join(pc.woods, 'sites/lima-pet-salon/a/index.html')}`));
  escrever(path.join(pc.dados, 'sessoes.json'), JSON.stringify({ 'lima-pet-salon': SID }));
  await conectar(pc);
  await pc.servico.sincronizar();
  const r = sb.tabelas.conversas.get(`${UID},lima-pet-salon`);
  assert.equal(r.versao, 1);
  assert.equal(r.sessao_id, SID);
  const naNuvem = zlib.gunzipSync(sb.arquivos.get(`${UID}/lima-pet-salon/sessao-${r.sessao_sha.slice(0, 32)}.jsonl.gz`)).toString();
  assert.ok(!naNuvem.includes(pc.woods) && !naNuvem.includes('casa'), 'o caminho deste computador não vai para a nuvem');

  await conectar(nb);
  await nb.servico.sincronizar();
  assert.equal(fs.readFileSync(nb.painel(), 'utf8'), fs.readFileSync(pc.painel(), 'utf8'), 'histórico do painel igual');
  assert.equal(lerSessoes(nb.dados)['lima-pet-salon'], SID, 'o notebook continua a mesma sessão do Claude');
  const lida = fs.readFileSync(nb.sessao(), 'utf8');
  assert.ok(lida.includes(JSON.stringify(nb.woods).slice(1, -1)), 'com o caminho do WOODS do notebook');
  assert.ok(!lida.includes(pc.woods));
  assert.deepEqual(nb.baixadas, ['lima-pet-salon'], 'a janela é avisada');

  const escritas = () => sb.pedidos.filter((p) => !p.startsWith('GET ')).length;
  const antes = escritas();
  await nb.servico.sincronizar();
  await pc.servico.sincronizar();
  assert.equal(escritas(), antes, 'nada mudou: nada é reenviado (nem ida e volta do caminho do WOODS)');

  // O notebook continua a conversa; o PC de casa recebe
  fs.appendFileSync(nb.painel(), `${linha('eu', 'troca a cor', 3)}\n`);
  fs.appendFileSync(nb.sessao(), transcricao(nb.woods, 'troca a cor'));
  await nb.servico.sincronizar();
  await pc.servico.sincronizar();
  assert.match(fs.readFileSync(pc.painel(), 'utf8'), /troca a cor/);
  assert.match(fs.readFileSync(pc.sessao(), 'utf8'), /troca a cor/);
  assert.equal(sb.tabelas.conversas.get(`${UID},lima-pet-salon`).versao, 2);
  assert.equal([...sb.arquivos.keys()].filter((k) => k.includes('/lima-pet-salon/sessao-')).length, 1, 'arquivo antigo apagado');
});

test('sem internet nos dois: os históricos do painel se somam; a sessão da nuvem vale e a daqui fica guardada', async () => {
  const sb = supabaseFalso();
  const pc = computador(sb, 'casa');
  const nb = computador(sb, 'notebook');
  escrever(pc.painel(), `${linha('eu', 'começo', 1)}\n`);
  escrever(pc.sessao(), transcricao(pc.woods, 'começo'));
  escrever(path.join(pc.dados, 'sessoes.json'), JSON.stringify({ 'lima-pet-salon': SID }));
  await conectar(pc);
  await pc.servico.sincronizar();
  await conectar(nb);
  await nb.servico.sincronizar();

  fs.appendFileSync(pc.painel(), `${linha('eu', 'do PC', 10)}\n`);
  fs.appendFileSync(pc.sessao(), transcricao(pc.woods, 'do PC'));
  fs.appendFileSync(nb.painel(), `${linha('eu', 'do notebook', 5)}\n`);
  fs.appendFileSync(nb.sessao(), transcricao(nb.woods, 'do notebook'));
  await pc.servico.sincronizar();
  await nb.servico.sincronizar(); // os dois mudaram
  await pc.servico.sincronizar();
  for (const c of [pc, nb]) {
    const textos = fs.readFileSync(c.painel(), 'utf8').trim().split('\n').map((l) => JSON.parse(l).texto);
    assert.deepEqual(textos, ['começo', 'do notebook', 'do PC'], `${c.nome}: tudo, em ordem de tempo`);
  }
  assert.match(fs.readFileSync(nb.sessao(), 'utf8'), /do PC/);
  const guardada = fs.readdirSync(path.dirname(nb.sessao())).find((f) => f.includes('.conflito-'));
  assert.ok(guardada, 'a sessão do notebook ficou guardada ao lado');
  assert.match(fs.readFileSync(path.join(path.dirname(nb.sessao()), guardada), 'utf8'), /do notebook/);
});

test('arquivo da sessão sumiu aqui (o Claude Code limpou): baixa de novo, sem ficar reenviando', async () => {
  const sb = supabaseFalso();
  const pc = computador(sb, 'casa');
  escrever(pc.painel(), `${linha('eu', 'oi', 1)}\n`);
  escrever(pc.sessao(), transcricao(pc.woods, 'oi'));
  escrever(path.join(pc.dados, 'sessoes.json'), JSON.stringify({ 'lima-pet-salon': SID }));
  await conectar(pc);
  await pc.servico.sincronizar();
  fs.rmSync(pc.sessao());
  await pc.servico.sincronizar();
  assert.ok(fs.existsSync(pc.sessao()));
  assert.equal(sb.tabelas.conversas.get(`${UID},lima-pet-salon`).versao, 1);
});

test('o lead em que o Claude está trabalhando não é tocado; depois vai', async () => {
  const sb = supabaseFalso();
  let ocupado = 'lima-pet-salon';
  const pc = computador(sb, 'casa', { ocupado: () => ocupado });
  escrever(pc.painel(), `${linha('eu', 'oi', 1)}\n`);
  await conectar(pc);
  await pc.servico.sincronizar();
  assert.equal(sb.tabelas.conversas.size, 0);
  ocupado = null;
  await pc.servico.sincronizar();
  assert.equal(sb.tabelas.conversas.size, 1);
});

test('trava: dois computadores não rodam o Claude no mesmo lead', async () => {
  const sb = supabaseFalso();
  const relogio = { t: Date.UTC(2026, 10, 16, 12) };
  const pc = computador(sb, 'casa', { relogio });
  const nb = computador(sb, 'notebook', { relogio });
  await conectar(pc);
  await conectar(nb);
  await pc.servico.antesDoClaude('lima-pet-salon');
  await pc.servico.antesDoClaude('lima-pet-salon'); // o mesmo computador de novo: tudo bem
  await assert.rejects(nb.servico.antesDoClaude('lima-pet-salon'), /no computador casa/);
  await nb.servico.antesDoClaude('outro-lead'); // outro lead: tudo bem
  await pc.servico.depoisDoClaude('lima-pet-salon');
  await nb.servico.depoisDoClaude('outro-lead');
  await nb.servico.antesDoClaude('lima-pet-salon');
  // O notebook desligou no meio: depois de 10 min sem renovar, a trava não vale mais
  relogio.t += 11 * 60_000;
  await pc.servico.antesDoClaude('lima-pet-salon');
  // Sem internet: não dá para conferir, segue
  sb.offline = true;
  await nb.servico.antesDoClaude('lima-pet-salon');
  pc.servico.parar();
  nb.servico.parar();
});

test('trava é renovada enquanto o Claude trabalha', async () => {
  const sb = supabaseFalso();
  const relogio = { t: Date.UTC(2026, 10, 16, 12) };
  const pc = computador(sb, 'casa', { relogio });
  const nb = computador(sb, 'notebook', { relogio });
  await conectar(pc);
  await conectar(nb);
  await pc.servico.antesDoClaude('lima-pet-salon');
  for (let i = 0; i < 6; i++) { relogio.t += 3 * 60_000; await pc.servico.sincronizar(); }
  await assert.rejects(nb.servico.antesDoClaude('lima-pet-salon'), /casa/, '18 min depois, ainda trabalhando: continua travado');
});

test('preferências: modelo e assinatura vêm do outro computador; permissões "Sempre" se somam', async () => {
  const sb = supabaseFalso();
  const pc = computador(sb, 'casa');
  const nb = computador(sb, 'notebook');
  Object.assign(pc.prefs, { modelo: 'claude-fable-5-2', gitNome: 'rodrgo07', gitEmail: 'r@woods.com' });
  gravarPermissoes(pc.woods, { allow: ['Bash(git push*)'] });
  await conectar(pc);
  await pc.servico.sincronizar();
  await conectar(nb);
  await nb.servico.sincronizar();
  assert.deepEqual(nb.prefs, { modelo: 'claude-fable-5-2', gitNome: 'rodrgo07', gitEmail: 'r@woods.com' });
  assert.deepEqual(lerPermissoes(nb.woods).allow, ['Bash(git push*)']);

  gravarPermissoes(nb.woods, { allow: ['Bash(curl *)', 'Bash(git push*)'] });
  gravarPermissoes(pc.woods, { allow: ['Bash(git push*)', 'WebFetch'] });
  await nb.servico.sincronizar();
  await pc.servico.sincronizar();
  await nb.servico.sincronizar();
  for (const c of [pc, nb]) assert.deepEqual(lerPermissoes(c.woods).allow, ['Bash(curl *)', 'Bash(git push*)', 'WebFetch']);
  const v = sb.tabelas.preferencias.get(UID).versao;
  await pc.servico.sincronizar();
  await nb.servico.sincronizar();
  assert.equal(sb.tabelas.preferencias.get(UID).versao, v, 'estável: nada reenviado');
});

test('WOODS atrasado: projetos não vão ao Woods Web até o espelho pôr em dia; mudança de outro PC não repete eventos', async () => {
  const sb = supabaseFalso();
  let emDia = false;
  const nb = computador(sb, 'notebook', { emDia: () => emDia });
  await conectar(nb);
  await nb.servico.sincronizar();
  assert.equal(sb.tabelas.projetos.size, 0, 'atrasado: nada de projeto');
  emDia = true;
  await nb.servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${UID},lima-pet-salon`).status, 'pesquisa');
  // O espelho trouxe uma ficha mudada por outro computador
  escrever(path.join(nb.woods, 'vault/20-leads/lima-pet-salon.md'), '---\nstatus: site pronto\n---\n# Lima Pet Salon\n');
  nb.servico.rebasear();
  await nb.servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${UID},lima-pet-salon`).status, 'site pronto', 'a linha do projeto vai');
  assert.ok(![...sb.tabelas.eventos.values()].some((e) => e.tipo === 'status'), 'o evento de status é do computador que mudou');
});

test('peças: caminho do WOODS, junção do histórico e das preferências', () => {
  const w = path.sep === '\\' ? 'C:\\Users\\rod\\AppData\\Roaming\\PainelWoods\\WOODS' : '/home/rod/PainelWoods/WOODS';
  const txt = `{"cwd":${JSON.stringify(w)},"x":"${w.replaceAll('\\', '/')}/sites"}`;
  const nuvem = paraNuvem(txt, w);
  assert.ok(!nuvem.includes('rod'));
  assert.equal(paraNuvem(daNuvem(nuvem, w), w), nuvem, 'ida e volta estável');
  assert.ok(daNuvem(nuvem, w).includes(JSON.stringify(w).slice(1, -1)));
  assert.equal(juntarLinhas(`${linha('a', 1, 1)}\n${linha('c', 3, 3)}\n`, `${linha('b', 2, 2)}\n${linha('c', 3, 3)}\n`).trim().split('\n').length, 3);
  assert.equal(juntarLinhas('', ''), '');
  const j = juntarPreferencias({ modelo: 'a', gitNome: 'x', permissoes: { allow: ['1'] } }, { modelo: 'b', gitNome: '', permissoes: { allow: ['2'], deny: ['3'] } });
  assert.deepEqual(j, normalizar({ modelo: 'b', gitNome: 'x', permissoes: { allow: ['1', '2'], deny: ['3'] } }));
});
