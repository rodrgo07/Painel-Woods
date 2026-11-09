import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validar, ler, salvar, caminhoSeguro, limpar, MODELOS } from '../nucleo.js';
import { checar, acharNavegador, ambiente } from '../woods.js';

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
