/*
 * Painel Woods: aplicativo de Windows (Electron) para o repositório WOODS.
 *   npm start     → abre o app em modo de desenvolvimento
 *   npm run dist  → gera o instalador e o portátil em dist/
 * Aqui ficam a janela, o protocolo painel:// (a página e a prévia dos sites), as ações que a página pode pedir
 * e o fim dos processos ao fechar. Leads e Claude: painel.js. WOODS e ferramentas embutidas: woods.js.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, dialog, ipcMain, net, powerMonitor, protocol, safeStorage, session, shell } from 'electron';
import * as painel from './painel.js';
import * as woods from './woods.js';
import { MODELOS, validar, ler, salvar, caminhoSeguro, importarConversas, limpar, iniciarLog, registrar, maisNova } from './nucleo.js';
import { SLUG_OK } from './public/util.js';
import { criarServico } from './sincronia/servico.js';

const AQUI = import.meta.dirname;
if (!app.isPackaged) { try { process.loadEnvFile(path.join(AQUI, '.env')); } catch { /* .env é opcional, só para quem desenvolve */ } }

// Tudo do usuário em %APPDATA%\PainelWoods. Nada é gravado na pasta de instalação.
app.setPath('userData', process.env.PAINEL_DADOS || path.join(app.getPath('appData'), 'PainelWoods'));
// Uma instância só: a segunda avisa a primeira (evento second-instance) e sai
if (!app.requestSingleInstanceLock()) process.exit(0);

const DADOS = app.getPath('userData');
const LOGS = path.join(DADOS, 'logs');
const CONFIG = path.join(DADOS, 'config.json');
const CHROMIUM = path.join(DADOS, 'navegadores');
const WOODS = path.resolve(process.env.WOODS_DIR || path.join(DADOS, 'WOODS'));
const PUBLICO = path.join(AQUI, 'public');
// No app instalado, o que precisa ser executado fica fora do app.asar
const RECURSOS = app.isPackaged ? process.resourcesPath : AQUI;
const VENDOR = path.join(RECURSOS, 'vendor');
const MODULOS = path.join(app.isPackaged ? path.join(RECURSOS, 'app.asar.unpacked') : AQUI, 'node_modules');
const CLAUDE = path.join(MODULOS, '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');
const F = woods.ferramentas(VENDOR);

fs.mkdirSync(path.join(DADOS, 'conversas'), { recursive: true });
iniciarLog(LOGS);
process.on('uncaughtException', (e) => registrar(`erro não tratado: ${e.stack || e}`));
process.on('unhandledRejection', (e) => registrar(`promessa rejeitada: ${e?.stack || e}`));

let cfg = ler(CONFIG);
let win = null;
let tarefa = '';   // tarefa longa em andamento (baixar, instalar, atualizar)
let novidades = 0; // commits novos do WOODS no GitHub que não deu para puxar sozinho
let versaoNova = null; // { versao, url }: release do Painel Woods mais nova que esta

