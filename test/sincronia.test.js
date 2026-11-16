// Sincronização com o Woods Web: mapeamento do WOODS, fila offline, idempotência e erros. Supabase falso, sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerProjeto, lerProjetos, paraLinha, eventos, eventoDaConversa, instagram, repositorio, idEstavel } from '../sincronia/mapa.js';
import { Fila, espera, ESPERA_MIN, ESPERA_MAX, MAX_TENTATIVAS, lerJson } from '../sincronia/fila.js';
import { conferirConfig } from '../sincronia/supabase.js';
import { criarServico } from '../sincronia/servico.js';
import { limpar } from '../nucleo.js';
import { supabaseFalso, UID, ANON } from './supabase-falso.js';

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
const cofreFalso = { disponivel: () => true, cifrar: (t) => Buffer.from(`cifrado:${t}`).toString('base64'), decifrar: (b) => Buffer.from(b, 'base64').toString().replace(/^cifrado:/, '') };

function montar({ woods = woodsFalso(), dados = tmp(), sb = supabaseFalso(), relogio = { t: Date.UTC(2026, 10, 15) } } = {}) {
  const servico = criarServico({ dados, woods, fetch: sb.fetch, cofre: cofreFalso, versao: '1.0.0', maquina: 'PC', agora: () => relogio.t });
  return { servico, sb, woods, dados, relogio };
}
const conectar = (s) => s.conectar({ url: 'https://abc.supabase.co', anonKey: ANON, email: 'eu@woods.com', senha: 'senha-certa' });

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
  const p = sb.tabelas.projetos.get(`${UID},lima-pet-salon`);
  assert.equal(p.status, 'pesquisa');
  assert.equal(p.prints, undefined);
  assert.deepEqual([...sb.tabelas.eventos.values()].map((e) => e.tipo), ['importado']);
  assert.equal(sb.tabelas.previas.size, 4);
  assert.equal(sb.arquivos.get(`${UID}/lima-pet-salon/a-390.jpg`), 'jpg-a-390');
  assert.equal(sb.tabelas.dispositivos.size, 1);
  assert.equal(servico.situacao().pendentes, 0);
  assert.ok(servico.situacao().ultimaSincronia);

  const escritas = () => sb.pedidos.filter((p) => !p.startsWith('GET ')).length;
  const antes = escritas();
  await servico.sincronizar();
  assert.equal(escritas(), antes, 'nada mudou: nada é enviado (só a consulta das conversas)');

  // Mudança de status no WOODS: uma linha atualizada e um evento
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'publicado', linkA: 'https://lima-pet-salon-a.pages.dev/' }));
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.size, 1, 'upsert: mesma linha');
  assert.equal(sb.tabelas.projetos.get(`${UID},lima-pet-salon`).url_a, 'https://lima-pet-salon-a.pages.dev/');
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
  assert.equal(sb.tabelas.projetos.get(`${UID},lima-pet-salon`).status, 'pesquisa');

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
  assert.equal(sb.tabelas.projetos.get(`${UID},lima-pet-salon`).status, 'site pronto');
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
  assert.ok(sb.tabelas.previas.has(`${UID},lima-pet-salon,a-390`), 'o resto da fila seguiu');
  for (let i = 0; i < 12; i++) { relogio.t += ESPERA_MAX; await servico.sincronizar(); }
  assert.equal(servico.situacao().pendentes, 0, 'desistiu do erro permanente');
  sb.recusarProjeto = false;
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ cidade: 'Carapicuíba' }));
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${UID},lima-pet-salon`).cidade, 'Carapicuíba');
});

test('sessão: token vencido renova sozinho; renovação recusada pede para conectar de novo', async () => {
  const { servico, sb, woods, relogio, dados } = montar();
  await conectar(servico);
  await servico.sincronizar();
  relogio.t += 2 * 3600_000; // o token de acesso venceu
  escrever(woods, 'vault/20-leads/lima-pet-salon.md', ficha({ status: 'aprovado' }));
  await servico.sincronizar();
  assert.equal(sb.tabelas.projetos.get(`${UID},lima-pet-salon`).status, 'aprovado');
  assert.ok(cofreFalso.decifrar(lerJson(path.join(dados, 'nuvem.json'), {}).renovacao) === sb.renovacaoValida, 'guarda o token de renovação novo');

  sb.renovacaoValida = 'revogado';
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
