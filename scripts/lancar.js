/*
 * Lança uma versão nova do app:   npm run lancar
 *   1. Suba a versão no package.json antes (npm version 1.1.0 --no-git-tag-version), faça commit e push.
 *   2. Este script gera o instalador e cria o release v<versão> como rascunho no GitHub, com o latest.yml.
 *   3. Escreva as notas no GitHub e clique em Publish: a partir daí os apps instalados baixam a versão sozinhos.
 * Precisa do GitHub CLI (gh) logado na conta dona do repositório.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const RAIZ = path.resolve(import.meta.dirname, '..');
const REPO = 'rodrgo07/Painel-Woods';
const { version } = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const tag = `v${version}`;
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let existe = true;
try { sh('gh', ['release', 'view', tag, '-R', REPO]); } catch { existe = false; }
if (existe) throw new Error(`O release ${tag} já existe. Suba a versão no package.json.`);
if (sh('git', ['status', '--porcelain'])) throw new Error('Há mudanças sem commit. O release precisa sair de um commit que está no GitHub.');
const commit = sh('git', ['rev-parse', 'HEAD']);
if (!sh('git', ['branch', '-r', '--contains', commit])) throw new Error('Faça push do commit antes de lançar.');

execSync('npm run dist', { cwd: RAIZ, stdio: 'inherit' });

const arquivos = [`Painel-Woods-Setup-${version}.exe`, `Painel-Woods-Setup-${version}.exe.blockmap`, `Painel-Woods-${version}-portable.exe`, 'latest.yml']
  .map((a) => path.join(RAIZ, 'dist', a)).filter((a) => fs.existsSync(a));
if (!arquivos.some((a) => a.endsWith('latest.yml'))) throw new Error('O build não gerou o dist/latest.yml: sem ele o app não acha a versão.');

const url = sh('gh', ['release', 'create', tag, ...arquivos, '-R', REPO, '--target', commit, '--draft',
  '--title', `Painel Woods ${version}`, '--notes', '']);
console.log(`\nRascunho criado: ${url}\nEscreva o que mudou e clique em Publish release. Os apps instalados atualizam depois disso.`);
