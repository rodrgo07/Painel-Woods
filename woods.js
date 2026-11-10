/*
 * O repositório WOODS e as ferramentas que o app carrega (vendor/): checagens, navegador dos prints,
 * git (clonar, atualizar) e npm. Sem Electron aqui.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// WOODS_REPO: só para quem desenvolve (.env), por exemplo um clone local nos testes
const repo = () => process.env.WOODS_REPO || 'https://github.com/rodrgo07/WOODS';

/** O que já existe na pasta do WOODS */
export function checar(dir) {
  const tem = (...p) => fs.existsSync(path.join(dir, ...p));
  return {
    clonado: tem('scripts', 'novo-lead.js') && tem('vault', '20-leads'),
    deps: tem('node_modules', 'sharp', 'package.json'),
  };
}

// ---------- Navegador dos prints e do Playwright ----------
const PF = process.env.ProgramFiles || 'C:/Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
const EXES = {
  chrome: [`${PF}/Google/Chrome/Application/chrome.exe`, `${PF86}/Google/Chrome/Application/chrome.exe`,
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`].map(path.normalize),
  edge: [`${PF86}/Microsoft/Edge/Application/msedge.exe`, `${PF}/Microsoft/Edge/Application/msedge.exe`].map(path.normalize),
};

// Chromium baixado pelo Playwright em `pasta`: chromium-<revisão>/chrome-win64/chrome.exe
function chromiumBaixado(pasta) {
  try {
    for (const d of fs.readdirSync(pasta)) {
      if (!d.startsWith('chromium-')) continue;
      for (const sub of ['chrome-win64', 'chrome-win']) {
        const exe = path.join(pasta, d, sub, 'chrome.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch { /* pasta ainda não existe */ }
  return '';
}

/** { tipo, exe }: o navegador escolhido; senão Chrome, Edge ou o Chromium baixado (mesma ordem do scripts/prints.js) */
export function acharNavegador(preferido, pastaChromium, existe = fs.existsSync) {
  const ordem = [...new Set([preferido, 'chrome', 'edge'])].filter((t) => EXES[t]);
  for (const tipo of ordem) {
    const exe = EXES[tipo].find((f) => existe(f));
    if (exe) return { tipo, exe };
  }
  const exe = chromiumBaixado(pastaChromium);
  return exe ? { tipo: 'chromium', exe } : { tipo: '', exe: '' };
}

// ---------- Ferramentas embutidas ----------
export const ferramentas = (vendor) => ({
  node: path.join(vendor, 'node', 'node.exe'),
  npm: path.join(vendor, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  git: path.join(vendor, 'git', 'cmd', 'git.exe'),
  bash: path.join(vendor, 'git', 'bin', 'bash.exe'),
});

/** Ambiente dos processos filhos (Claude, git, npm, scripts do WOODS): Node e Git do app na frente do PATH */
export function ambiente({ vendor, navegador, pastaChromium, cfg, chave }) {
  const env = { ...process.env };
  const k = Object.keys(env).find((n) => n.toUpperCase() === 'PATH') || 'PATH'; // no Windows a chave costuma ser "Path"
  env[k] = [path.join(vendor, 'node'), path.join(vendor, 'git', 'cmd'), env[k]].filter(Boolean).join(path.delimiter);
  env.CLAUDE_CODE_GIT_BASH_PATH = ferramentas(vendor).bash;
  env.GIT_TERMINAL_PROMPT = '0'; // sem terminal: quem pede o login é a janela do Credential Manager
  env.PLAYWRIGHT_BROWSERS_PATH = pastaChromium;
  if (navegador) env.CHROME = navegador; // lido pelo scripts/prints.js do WOODS
  if (cfg.gitNome) env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = cfg.gitNome;
  if (cfg.gitEmail) env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = cfg.gitEmail;
  if (chave) env.ANTHROPIC_API_KEY = chave;
  return env;
}

// ---------- Processos ----------
const filhos = new Set();
/** Guarda o processo para o app conseguir encerrar tudo ao fechar */
export function acompanhar(p) {
  filhos.add(p);
  p.once('exit', () => filhos.delete(p));
  return p;
}
/** Derruba o processo e o que ele abriu (Claude → Playwright → navegador, npm → node) */
export function matar(p) {
  if (p.pid && p.exitCode === null) spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true });
}
export function matarFilhos() {
  filhos.forEach(matar);
  filhos.clear();
}

/** Roda um comando e devolve o stdout. Cada linha de saída passa por aoLer. Código ≠ 0 rejeita com o fim da saída */
export function rodar(cmd, args, { cwd, env, aoLer = () => {} } = {}) {
  return new Promise((ok, erro) => {
    const p = acompanhar(spawn(cmd, args, { cwd, env, windowsHide: true }));
    let saida = '';
    let fim = '';
    const ler = (d) => {
      fim = (fim + d).slice(-2000);
      for (const l of String(d).split(/[\r\n]+/)) if (l.trim()) aoLer(l.trim());
    };
    p.stdout.on('data', (d) => { saida = (saida + d).slice(-100_000); ler(d); });
    p.stderr.on('data', ler);
    p.on('error', (e) => erro(new Error(`Não consegui abrir ${path.basename(cmd)}: ${e.message}`)));
    p.on('close', (cod) => (cod === 0 ? ok(saida) : erro(new Error(fim.trim() || `${path.basename(cmd)} saiu com o código ${cod}`))));
  });
}

// ---------- Git e npm no WOODS (o = { git, node, npm, env, aoLer }) ----------
/** Confere o acesso ao repositório. Se precisar de login, o Credential Manager abre a janela do GitHub */
export const acesso = (o) => rodar(o.git, ['ls-remote', repo(), 'HEAD'], o);

export async function clonar(dir, o) {
  // Sobra de um clone interrompido (só o .git) pode sair. Pasta com qualquer outra coisa, nunca.
  if (fs.existsSync(dir) && fs.readdirSync(dir).every((f) => f === '.git')) fs.rmSync(dir, { recursive: true, force: true });
  await rodar(o.git, ['clone', '--progress', repo(), dir], o);
}

export const instalar = (dir, o) => rodar(o.node, [o.npm, 'ci', '--no-audit', '--no-fund'], { ...o, cwd: dir });

/** Quantos commits o GitHub tem a mais */
export async function novidades(dir, o) {
  await rodar(o.git, ['fetch', '--quiet'], { ...o, cwd: dir });
  return Number((await rodar(o.git, ['rev-list', '--count', 'HEAD..@{u}'], { ...o, cwd: dir })).trim()) || 0;
}

/** Puxa as novidades só avançando (ff-only): se bater com trabalho local, o git recusa e nada muda */
export async function atualizar(dir, o) {
  const g = (...a) => rodar(o.git, a, { ...o, cwd: dir });
  await g('fetch', '--quiet');
  const antes = (await g('rev-parse', 'HEAD')).trim();
  try {
    await g('merge', '--ff-only', '@{u}');
  } catch (e) {
    throw new Error(/would be overwritten|fast-forward|diverg/i.test(e.message)
      ? `O WOODS tem trabalho local que bate com a atualização. Nada foi alterado: publique o lead em andamento pelo Claude e tente de novo.\n\n${e.message}`
      : e.message);
  }
  return {
    commits: Number((await g('rev-list', '--count', `${antes}..HEAD`)).trim()) || 0,
    deps: Boolean((await g('diff', '--name-only', antes, 'HEAD', '--', 'package.json', 'package-lock.json')).trim()),
  };
}