// ---------- Claude, navegador e ambiente dos processos ----------
/** Chave da API, guardada cifrada (DPAPI). Só existe em memória e no ambiente do Claude */
function chave() {
  try { return cfg.chaveApi ? safeStorage.decryptString(Buffer.from(cfg.chaveApi, 'base64')) : ''; } catch { return ''; }
}
const temLogin = () => Boolean(chave() || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
  || fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json')));
const navegador = () => woods.acharNavegador(cfg.navegador, CHROMIUM);
const env = () => woods.ambiente({ vendor: VENDOR, navegador: navegador().exe, pastaChromium: CHROMIUM, cfg, chave: chave() });
const comGit = (aoLer) => ({ ...F, env: env(), aoLer });

// O Playwright MCP vai dentro do app, na versão fixada no package.json (nada de npx @latest)
const MCP_NAVEGADOR = { chrome: [], edge: ['--browser', 'msedge'], chromium: ['--browser', 'chromium'] };
painel.ctx.woods = WOODS;
painel.ctx.dados = DADOS;
painel.ctx.responsaveis = () => cfg.responsaveis;

/** git do app dentro do WOODS, sem janela de login (para ler datas de commit e o status) */
function gitWoods(args) {
  if (!woods.checar(WOODS).clonado) throw new Error('WOODS ainda não baixado');
  const r = spawnSync(F.git, args, {
    cwd: WOODS, env: { ...env(), GCM_INTERACTIVE: 'never' }, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 2 ** 20, timeout: 30_000,
  });
  if (r.error || r.status !== 0) throw new Error((r.error?.message || r.stderr || `git saiu com o código ${r.status}`).trim());
  return r.stdout;
}

// Woods Web: só lê o WOODS e o tipo dos eventos da conversa; a sessão do Supabase fica cifrada e nunca vai para a página
const nuvem = criarServico({
  dados: DADOS, woods: WOODS, fetch: (...a) => net.fetch(...a), git: gitWoods, versao: app.getVersion(), maquina: os.hostname(), registrar,
  cofre: {
    disponivel: () => safeStorage.isEncryptionAvailable(),
    cifrar: (t) => safeStorage.encryptString(t).toString('base64'),
    decifrar: (b) => (b ? safeStorage.decryptString(Buffer.from(b, 'base64')) : ''),
  },
});
painel.ctx.enviar = (slug, linha) => {
  if (win && !win.isDestroyed()) win.webContents.send('painel:evento', slug, linha);
  nuvem.aoEvento(slug, linha);
};
painel.ctx.opcoes = () => ({
  env: env(), modelo: cfg.modelo, claude: CLAUDE, node: F.node,
  mcp: { type: 'stdio', command: F.node, args: [path.join(MODULOS, '@playwright', 'mcp', 'cli.js'), ...(MCP_NAVEGADOR[navegador().tipo] || [])] },
});

/** O que falta para o painel funcionar. Lista vazia = pronto */
function faltas() {
  const w = woods.checar(WOODS);
  const falta = [];
  if (![F.node, F.git, CLAUDE].every((f) => fs.existsSync(f))) falta.push('as ferramentas do app (rode npm run ferramentas)');
  if (!navegador().exe) falta.push('um navegador para os prints');
  if (!w.clonado) falta.push('baixar o WOODS');
  else if (!w.deps) falta.push('instalar as dependências do WOODS');
  if (!temLogin()) falta.push('o login do Claude');
  if (!cfg.gitNome || !cfg.gitEmail) falta.push('o nome e o e-mail dos commits');
  return falta;
}

/** Tarefa longa: uma por vez e nunca com o Claude mexendo no WOODS. avisar(título) devolve o aoLer que mostra o progresso */
async function longa(nome, fn) {
  if (tarefa) throw new Error(`Espere terminar: ${tarefa}.`);
  if (painel.rodando()) throw new Error(painel.ocupado());
  tarefa = nome;
  const avisar = (titulo) => {
    const aoLer = (linha = '') => painel.ctx.enviar('', JSON.stringify({
      t: 'progresso', titulo, linha: limpar(linha).slice(0, 300), pct: Number(linha.match(/(\d+)%/)?.[1] ?? -1),
    }));
    aoLer(); // mostra o título já: o npm pode ficar um tempo sem escrever nada
    return aoLer;
  };
  try {
    return await fn(avisar);
  } finally {
    tarefa = '';
    painel.ctx.enviar('', JSON.stringify({ t: 'progresso', fim: true }));
  }
}

function exigirPronto() {
  if (tarefa) throw new Error(`Espere terminar: ${tarefa}.`);
  const falta = faltas();
  if (falta.length) throw new Error(`Termine a configuração. Falta: ${falta.join(', ')}.`);
}

// ---------- Ações que a página pode pedir (lista fixa) ----------
const ACOES = {
  inicio() {
    const w = woods.checar(WOODS);
    return {
      versao: app.getVersion(), pasta: WOODS, ...w, navegador: navegador().exe,
      temLogin: temLogin(), temChave: Boolean(cfg.chaveApi), falta: faltas(), novidades, tarefa, versaoNova,
      config: { modelo: cfg.modelo, gitNome: cfg.gitNome, gitEmail: cfg.gitEmail, navegador: cfg.navegador, responsaveis: cfg.responsaveis },
      modelos: MODELOS, eu: nuvem.situacao().nome || '',
      rodando: painel.rodando(), leads: w.clonado ? painel.leads() : [],
    };
  },
  lead: ({ slug }) => painel.lead(slug, true),
  eventos: ({ slug }) => painel.eventos(slug),
  criar(d) { exigirPronto(); return painel.criar(d); },
  mensagem(d) { exigirPronto(); painel.mensagem(d); },
  parar: (d) => painel.parar(d),
  /** Antes de criar ou mandar: o lead já existe na equipe? alguém está com o Claude nele? (null = sem como saber) */
  equipeLead: ({ slug }) => (SLUG_OK.test(slug ?? '') ? nuvem.consultar(slug) : null),
  permissao: (d) => painel.permissao(d),

  // Primeira execução e configurações
  checar: async () => ({
    internet: await net.fetch('https://github.com', { method: 'HEAD', signal: AbortSignal.timeout(8000) }).then((r) => r.ok, () => false),
    livreGb: Math.floor(fs.statfsSync(DADOS).bavail * fs.statfsSync(DADOS).bsize / 2 ** 30),
  }),
  github: () => longa('Conferindo o acesso ao GitHub', async (avisar) => {
    await woods.acesso(comGit(avisar('Conferindo o acesso ao GitHub')));
  }),
  baixarWoods: () => longa('Baixando o WOODS', async (avisar) => {
    if (!woods.checar(WOODS).clonado) await woods.clonar(WOODS, comGit(avisar('Baixando o WOODS')));
    await woods.instalar(WOODS, comGit(avisar('Instalando as dependências do WOODS')));
  }),
  atualizar: () => longa('Atualizando o WOODS', async (avisar) => {
    const r = await woods.atualizar(WOODS, comGit(avisar('Atualizando o WOODS')));
    novidades = 0;
    if (r.deps || !woods.checar(WOODS).deps) await woods.instalar(WOODS, comGit(avisar('Instalando as dependências do WOODS')));
    return r;
  }),
  baixarChromium: () => longa('Baixando o Chromium', async (avisar) => {
    await woods.rodar(F.node, [path.join(MODULOS, 'playwright-core', 'cli.js'), 'install', '--no-shell', 'chromium'],
      { env: env(), aoLer: avisar('Baixando o Chromium') });
  }),
  loginClaude() {
    if (!fs.existsSync(CLAUDE)) throw new Error('Não achei o claude.exe do app.');
    // `start` abre o login numa janela de terminal própria, que mostra o link e espera o navegador
    spawn('cmd.exe', ['/c', 'start', 'Login do Claude', CLAUDE, 'auth', 'login'], { stdio: 'ignore', windowsHide: true, env: env() });
  },
  salvarConfig(d) {
    const novo = validar({ ...cfg, ...d, chaveApi: cfg.chaveApi });
    if ('responsaveis' in d && !String(d.responsaveis).trim()) throw new Error('Informe pelo menos um responsável');
    if (d.gitEmail && !novo.gitEmail) throw new Error('E-mail inválido');
    cfg = salvar(CONFIG, novo);
  },
  salvarChave({ chave: nova = '' }) {
    nova = String(nova).trim();
    if (nova && !/^sk-ant-[\w-]{20,}$/.test(nova)) throw new Error('Isso não parece uma chave da API da Anthropic (ela começa com sk-ant-).');
    if (nova && !safeStorage.isEncryptionAvailable()) throw new Error('O Windows não liberou o cofre (DPAPI) para guardar a chave.');
    cfg = salvar(CONFIG, { ...cfg, chaveApi: nova ? safeStorage.encryptString(nova).toString('base64') : '' });
  },
  /** Copia as conversas (<slug>.jsonl) da pasta "dados" de uma instalação antiga. Não troca as que já existem aqui */
  async importar() {
    const antiga = [app.getPath('documents'), app.getPath('desktop')]
      .map((p) => path.join(p, 'Painel Woods', 'dados')).find((p) => fs.existsSync(p));
    const r = await dialog.showOpenDialog(win, { title: 'Escolha a pasta "dados" da instalação antiga', defaultPath: antiga, properties: ['openDirectory'] });
    return { importadas: r.canceled ? -1 : importarConversas(r.filePaths[0], path.join(DADOS, 'conversas')) };
  },
  abrirLogs() { shell.openPath(LOGS); },

  // Woods Web (Supabase): a senha só passa por aqui para entrar; fica guardado só o token de renovação, cifrado
  nuvem: () => nuvem.situacao(),
  nuvemConectar: (d) => nuvem.conectar(d),
  nuvemDesconectar: () => nuvem.desconectar(),
  nuvemSincronizar: () => nuvem.agora(),
};

ipcMain.handle('painel', async (e, acao, dados) => {
  try {
    // Só a página do painel pede ações: a prévia dos sites dos leads fica em outra origem
    if (!e.senderFrame?.url.startsWith('painel://app/') || !Object.hasOwn(ACOES, acao)) throw new Error('Pedido não permitido');
    return { ok: await ACOES[acao](dados ?? {}) };
  } catch (err) {
    registrar(`${acao}: ${err.stack || err}`);
    return { erro: limpar(err.message) };
  }
});

// ---------- painel://app (a página) e painel://site/<slug>/dist|prints (prévia), em origens separadas ----------
protocol.registerSchemesAsPrivileged([{ scheme: 'painel', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

function servir(req) {
  try {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    let arq = null;
    if (u.host === 'app') arq = caminhoSeguro(PUBLICO, p.length ? p : ['index.html']);
    else if (u.host === 'site' && painel.existe(p[0]) && ['dist', 'prints'].includes(p[1])) arq = caminhoSeguro(painel.pastaLead(p[0]), p.slice(1));
    if (arq) return net.fetch(pathToFileURL(arq).href);
  } catch (e) {
    registrar(`servir ${req.url}: ${e.message}`);
  }
  return new Response('Não encontrado', { status: 404 });
}

/** Links saem do painel: sites no navegador do Windows, prévia numa janela simples sem acesso ao app */
function abrirFora(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  else if (url.startsWith('painel://site/')) {
    new BrowserWindow({ width: 1280, height: 860, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { sandbox: true } }).loadURL(url);
  }
}

app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => { abrirFora(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (wc === win?.webContents && !url.startsWith('painel://app/')) e.preventDefault(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
// Ao fechar: para a conversa e derruba o Claude, o Playwright e qualquer git ou npm em andamento
app.on('will-quit', () => { painel.encerrar(); woods.matarFilhos(); nuvem.parar(); });

app.whenReady().then(() => {
  protocol.handle('painel', servir);
  session.defaultSession.setPermissionRequestHandler((_wc, _permissao, responder) => responder(false)); // câmera, local etc.: nunca
  if (app.isPackaged) Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 390, minHeight: 560, backgroundColor: '#0b0b0b', autoHideMenuBar: true,
    webPreferences: { preload: path.join(AQUI, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.on('closed', () => app.quit());
  win.loadURL('painel://app/');
  nuvem.iniciar();
  powerMonitor.on('resume', () => { nuvem.agora(); }); // o PC acordou: tenta o que ficou pendente
  // WOODS em dia sozinho: ao abrir e a cada 10 min, com o Claude parado
  puxarSozinho();
  setInterval(puxarSozinho, 10 * 60_000).unref?.();
  conferirVersao();
  setInterval(conferirVersao, 6 * 3600_000).unref?.();
});

/**
 * Puxa as novidades do WOODS sem pedir nada: só com o Claude parado, só avançando (ff-only, nunca mexe em trabalho
 * local) e sem janela de login. Se as dependências mudaram, ou se bater com trabalho local, fica o aviso e o botão
 * Atualizar das configurações, como antes.
 */
async function puxarSozinho() {
  if (tarefa || painel.rodando() || !woods.checar(WOODS).clonado) return;
  const o = { ...F, env: { ...env(), GCM_INTERACTIVE: 'never' } };
  try {
    novidades = await woods.novidades(WOODS, o);
    if (!novidades || await woods.mudaDependencias(WOODS, o)) return;
    if (tarefa || painel.rodando()) return; // o Claude começou enquanto o git conferia
    tarefa = 'Atualizando o WOODS';
    try {
      const r = await woods.atualizar(WOODS, o);
      novidades = 0;
      registrar(`WOODS atualizado sozinho: ${r.commits} commit(s)`);
    } finally {
      tarefa = '';
    }
    nuvem.agora(); // o que o sócio publicou aparece no Woods Web com as datas certas
  } catch (e) {
    registrar(`atualização automática do WOODS: ${e.message}`);
  }
}

/** Release nova do Painel Woods no GitHub: só avisa (o instalador novo é baixado pelo navegador) */
async function conferirVersao() {
  try {
    const r = await net.fetch('https://api.github.com/repos/rodrgo07/Painel-Woods/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return; // sem release publicada ou sem internet
    const j = await r.json();
    const url = String(j.html_url || '');
    if (maisNova(String(j.tag_name || ''), app.getVersion()) && url.startsWith('https://github.com/')) {
      versaoNova = { versao: String(j.tag_name).replace(/^v/, ''), url };
    }
  } catch (e) {
    registrar(`versão nova: ${e.message}`);
  }
}
