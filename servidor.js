/*
 * Painel Woods: interface local para o repositório WOODS.
 *   npm start → http://localhost:4300
 * Cada lead tem uma sessão própria do Claude (Agent SDK = Claude Code), rodando dentro do WOODS
 * com o CLAUDE.md e o fluxo de lá. Um lead por vez, porque o navegador do Playwright é um só.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { slugar, SLUG_OK, lerFicha, resumir } from './public/util.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(AQUI, 'public');
const DADOS = path.join(AQUI, 'dados');
const SESSOES = path.join(DADOS, 'sessoes.json');
const WOODS = path.resolve(process.env.WOODS_DIR || path.join(os.homedir(), 'Documents', 'WOODS'));
const PORTA = Number(process.env.PORTA) || 4300;
const MODELO = process.env.CLAUDE_MODELO || 'claude-opus-5-5';
const PRINTS = ['a-390', 'b-390', 'a-1440', 'b-1440'];
const RESPONSAVEIS = ['R Host', 'L Host'];

if (!fs.existsSync(path.join(WOODS, 'scripts', 'novo-lead.js'))) {
  console.error(`Não achei o WOODS em ${WOODS}. Defina WOODS_DIR no .env.`);
  process.exit(1);
}
fs.mkdirSync(DADOS, { recursive: true });
const temLogin = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
  || fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json')));

// ---------- Leads (lidos direto do WOODS) ----------
const pastaLead = (slug) => path.join(WOODS, 'sites', slug);
const fichaLead = (slug) => path.join(WOODS, 'vault', '20-leads', `${slug}.md`);
const mtime = (f) => Math.round(fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs || 0);
const lerSessoes = () => (fs.existsSync(SESSOES) ? JSON.parse(fs.readFileSync(SESSOES, 'utf8')) : {});
function salvarSessao(slug, id) {
  const s = lerSessoes();
  if (id) s[slug] = id; else delete s[slug];
  fs.writeFileSync(SESSOES, JSON.stringify(s, null, 2));
}

function lead(slug, comFicha = false) {
  const md = fs.readFileSync(fichaLead(slug), 'utf8');
  const f = lerFicha(md);
  const dist = path.join(pastaLead(slug), 'dist');
  return {
    slug, ...f, nome: f.nome || slug,
    atualizado: mtime(fichaLead(slug)),
    site: { a: fs.existsSync(path.join(dist, 'a', 'index.html')), b: fs.existsSync(path.join(dist, 'b', 'index.html')) },
    prints: PRINTS.map((nome) => ({ nome, v: mtime(path.join(pastaLead(slug), 'prints', `${nome}.jpg`)) })).filter((p) => p.v),
    temSessao: Boolean(lerSessoes()[slug]),
    ficha: comFicha ? md : undefined,
  };
}

const leads = () => fs.readdirSync(path.join(WOODS, 'vault', '20-leads'))
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .map((f) => lead(f.slice(0, -3)))
  .sort((a, b) => b.atualizado - a.atualizado);

// ---------- Eventos de cada lead (histórico em dados/<slug>.jsonl + SSE ao vivo) ----------
const ouvintes = new Map();
const logLead = (slug) => path.join(DADOS, `${slug}.jsonl`);
function emitir(slug, ev) {
  const linha = JSON.stringify({ ...ev, em: Date.now() });
  if (ev.t !== 'estado') fs.appendFileSync(logLead(slug), linha + '\n');
  for (const res of ouvintes.get(slug) || []) res.write(`data: ${linha}\n\n`);
}

// ---------- Claude ----------
const INSTRUCOES = `
Você está rodando pelo Painel Woods, uma interface web. O responsável lê suas mensagens no painel e responde por lá, sem terminal.
- Quando precisar dele (login no Instagram ou no Cloudflare na janela do navegador do Playwright, captcha, dado que falta, aprovação dos prints), diga em uma ou duas frases o que ele tem que fazer e termine o turno. A resposta chega como a próxima mensagem.
- O painel mostra a prévia de sites/<slug>/dist/a e dist/b, os prints de sites/<slug>/prints/ e a ficha. Depois de mudar o site, rode \`npm run build -- <slug>\` e \`npm run prints -- <slug>\` para o painel mostrar a versão nova.
- Não rode \`npm run servir\`: o painel já serve a prévia.
- Comandos fora da lista liberada pedem permissão no painel. Se o responsável negar, siga sem ele ou explique o que falta.
- Responda em português do Brasil, curto e direto.`;

// Liberados sem perguntar. Todo o resto (inclusive git push) pede permissão no painel.
const PERMITIDAS = [
  'mcp__playwright', 'WebFetch', 'WebSearch',
  'Bash(npm run build *)', 'Bash(npm run prints *)', 'Bash(npm run teste)',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git add *)', 'Bash(git commit *)',
  'Bash(curl *)', 'Bash(mkdir *)',
];
// O Playwright usa o Chrome; sem ele, o Edge que vem no Windows (mesma ordem do scripts/prints.js)
const WIN = process.platform === 'win32';
const SEM_CHROME = WIN && !['C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe')].some((f) => fs.existsSync(f));
const PLAYWRIGHT = {
  type: 'stdio',
  command: WIN ? 'cmd' : 'npx',
  args: [...(WIN ? ['/c', 'npx'] : []), '-y', '@playwright/mcp@latest', ...(SEM_CHROME ? ['--browser', 'msedge'] : [])],
};

let trabalho = null; // { slug, abort, pendentes: Map<id, responder> }

async function rodar(slug, texto) {
  const resume = lerSessoes()[slug];
  const t = trabalho = { slug, abort: new AbortController(), pendentes: new Map() };
  emitir(slug, { t: 'eu', texto });
  emitir(slug, { t: 'estado', rodando: true });

  const pedirPermissao = (nome, entrada, { signal, suggestions }) => new Promise((ok) => {
    const id = crypto.randomUUID();
    const responder = (sim, sempre) => {
      if (!t.pendentes.delete(id)) return;
      emitir(slug, { t: 'resposta', id, ok: sim });
      ok(sim
        ? { behavior: 'allow', updatedInput: entrada, ...(sempre && suggestions ? { updatedPermissions: suggestions } : {}) }
        : { behavior: 'deny', message: 'O responsável negou pelo painel.' });
    };
    t.pendentes.set(id, responder);
    signal.addEventListener('abort', () => responder(false), { once: true });
    emitir(slug, { t: 'permissao', id, ...resumir(nome, entrada, WOODS) });
  });

  let teveResultado = false;
  try {
    const prompt = resume ? texto : `Lead \`${slug}\` (ficha: vault/20-leads/${slug}.md).\n\n${texto}`;
    const q = query({
      prompt,
      options: {
        cwd: WOODS,
        model: MODELO,
        resume,
        abortController: t.abort,
        settingSources: ['project'], // CLAUDE.md e .claude/ do WOODS
        systemPrompt: { type: 'preset', preset: 'claude_code', append: INSTRUCOES },
        mcpServers: { playwright: PLAYWRIGHT },
        permissionMode: 'acceptEdits',
        allowedTools: PERMITIDAS,
        disallowedTools: ['AskUserQuestion'], // perguntas vêm como texto, respondidas pelo painel
        canUseTool: pedirPermissao,
      },
    });
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') salvarSessao(slug, m.session_id);
      else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message.content) {
          if (b.type === 'text' && b.text.trim()) emitir(slug, { t: 'claude', texto: b.text });
          else if (b.type === 'tool_use' && b.name !== 'TodoWrite') emitir(slug, { t: 'ferramenta', ...resumir(b.name, b.input, WOODS) });
        }
      } else if (m.type === 'result') {
        teveResultado = true;
        emitir(slug, { t: 'fim', ok: !m.is_error, custo: m.total_cost_usd, erro: m.is_error ? (m.result || m.subtype) : '' });
      }
    }
  } catch (e) {
    // Sessão apagada pelo Claude Code (limpa as antigas): a próxima mensagem abre outra, que relê a ficha
    if (resume && /No conversation found/i.test(e.message)) salvarSessao(slug, undefined);
    // Resultado com erro já foi mostrado no 'fim'; o SDK lança de novo depois dele
    if (!teveResultado) emitir(slug, { t: 'erro', texto: t.abort.signal.aborted ? 'Parado pelo painel.' : e.message });
  } finally {
    for (const responder of t.pendentes.values()) responder(false);
    trabalho = null;
    emitir(slug, { t: 'estado', rodando: false, pendentes: [] });
  }
}

const ocupado = () => trabalho && `O Claude está trabalhando em ${trabalho.slug}. Espere terminar ou pare.`;

function promptNovoLead({ slug, nome, instagram, cidade, responsavel, obs }) {
  return `Novo lead pelo painel.
- Nome do negócio: ${nome}
- Instagram: ${instagram}
- Cidade: ${cidade || 'descobrir na pesquisa'}
- Responsável: ${responsavel}${obs ? `\n- Observações do responsável: ${obs}` : ''}

A etapa 0 do fluxo já foi feita pelo painel (\`npm run novo-lead\`): existem \`sites/${slug}/\` e \`vault/20-leads/${slug}.md\`. Anote o Instagram e a cidade na ficha.
Siga \`vault/00-sistema/fluxo-novo-lead.md\` da etapa 1 à 5: pesquisa no Google e no Instagram, conteúdo, visual próprio de A e B, SEO e revisão com os 4 prints. Pare na etapa 6 e avise que os prints estão prontos para aprovação.`;
}

// ---------- HTTP ----------
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const json = (res, codigo, dados) => res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(dados));

function arquivo(res, base, partes) {
  let arq = path.resolve(base, ...partes);
  if (arq !== base && !arq.startsWith(base + path.sep)) return json(res, 403, { erro: 'Fora da pasta' });
  if (fs.statSync(arq, { throwIfNoEntry: false })?.isDirectory()) arq = path.join(arq, 'index.html');
  if (!fs.statSync(arq, { throwIfNoEntry: false })?.isFile()) return json(res, 404, { erro: 'Não encontrado' });
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(arq).pipe(res);
}

async function corpo(req) {
  let txt = '';
  for await (const c of req) {
    txt += c;
    if (txt.length > 100_000) throw new Error('Mensagem grande demais');
  }
  return JSON.parse(txt || '{}');
}

const HOSTS = new Set([`localhost:${PORTA}`, `127.0.0.1:${PORTA}`]);

http.createServer(async (req, res) => {
  try {
    // Só este computador: o Claude roda comandos aqui. Bloqueia DNS rebinding e POST vindo de outros sites.
    if (!HOSTS.has(req.headers.host)) return json(res, 403, { erro: 'Host não permitido' });
    if (req.method === 'POST' && (!req.headers['content-type']?.startsWith('application/json')
      || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`))) return json(res, 403, { erro: 'Origem não permitida' });

    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/').filter(Boolean);
    const get = req.method === 'GET';

    if (get && p.length <= 1) return arquivo(res, PUBLICO, p.length ? p : ['index.html']);

    if (p[0] === 'api' && p[1] === 'leads' && p.length === 2) {
      if (get) return json(res, 200, { leads: leads(), rodando: trabalho?.slug || null, temLogin: temLogin(), woods: WOODS, modelo: MODELO });
      const d = await corpo(req);
      const dados = {
        nome: String(d.nome || '').trim(), instagram: String(d.instagram || '').trim(), cidade: String(d.cidade || '').trim(),
        responsavel: d.responsavel, obs: String(d.obs || '').trim(),
      };
      dados.slug = String(d.slug || '').trim() || slugar(dados.nome);
      if (!dados.nome || !dados.instagram) return json(res, 400, { erro: 'Nome e Instagram são obrigatórios' });
      if (!RESPONSAVEIS.includes(dados.responsavel)) return json(res, 400, { erro: 'Responsável inválido' });
      if (!SLUG_OK.test(dados.slug)) return json(res, 400, { erro: 'Slug inválido: minúsculas, sem acento, com hífen' });
      if (ocupado()) return json(res, 409, { erro: ocupado() });
      try {
        execFileSync(process.execPath, ['scripts/novo-lead.js', dados.slug, dados.nome, dados.responsavel], { cwd: WOODS, encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        return json(res, 400, { erro: (e.stderr || e.message).trim() });
      }
      rodar(dados.slug, promptNovoLead(dados));
      return json(res, 201, { slug: dados.slug });
    }

    if (p[0] === 'api' && p[1] === 'permissao' && p.length === 3 && !get) {
      const d = await corpo(req);
      const responder = trabalho?.pendentes.get(p[2]);
      if (!responder) return json(res, 410, { erro: 'Esse pedido já expirou' });
      responder(Boolean(d.ok), Boolean(d.sempre));
      return json(res, 200, {});
    }

    // Prévia e prints: /site/<slug>/dist/a/ e /site/<slug>/prints/a-390.jpg
    if (get && p[0] === 'site' && ['dist', 'prints'].includes(p[2]) && SLUG_OK.test(p[1]) && fs.existsSync(fichaLead(p[1]))) {
      return arquivo(res, pastaLead(p[1]), p.slice(2));
    }

    if (p[0] === 'api' && p[1] === 'leads' && p.length >= 3) {
      const slugApi = p[2];
      if (!SLUG_OK.test(slugApi) || !fs.existsSync(fichaLead(slugApi))) return json(res, 404, { erro: 'Lead não encontrado' });
      const acao = p[3];
      if (get && !acao) return json(res, 200, lead(slugApi, true));
      if (get && acao === 'eventos') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        if (fs.existsSync(logLead(slugApi))) {
          for (const linha of fs.readFileSync(logLead(slugApi), 'utf8').split('\n')) if (linha) res.write(`data: ${linha}\n\n`);
        }
        const aqui = trabalho?.slug === slugApi;
        res.write(`data: ${JSON.stringify({ t: 'estado', rodando: aqui, pendentes: aqui ? [...trabalho.pendentes.keys()] : [] })}\n\n`);
        if (!ouvintes.has(slugApi)) ouvintes.set(slugApi, new Set());
        ouvintes.get(slugApi).add(res);
        req.on('close', () => ouvintes.get(slugApi).delete(res));
        return;
      }
      if (!get && acao === 'mensagem') {
        const texto = String((await corpo(req)).texto || '').trim();
        if (!texto) return json(res, 400, { erro: 'Mensagem vazia' });
        if (ocupado()) return json(res, 409, { erro: ocupado() });
        rodar(slugApi, texto);
        return json(res, 202, {});
      }
      if (!get && acao === 'parar') {
        if (trabalho?.slug === slugApi) trabalho.abort.abort();
        return json(res, 200, {});
      }
    }

    json(res, 404, { erro: 'Não encontrado' });
  } catch (e) {
    if (!res.headersSent) json(res, 400, { erro: e.message });
  }
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`Painel Woods: http://localhost:${PORTA}`);
  console.log(`WOODS: ${WOODS} · modelo: ${MODELO}`);
  if (!temLogin()) console.warn('⚠ Sem login do Claude: veja o README (claude.exe auth login)');
});
