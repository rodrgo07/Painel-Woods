/*
 * Baixa as ferramentas que vão dentro do app, em vendor/:   npm run ferramentas
 *   - Node: roda os scripts do WOODS e o npm (o Claude chama `npm run build` no Bash).
 *   - PortableGit: o git de verdade (commit, push, Credential Manager) e o Bash que o Claude Code usa.
 * Cada download é conferido com o SHA-256 publicado pelo site oficial. Para atualizar, troque versão e hash.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const VENDOR = path.resolve(import.meta.dirname, '..', 'vendor');
const NODE = 'v22.23.4';
const GIT = '2.56.0.4'; // tag v2.56.0.windows.4

const ITENS = [
  {
    pronto: 'node/node.exe',
    url: `https://nodejs.org/dist/${NODE}/node-${NODE}-win-x64.zip`,
    sha256: 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20',
    extrair(arq) {
      // tar do Windows (bsdtar) abre zip; o do Git Bash não
      execFileSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xf', arq, '-C', VENDOR]);
      fs.renameSync(path.join(VENDOR, `node-${NODE}-win-x64`), path.join(VENDOR, 'node'));
    },
  },
  {
    pronto: 'git/cmd/git.exe',
    url: `https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/PortableGit-${GIT}-64-bit.7z.exe`,
    sha256: 'b1f3e52216e2ed6882d1bebfd4d3fdf319bec40d2edbbf9fd26ec4fd3fce7ed1',
    extrair: (arq) => execFileSync(arq, ['-y', `-o${path.join(VENDOR, 'git')}`]), // autoextraível 7z
  },
];

fs.mkdirSync(VENDOR, { recursive: true });
for (const item of ITENS) {
  if (fs.existsSync(path.join(VENDOR, item.pronto))) { console.log(`✔ ${item.pronto} (já existe)`); continue; }
  console.log(`Baixando ${item.url}`);
  const r = await fetch(item.url);
  if (!r.ok) throw new Error(`${item.url}: HTTP ${r.status}`);
  const dados = Buffer.from(await r.arrayBuffer());
  const hash = crypto.createHash('sha256').update(dados).digest('hex');
  if (hash !== item.sha256) throw new Error(`SHA-256 não confere em ${item.url}\n  esperado ${item.sha256}\n  veio     ${hash}`);
  const arq = path.join(VENDOR, path.basename(item.url));
  fs.writeFileSync(arq, dados);
  item.extrair(arq);
  fs.rmSync(arq);
  console.log(`✔ ${item.pronto}`);
}

// O PortableGit vem com um seletor de credencial que abre uma janela perguntando qual usar.
// Fixa o Credential Manager: login do GitHub pelo navegador, token no Cofre de Credenciais do Windows.
const gitconfig = path.join(VENDOR, 'git', 'etc', 'gitconfig');
fs.writeFileSync(gitconfig, fs.readFileSync(gitconfig, 'utf8').replace('helper = helper-selector', 'helper = manager'));
