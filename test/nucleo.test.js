import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validar, ler, salvar, caminhoSeguro, importarConversas, limpar, MODELOS } from '../nucleo.js';
import { checar, acharNavegador, ambiente, ferramentas, rodar, novidades, atualizar } from '../woods.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'painel-teste-'));
const criar = (base, ...arqs) => arqs.forEach((a) => {
  fs.mkdirSync(path.dirname(path.join(base, a)), { recursive: true });
  fs.writeFileSync(path.join(base, a), 'x');
});

test('caminhoSeguro bloqueia ../ e caminho absoluto', () => {
  const base = tmp();
  criar(base, 'dist/a/index.html', 'dist/a/foto.jpg');
  fs.writeFileSync(path.join(path.dirname(base), 'segredo.txt'), 'x');
  assert.equal(caminhoSeguro(base, ['dist', 'a', 'foto.jpg']), path.join(base, 'dist', 'a', 'foto.jpg'));
  assert.equal(caminhoSeguro(base, ['dist', 'a']), path.join(base, 'dist', 'a', 'index.html'), 'pasta vira index.html');
  assert.equal(caminhoSeguro(base, ['..', 'segredo.txt']), null);
  assert.equal(caminhoSeguro(base, ['dist', '..', '..', 'segredo.txt']), null);
  assert.equal(caminhoSeguro(base, [path.join(path.dirname(base), 'segredo.txt')]), null, 'caminho absoluto');
  assert.equal(caminhoSeguro(base, ['dist', 'nao-existe.jpg']), null);
});

test('configuração: padrões, validação e gravação', () => {
  assert.deepEqual(validar(), { modelo: 'claude-opus-5-5', gitNome: '', gitEmail: '', navegador: '', chaveApi: '' });
  assert.ok(MODELOS.includes('claude-fable-5-2'));
  const v = validar({ modelo: 'gpt', gitNome: ' Rodrigo\nSilva ', gitEmail: 'sem-arroba', navegador: 'firefox', chaveApi: 7, outra: 1 });
  assert.deepEqual(v, { modelo: 'claude-opus-5-5', gitNome: 'Rodrigo Silva', gitEmail: '', navegador: '', chaveApi: '' });

  const arq = path.join(tmp(), 'config.json');
  assert.equal(ler(arq).modelo, 'claude-opus-5-5', 'sem arquivo: padrão');
  salvar(arq, { modelo: 'claude-fable-5-2', gitNome: 'R', gitEmail: 'r@woods.com', navegador: 'edge' });
  assert.deepEqual(ler(arq), { modelo: 'claude-fable-5-2', gitNome: 'R', gitEmail: 'r@woods.com', navegador: 'edge', chaveApi: '' });
  fs.writeFileSync(arq, '{quebrado');
  assert.equal(ler(arq).modelo, 'claude-opus-5-5', 'arquivo quebrado: padrão');
});

test('importarConversas copia só conversas de leads e não troca as que já existem', () => {
  const origem = tmp();
  const destino = tmp();
  criar(origem, 'lima-pet-salon.jsonl', 'pet-x.jsonl', 'sessoes.json', 'Nome Errado.jsonl', 'anotacao.txt');
  fs.writeFileSync(path.join(destino, 'pet-x.jsonl'), 'conversa atual');
  assert.equal(importarConversas(origem, destino), 1);
  assert.deepEqual(fs.readdirSync(destino).sort(), ['lima-pet-salon.jsonl', 'pet-x.jsonl']);
  assert.equal(fs.readFileSync(path.join(destino, 'pet-x.jsonl'), 'utf8'), 'conversa atual');
  assert.equal(importarConversas(origem, destino), 0, 'repetir não copia de novo');
});

test('limpar tira chaves e tokens do que vai para o log', () => {
  const t = limpar('curl -H "x-api-key: sk-ant-api03-AbCdEf_123456" e ghp_abcdefghijklmnopqrstuvwxyz0123456789 e github_pat_11ABCDEFG0abcdefghij_xyz');
  assert.ok(!/sk-ant-api03|ghp_abc|github_pat_11/.test(t));
  assert.equal(limpar('git status'), 'git status');
});

test('checar diz o que falta no WOODS', () => {
  const dir = tmp();
  assert.deepEqual(checar(dir), { clonado: false, deps: false });
  criar(dir, 'scripts/novo-lead.js', 'vault/20-leads/_modelo-lead.md');
  assert.deepEqual(checar(dir), { clonado: true, deps: false });
  criar(dir, 'node_modules/sharp/package.json');
  assert.deepEqual(checar(dir), { clonado: true, deps: true });
});

