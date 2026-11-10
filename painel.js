/*
 * Leads e conversa com o Claude. Lê e escreve direto no WOODS.
 * Cada lead tem uma sessão própria do Claude (Agent SDK = Claude Code), rodando dentro do WOODS
 * com o CLAUDE.md e o fluxo de lá. Um lead por vez, porque o navegador do Playwright é um só.
 * Sem Electron aqui: o main.js preenche `ctx`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { slugar, SLUG_OK, lerFicha, gravarNaFicha, resumir } from './public/util.js';
import { limpar, registrar } from './nucleo.js';
import { acompanhar, matar } from './woods.js';

export const ctx = {
  woods: '',          // pasta do repositório WOODS
  dados: '',          // sessoes.json e conversas/<slug>.jsonl
  enviar: () => {},   // (slug, linha JSON) → janela
  opcoes: () => ({}), // { env, modelo, claude, node, mcp }, lidos a cada conversa
};
const PRINTS = ['a-390', 'b-390', 'a-1440', 'b-1440'];
const RESPONSAVEIS = ['R Host', 'L Host'];

// ---------- Leads (lidos direto do WOODS) ----------
export const pastaLead = (slug) => path.join(ctx.woods, 'sites', slug);
const fichaLead = (slug) => path.join(ctx.woods, 'vault', '20-leads', `${slug}.md`);
export const existe = (slug) => SLUG_OK.test(slug ?? '') && fs.existsSync(fichaLead(slug));
const exigir = (slug) => { if (!existe(slug)) throw new Error('Lead não encontrado'); };
const mtime = (f) => Math.round(fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs || 0);

const arqSessoes = () => path.join(ctx.dados, 'sessoes.json');
function lerSessoes() {
  try { return JSON.parse(fs.readFileSync(arqSessoes(), 'utf8')); } catch { return {}; }
}
function salvarSessao(slug, id) {
  const s = lerSessoes();
  if (id) s[slug] = id; else delete s[slug];
  fs.writeFileSync(arqSessoes(), JSON.stringify(s, null, 2));
}

export function lead(slug, comFicha = false) {
  exigir(slug);
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

export const leads = () => fs.readdirSync(path.join(ctx.woods, 'vault', '20-leads'))
  .filter((f) => f.endsWith('.md') && !f.startsWith('_') && SLUG_OK.test(f.slice(0, -3)))
  .map((f) => lead(f.slice(0, -3)))
  .sort((a, b) => b.atualizado - a.atualizado);

// ---------- Eventos de cada lead (histórico em conversas/<slug>.jsonl + ao vivo pela janela) ----------
const logLead = (slug) => path.join(ctx.dados, 'conversas', `${slug}.jsonl`);
function emitir(slug, ev) {
  const linha = limpar(JSON.stringify({ ...ev, em: Date.now() })); // chave ou token que apareça num comando não fica gravado
  if (ev.t !== 'estado') fs.appendFileSync(logLead(slug), linha + '\n');
  ctx.enviar(slug, linha);
}

/** Histórico do lead e o estado de agora. O que acontecer depois chega por ctx.enviar */
export function eventos(slug) {
  exigir(slug);
  const aqui = trabalho?.slug === slug;
  return {
    linhas: fs.existsSync(logLead(slug)) ? fs.readFileSync(logLead(slug), 'utf8').split('\n').filter(Boolean) : [],
    estado: { t: 'estado', rodando: aqui, pendentes: aqui ? [...trabalho.pendentes.keys()] : [] },
  };
}

// ---------- Claude ----------
const INSTRUCOES = `
Você está rodando pelo Painel Woods, um aplicativo de Windows. O responsável lê suas mensagens no painel e responde por lá, sem terminal.
- Quando precisar dele (login no Instagram ou no Cloudflare na janela do navegador do Playwright, captcha, dado que falta, aprovação dos prints), diga em uma ou duas frases o que ele tem que fazer e termine o turno. A resposta chega como a próxima mensagem.
- O painel mostra a prévia de sites/<slug>/dist/a e dist/b, os prints de sites/<slug>/prints/ e a ficha. Depois de mudar o site, rode \`npm run build -- <slug>\` e \`npm run prints -- <slug>\` para o painel mostrar a versão nova.
- Não rode \`npm run servir\`: o painel já serve a prévia.
- Comandos fora da lista liberada pedem permissão no painel. Se o responsável negar, siga sem ele ou explique o que falta.
- Responda em português do Brasil, curto e direto.`;

