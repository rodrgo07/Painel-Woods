// Espelho do WOODS entre computadores: git de verdade, "GitHub" num repositório bare local, sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { criarEspelho, executorGit, classificar, leadsDe, REF, REF_RAMO } from '../sincronia/espelho.js';

const ID = { GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@t.t', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@t.t' };
const ENV = { ...process.env, ...ID, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const tmp = (p = 'espelho-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
const escrever = (base, arq, conteudo) => {
  fs.mkdirSync(path.dirname(path.join(base, arq)), { recursive: true });
  fs.writeFileSync(path.join(base, arq), conteudo);
};
const ler = (base, arq) => (fs.existsSync(path.join(base, arq)) ? fs.readFileSync(path.join(base, arq), 'utf8') : null);

/** GitHub falso com o WOODS mínimo e N computadores, cada um com o seu clone e a sua pasta de dados */
function cenario(n = 2) {
  const origem = path.join(tmp(), 'WOODS.git');
  git(path.dirname(origem), 'init', '--bare', '-b', 'main', origem);
  const semente = tmp();
  git(semente, 'init', '-b', 'main');
  escrever(semente, '.gitignore', 'node_modules/\ndist/\n');
  escrever(semente, 'vault/20-leads/lima-pet-salon.md', '---\nstatus: pesquisa\n---\n# Lima\n');
  escrever(semente, 'sites/lima-pet-salon/site.config.json', '{"nome":"Lima"}\n');
  escrever(semente, 'package.json', '{}\n');
  git(semente, 'add', '-A');
  git(semente, 'commit', '-qm', 'inicial');
  git(semente, 'remote', 'add', 'origin', origem);
  git(semente, 'push', '-q', 'origin', 'main');
  const pcs = Array.from({ length: n }, (_, i) => {
    const woods = path.join(tmp(), 'WOODS');
    git(path.dirname(woods), 'clone', '-q', origem, woods);
    const dados = tmp('dados-');
    const espelho = criarEspelho({ woods, dados, git: executorGit({ env: ENV }), maquina: `PC${i + 1}` });
    return { woods, dados, espelho };
  });
  return { origem, pcs };
}
const mainNoGithub = (origem) => git(origem, 'rev-parse', 'refs/heads/main');

test('lead novo sem commit aparece no outro computador; o main do GitHub não muda (nada vai ao ar)', async () => {
  const { origem, pcs: [a, b] } = cenario();
  const main = mainNoGithub(origem);
  await b.espelho.sincronizar(); // o notebook liga primeiro, ainda sem nada novo
  escrever(a.woods, 'vault/20-leads/pet-novo.md', '# Pet Novo\n');
  escrever(a.woods, 'sites/pet-novo/a/index.html', '<h1>A</h1>');
  escrever(a.woods, 'vault/20-leads/lima-pet-salon.md', '---\nstatus: site pronto\n---\n# Lima\n');
  escrever(a.woods, 'sites/pet-novo/dist/a/index.html', 'build'); // ignorado pelo .gitignore
  escrever(a.woods, '.claude/settings.local.json', '{"permissions":{"allow":["Bash(curl *)"]}}');
  await a.espelho.sincronizar();
  assert.equal(mainNoGithub(origem), main, 'o main (que publica no Cloudflare) fica igual');
  assert.ok(git(origem, 'rev-parse', REF), 'a foto foi para refs/painel/espelho');

  const r = await b.espelho.sincronizar();
  assert.equal(ler(b.woods, 'vault/20-leads/pet-novo.md'), '# Pet Novo\n');
  assert.equal(ler(b.woods, 'sites/pet-novo/a/index.html'), '<h1>A</h1>');
  assert.match(ler(b.woods, 'vault/20-leads/lima-pet-salon.md'), /site pronto/);
  assert.equal(ler(b.woods, 'sites/pet-novo/dist/a/index.html'), null, 'dist/ não vai (é refeito pelo build)');
  assert.equal(ler(b.woods, '.claude/settings.local.json'), null, 'permissões vão pelas preferências, não pelo espelho');
  assert.deepEqual(r.leads.sort(), ['lima-pet-salon', 'pet-novo']);
  assert.equal(r.pacotes, false);
  assert.equal(git(b.woods, 'rev-parse', 'HEAD'), main, 'o HEAD continua no mesmo commit (o trabalho segue sem commit, igual ao PC de origem)');
  assert.match(git(b.woods, 'status', '--porcelain'), /\?\? sites\/pet-novo\//);
  assert.equal(b.espelho.situacao().emDia, true);

  const deNovo = await b.espelho.sincronizar();
  assert.deepEqual(deNovo.mudados, [], 'segunda rodada sem nada novo');
});

test('apagar um arquivo também propaga, e mudança de package-lock pede npm ci', async () => {
  const { pcs: [a, b] } = cenario();
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  fs.rmSync(path.join(a.woods, 'sites/lima-pet-salon/site.config.json'));
  escrever(a.woods, 'package.json', '{"x":1}\n');
  await a.espelho.sincronizar();
  const r = await b.espelho.sincronizar();
  assert.equal(ler(b.woods, 'sites/lima-pet-salon/site.config.json'), null);
  assert.equal(r.pacotes, true);
});

test('três computadores mexendo em leads diferentes: tudo se junta em todos', async () => {
  const { pcs: [a, b, c] } = cenario(3);
  for (const pc of [a, b, c]) await pc.espelho.sincronizar();
  escrever(a.woods, 'sites/lead-a/site.config.json', 'A');
  escrever(b.woods, 'sites/lead-b/site.config.json', 'B');
  escrever(c.woods, 'sites/lead-c/site.config.json', 'C');
  await a.espelho.sincronizar();
  await b.espelho.sincronizar(); // junta com A e manda
  await c.espelho.sincronizar(); // junta com A+B e manda
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  for (const pc of [a, b, c]) {
    assert.deepEqual(['a', 'b', 'c'].map((l) => ler(pc.woods, `sites/lead-${l}/site.config.json`)), ['A', 'B', 'C']);
  }
});

test('commit feito pelo Claude num computador leva o HEAD dos outros junto; push do main continua funcionando', async () => {
  const { origem, pcs: [a, b] } = cenario();
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  escrever(a.woods, 'sites/lima-pet-salon/a/index.html', 'v1');
  git(a.woods, 'add', '-A');
  git(a.woods, 'commit', '-qm', 'lead: lima-pet-salon - variante A');
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  assert.equal(git(b.woods, 'rev-parse', 'HEAD'), git(a.woods, 'rev-parse', 'HEAD'));
  assert.equal(git(b.woods, 'status', '--porcelain'), '', 'pasta limpa: igual ao commit');
  // O notebook publica o lead (push do main), como faria o Claude depois do "aprovado"
  git(b.woods, 'push', '-q', 'origin', 'main');
  assert.equal(mainNoGithub(origem), git(a.woods, 'rev-parse', 'HEAD'));
  await b.espelho.sincronizar();
  await a.espelho.sincronizar();
  assert.equal(git(a.woods, 'status', '--porcelain'), '');
});

test('mesmo arquivo mudado nos dois: conflito sem estragar nada; dá para escolher a versão', async () => {
  const { pcs: [a, b] } = cenario();
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  escrever(a.woods, 'vault/20-leads/lima-pet-salon.md', 'versão do PC');
  escrever(b.woods, 'vault/20-leads/lima-pet-salon.md', 'versão do notebook');
  escrever(b.woods, 'sites/outro/x.txt', 'só no notebook');
  await a.espelho.sincronizar();
  const r = await b.espelho.sincronizar();
  assert.deepEqual(r.conflito.arquivos, ['vault/20-leads/lima-pet-salon.md']);
  assert.equal(ler(b.woods, 'vault/20-leads/lima-pet-salon.md'), 'versão do notebook', 'nada foi trocado');
  assert.equal(b.espelho.situacao().emDia, false);
  assert.ok(b.espelho.situacao().conflito);
  const outra = await b.espelho.sincronizar();
  assert.ok(outra.conflito, 'continua em conflito até escolher');

  await b.espelho.resolver('local');
  assert.equal(b.espelho.situacao().conflito, null);
  await a.espelho.sincronizar();
  assert.equal(ler(a.woods, 'vault/20-leads/lima-pet-salon.md'), 'versão do notebook');
  assert.equal(ler(a.woods, 'sites/outro/x.txt'), 'só no notebook');
});

test('resolver ficando com a nuvem guarda a versão local numa referência de backup', async () => {
  const { pcs: [a, b] } = cenario();
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  escrever(a.woods, 'vault/20-leads/lima-pet-salon.md', 'versão do PC');
  escrever(b.woods, 'vault/20-leads/lima-pet-salon.md', 'versão do notebook');
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  await b.espelho.resolver('nuvem');
  assert.equal(ler(b.woods, 'vault/20-leads/lima-pet-salon.md'), 'versão do PC');
  const backups = git(b.woods, 'for-each-ref', '--format=%(objectname)', 'refs/painel/backup/');
  assert.ok(backups);
  assert.equal(git(b.woods, 'show', `${backups.split('\n')[0]}:vault/20-leads/lima-pet-salon.md`), 'versão do notebook');
});

test('commits diferentes nos dois computadores (offline): conflito de histórico, resolvível', async () => {
  const { pcs: [a, b] } = cenario();
  await a.espelho.sincronizar();
  await b.espelho.sincronizar();
  escrever(a.woods, 'sites/l1/x', '1');
  git(a.woods, 'add', '-A');
  git(a.woods, 'commit', '-qm', 'no PC');
  escrever(b.woods, 'sites/l2/x', '2');
  git(b.woods, 'add', '-A');
  git(b.woods, 'commit', '-qm', 'no notebook');
  await a.espelho.sincronizar();
  const r = await b.espelho.sincronizar();
  assert.match(r.conflito.motivo, /commits diferentes/);
  await b.espelho.resolver('local');
  await a.espelho.sincronizar();
  assert.equal(git(a.woods, 'rev-parse', 'HEAD'), git(b.woods, 'rev-parse', 'HEAD'));
  assert.equal(ler(a.woods, 'sites/l2/x'), '2');
});

test('notebook com trabalho antigo próprio entra no espelho pela primeira vez sem perder nada', async () => {
  const { pcs: [a, b] } = cenario();
  escrever(a.woods, 'sites/do-pc/x', 'pc');
  await a.espelho.sincronizar();
  escrever(b.woods, 'sites/do-notebook/x', 'nb'); // trabalho que já existia antes de ligar a sincronização
  await b.espelho.sincronizar();
  assert.equal(ler(b.woods, 'sites/do-pc/x'), 'pc');
  assert.equal(ler(b.woods, 'sites/do-notebook/x'), 'nb');
  await a.espelho.sincronizar();
  assert.equal(ler(a.woods, 'sites/do-notebook/x'), 'nb');
});

test('GitHub recusa refs/painel/*: passa a usar o branch painel-espelho', async () => {
  const { origem, pcs: [a, b] } = cenario();
  escrever(origem, 'hooks/pre-receive', '#!/bin/sh\nwhile read velho novo ref; do case "$ref" in refs/heads/*) ;; *) echo "recusado"; exit 1;; esac; done\n');
  fs.chmodSync(path.join(origem, 'hooks/pre-receive'), 0o755);
  escrever(a.woods, 'sites/x/y', 'z');
  await a.espelho.sincronizar();
  assert.equal(a.espelho.situacao().referencia, REF_RAMO);
  assert.ok(git(origem, 'rev-parse', REF_RAMO));
  // O outro computador também troca na primeira tentativa de envio e acha a foto
  escrever(b.woods, 'sites/w/y', 'k');
  await b.espelho.sincronizar();
  await b.espelho.sincronizar();
  assert.equal(ler(b.woods, 'sites/x/y'), 'z');
});

test('erros do git viram mensagens claras', async () => {
  assert.equal(classificar('fatal: Authentication failed for https://github.com/rodrgo07/WOODS').tipo, 'login');
  assert.equal(classificar('fatal: unable to access ...: Could not resolve host: github.com').tipo, 'rede');
  assert.equal(classificar('fatal: algo estranho').tipo, 'outro');
  assert.deepEqual(leadsDe(['sites/a-b/x', 'vault/20-leads/c.md', 'template/x', 'sites/Errado/x']).sort(), ['a-b', 'c']);
  const { pcs: [a] } = cenario(1);
  git(a.woods, 'remote', 'set-url', 'origin', path.join(tmp(), 'nao-existe.git'));
  await assert.rejects(a.espelho.sincronizar(), (e) => e.tipo === 'outro');
  assert.equal(a.espelho.situacao().emDia, false);
});