test('acharNavegador: escolhido, depois Chrome, depois Edge, depois o Chromium baixado', () => {
  const so = (trecho) => (f) => f.includes(trecho);
  assert.equal(acharNavegador('', '', () => true).tipo, 'chrome');
  assert.equal(acharNavegador('edge', '', () => true).tipo, 'edge');
  assert.equal(acharNavegador('', '', so('msedge.exe')).tipo, 'edge');
  assert.equal(acharNavegador('edge', '', so('chrome.exe')).tipo, 'chrome', 'escolhido não existe: cai no que houver');
  assert.deepEqual(acharNavegador('', tmp(), () => false), { tipo: '', exe: '' });
  const pasta = tmp();
  criar(pasta, 'chromium-1200/chrome-win64/chrome.exe', 'chromium_headless_shell-1200/chrome-win/headless_shell.exe');
  assert.deepEqual(acharNavegador('', pasta, () => false), { tipo: 'chromium', exe: path.join(pasta, 'chromium-1200', 'chrome-win64', 'chrome.exe') });
});

// Usa o git embutido (npm run ferramentas). Sem ele, o teste é pulado.
const F = ferramentas(path.resolve(import.meta.dirname, '..', 'vendor'));
test('atualizar o WOODS não mexe em trabalho local de um lead em andamento', { skip: !fs.existsSync(F.git) }, async () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.test' };
  const o = { ...F, env };
  const git = (dir, ...a) => rodar(F.git, a, { cwd: dir, env });
  const origem = tmp();
  const copia = path.join(tmp(), 'WOODS');
  const gravar = (dir, arq, txt) => fs.writeFileSync(path.join(dir, arq), txt);
  const publicar = async (arq, txt) => { gravar(origem, arq, txt); await git(origem, 'add', '-A'); await git(origem, 'commit', '-q', '-m', arq); };

  await git(origem, 'init', '-q', '-b', 'main');
  await publicar('modelo.txt', 'v1');
  await publicar('lead.txt', 'v1');
  await git(path.dirname(copia), 'clone', '-q', origem, copia);

  // Novidade em outro arquivo: entra, e o que está sendo editado no lead continua lá
  gravar(copia, 'lead.txt', 'em andamento');
  await publicar('modelo.txt', 'v2');
  assert.equal(await novidades(copia, o), 1);
  assert.deepEqual(await atualizar(copia, o), { commits: 1, deps: false });
  assert.equal(fs.readFileSync(path.join(copia, 'modelo.txt'), 'utf8'), 'v2');
  assert.equal(fs.readFileSync(path.join(copia, 'lead.txt'), 'utf8'), 'em andamento');

  // Novidade no mesmo arquivo: recusa com aviso claro e não altera nada
  await publicar('lead.txt', 'v2');
  await assert.rejects(atualizar(copia, o), /Nada foi alterado/);
  assert.equal(fs.readFileSync(path.join(copia, 'lead.txt'), 'utf8'), 'em andamento');

  // Mudou o package.json: avisa que as dependências precisam ser instaladas de novo
  await git(copia, 'checkout', '-q', '--', 'lead.txt');
  await publicar('package.json', '{}');
  assert.deepEqual(await atualizar(copia, o), { commits: 2, deps: true });
});

test('ambiente põe o Node e o Git do app na frente do PATH, sem duplicar a chave', () => {
  const env = ambiente({ vendor: 'C:\\app\\vendor', navegador: 'C:\\edge.exe', pastaChromium: 'C:\\nav', cfg: { gitNome: 'R', gitEmail: 'r@woods.com' }, chave: '' });
  const chaves = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
  assert.equal(chaves.length, 1);
  assert.ok(env[chaves[0]].startsWith('C:\\app\\vendor\\node;C:\\app\\vendor\\git\\cmd;'));
  assert.equal(env.CHROME, 'C:\\edge.exe');
  assert.equal(env.GIT_COMMITTER_EMAIL, 'r@woods.com');
  assert.equal(env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\\app\\vendor\\git\\bin\\bash.exe');
  assert.ok(!('ANTHROPIC_API_KEY' in env) || env.ANTHROPIC_API_KEY === process.env.ANTHROPIC_API_KEY, 'sem chave guardada, não inventa uma');
});