// Liberados sem perguntar. Todo o resto (git push, curl, WebFetch…) pede permissão no painel.
const PERMITIDAS = [
  'mcp__playwright', 'WebSearch',
  'Bash(npm run build *)', 'Bash(npm run prints *)', 'Bash(npm run teste)',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git add *)', 'Bash(git commit *)',
  'Bash(mkdir *)',
];

let trabalho = null; // { slug, abort, pendentes: Map<id, responder> }

async function rodar(slug, texto) {
  const resume = lerSessoes()[slug];
  const o = ctx.opcoes();
  const t = trabalho = { slug, abort: new AbortController(), pendentes: new Map() };

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
    emitir(slug, { t: 'permissao', id, ...resumir(nome, entrada, ctx.woods) });
  });

  let teveResultado = false;
  try {
    emitir(slug, { t: 'eu', texto });
    emitir(slug, { t: 'estado', rodando: true });
    const prompt = resume ? texto : `Lead \`${slug}\` (ficha: vault/20-leads/${slug}.md).\n\n${texto}`;
    const q = query({
      prompt,
      options: {
        cwd: ctx.woods,
        model: o.modelo,
        resume,
        abortController: t.abort,
        env: o.env,
        pathToClaudeCodeExecutable: o.claude, // fora do app.asar: de dentro dele não dá para executar
        // Abre o claude.exe por aqui para o app conseguir encerrar ele e os filhos ao fechar
        spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
          const p = acompanhar(spawn(command, args, { cwd, env, signal, windowsHide: true }));
          p.stderr.on('data', (d) => registrar(`claude: ${String(d).trim()}`));
          // Parar é na hora: o `signal` do SDK só dispara depois de uns segundos de espera, com o Claude ainda agindo
          t.abort.signal.addEventListener('abort', () => matar(p), { once: true });
          return p;
        },
        settingSources: ['project'], // CLAUDE.md e .claude/ do WOODS
        systemPrompt: { type: 'preset', preset: 'claude_code', append: INSTRUCOES },
        mcpServers: { playwright: o.mcp },
        permissionMode: 'acceptEdits',
        allowedTools: PERMITIDAS,
        // AskUserQuestion: perguntas vêm como texto, respondidas pelo painel.
        // PowerShell: só o Bash do app, para as regras de PERMITIDAS valerem (pelo PowerShell até o build pediria permissão)
        disallowedTools: ['AskUserQuestion', 'PowerShell'],
        canUseTool: pedirPermissao,
      },
    });
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        salvarSessao(slug, m.session_id);
        registrar(`conversa ${slug}: sessão ${m.session_id}, modelo ${m.model}, mcp ${(m.mcp_servers || []).map((s) => `${s.name}=${s.status}`).join(', ')}`);
      } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message.content) {
          if (b.type === 'text' && b.text.trim()) emitir(slug, { t: 'claude', texto: b.text });
          else if (b.type === 'tool_use' && b.name !== 'TodoWrite') emitir(slug, { t: 'ferramenta', ...resumir(b.name, b.input, ctx.woods) });
        }
      } else if (m.type === 'result') {
        teveResultado = true;
        emitir(slug, { t: 'fim', ok: !m.is_error, custo: m.total_cost_usd, erro: m.is_error ? (m.result || m.subtype) : '' });
      }
    }
  } catch (e) {
    registrar(`conversa ${slug}: ${e.stack || e}`);
    // Sessão apagada pelo Claude Code (limpa as antigas): a próxima mensagem abre outra, que relê a ficha
    if (resume && /No conversation found/i.test(e.message)) salvarSessao(slug, undefined);
    // Resultado com erro já foi mostrado no 'fim'; o SDK lança de novo depois dele
    if (!teveResultado) emitir(slug, { t: 'erro', texto: t.abort.signal.aborted ? 'Parado pelo painel.' : e.message });
  } finally {
    trabalho = null;
    for (const responder of t.pendentes.values()) responder(false);
    emitir(slug, { t: 'estado', rodando: false, pendentes: [] });
  }
}

/** Começa a conversa sem esperar o fim. Erro que escapar do rodar vai para o log e para o painel */
function iniciar(slug, texto) {
  rodar(slug, texto).catch((e) => {
    trabalho = null;
    registrar(`rodar ${slug}: ${e.stack || e}`);
    ctx.enviar(slug, JSON.stringify({ t: 'erro', texto: limpar(e.message), em: Date.now() }));
    ctx.enviar(slug, JSON.stringify({ t: 'estado', rodando: false, pendentes: [] }));
  });
}

export const rodando = () => trabalho?.slug || null;
export const ocupado = () => (trabalho ? `O Claude está trabalhando em ${trabalho.slug}. Espere terminar ou pare.` : '');
/** Ao fechar o app: interrompe a conversa em andamento */
export const encerrar = () => trabalho?.abort.abort();

function promptNovoLead({ slug, nome, instagram, cidade, responsavel, obs }) {
  return `Novo lead pelo painel.
- Nome do negócio: ${nome}
- Instagram: ${instagram}
- Cidade: ${cidade || 'descobrir na pesquisa'}
- Responsável: ${responsavel}${obs ? `\n- Observações do responsável: ${obs}` : ''}

A etapa 0 do fluxo já foi feita pelo painel (\`npm run novo-lead\`): existem \`sites/${slug}/\` e \`vault/20-leads/${slug}.md\`, com o Instagram${cidade ? ' e a cidade' : ''} já na ficha.
Siga \`vault/00-sistema/fluxo-novo-lead.md\` da etapa 1 à 5: pesquisa no Google e no Instagram, conteúdo, visual próprio de A e B, SEO e revisão com os 4 prints. Pare na etapa 6 e avise que os prints estão prontos para aprovação.`;
}

export function criar(d) {
  const dados = {
    nome: String(d.nome || '').trim(), instagram: String(d.instagram || '').trim(), cidade: String(d.cidade || '').trim(),
    responsavel: d.responsavel, obs: String(d.obs || '').trim(),
  };
  dados.slug = String(d.slug || '').trim() || slugar(dados.nome);
  if (!dados.nome || !dados.instagram) throw new Error('Nome e Instagram são obrigatórios');
  if (!RESPONSAVEIS.includes(dados.responsavel)) throw new Error('Responsável inválido');
  if (!SLUG_OK.test(dados.slug)) throw new Error('Slug inválido: minúsculas, sem acento, com hífen');
  if (trabalho) throw new Error(ocupado());
  const o = ctx.opcoes();
  try {
    // Node do app: process.execPath aqui é o próprio Painel Woods
    execFileSync(o.node, ['scripts/novo-lead.js', dados.slug, dados.nome, dados.responsavel],
      { cwd: ctx.woods, env: o.env, encoding: 'utf8', stdio: 'pipe', windowsHide: true });
  } catch (e) {
    throw new Error((e.stderr || e.message).trim());
  }
  fs.writeFileSync(fichaLead(dados.slug), gravarNaFicha(fs.readFileSync(fichaLead(dados.slug), 'utf8'), dados));
  iniciar(dados.slug, promptNovoLead(dados));
  return { slug: dados.slug };
}

export function mensagem({ slug, texto }) {
  exigir(slug);
  texto = String(texto || '').trim();
  if (!texto) throw new Error('Mensagem vazia');
  if (texto.length > 100_000) throw new Error('Mensagem grande demais');
  if (trabalho) throw new Error(ocupado());
  iniciar(slug, texto);
}

export function parar({ slug }) {
  if (trabalho?.slug === slug) trabalho.abort.abort();
}

export function permissao({ id, ok, sempre }) {
  const responder = trabalho?.pendentes.get(id);
  if (!responder) throw new Error('Esse pedido já expirou');
  responder(Boolean(ok), Boolean(sempre));
}
