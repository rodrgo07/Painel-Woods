/*
 * Peças da sincronização das conversas e das preferências entre computadores. Sem Electron nem rede.
 *
 * Conversa de um lead = duas coisas:
 *   - o histórico do painel: <dados>/conversas/<slug>.jsonl (o que aparece na tela do lead)
 *   - a sessão do Claude Code: <.claude>/projects/<pasta do WOODS codificada>/<sessão>.jsonl (o que o Claude lembra)
 * A sessão tem o caminho do WOODS daquele computador dentro; ele vira {{WOODS}} na nuvem e volta como o caminho
 * do computador que baixou, para o Claude continuar a conversa de qualquer um dos três.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SLUG_OK } from '../public/util.js';

export const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const SESSAO_OK = /^[A-Za-z0-9-]{8,80}$/;
const MARCA = '{{WOODS}}';

/** Pasta do Claude Code (CLAUDE_CONFIG_DIR ou ~/.claude) */
export const pastaClaude = (env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** Pasta das sessões de um diretório de trabalho: o Claude Code troca tudo que não é letra ou número por "-" */
export const pastaSessoes = (claude, cwd) => path.join(claude, 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'));

/** Arquivo da sessão: primeiro onde deveria estar; senão, procura em todas as pastas de projetos */
export function acharSessao(claude, cwd, sid) {
  if (!SESSAO_OK.test(sid || '')) return null;
  const certo = path.join(pastaSessoes(claude, cwd), `${sid}.jsonl`);
  if (fs.existsSync(certo)) return certo;
  try {
    for (const d of fs.readdirSync(path.join(claude, 'projects'))) {
      const f = path.join(claude, 'projects', d, `${sid}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch { /* sem pasta de projetos ainda */ }
  return null;
}

/** As formas em que o caminho do WOODS aparece no texto da sessão (JSON com \\, com / e cru), da mais longa à mais curta */
function formas(woods) {
  const w = path.resolve(woods);
  return [...new Set([JSON.stringify(w).slice(1, -1), w.replaceAll('\\', '/'), w])].sort((a, b) => b.length - a.length);
}
/** Texto da sessão sem o caminho deste computador */
export function paraNuvem(texto, woods) {
  for (const f of formas(woods)) texto = texto.split(f).join(MARCA);
  return texto;
}
/** Texto da sessão com o caminho do WOODS deste computador (no formato JSON, que é como ele aparece no .jsonl) */
export const daNuvem = (texto, woods) => texto.split(MARCA).join(JSON.stringify(path.resolve(woods)).slice(1, -1));

/** Junta dois históricos do painel (linhas JSON com "em"): sem repetir e em ordem de tempo */
export function juntarLinhas(a, b) {
  const vistas = new Set();
  const linhas = [];
  for (const [i, l] of [...String(a).split('\n'), ...String(b).split('\n')].entries()) {
    if (!l.trim() || vistas.has(l)) continue;
    vistas.add(l);
    let em = 0;
    try { em = Number(JSON.parse(l).em) || 0; } catch { /* linha cortada: fica na ordem em que veio */ }
    linhas.push({ l, em, i });
  }
  linhas.sort((x, y) => (x.em && y.em ? x.em - y.em : 0) || x.i - y.i);
  return linhas.map((x) => x.l).join('\n') + (linhas.length ? '\n' : '');
}

// ---------- sessoes.json (slug → id da sessão do Claude) ----------
export function lerSessoes(dados) {
  try { return JSON.parse(fs.readFileSync(path.join(dados, 'sessoes.json'), 'utf8')); } catch { return {}; }
}
export function gravarSessao(dados, slug, sid) {
  const s = lerSessoes(dados);
  if (sid) s[slug] = sid; else delete s[slug];
  fs.writeFileSync(path.join(dados, 'sessoes.json'), JSON.stringify(s, null, 2));
}

/** Leads que têm conversa neste computador */
export function slugsLocais(dados) {
  const s = new Set(Object.keys(lerSessoes(dados)).filter((x) => SLUG_OK.test(x)));
  try {
    for (const f of fs.readdirSync(path.join(dados, 'conversas'))) {
      if (f.endsWith('.jsonl') && SLUG_OK.test(f.slice(0, -6))) s.add(f.slice(0, -6));
    }
  } catch { /* ainda sem conversas */ }
  return [...s];
}

// ---------- Preferências ----------
const LISTAS = ['allow', 'deny', 'ask'];
const texto = (v) => (typeof v === 'string' ? v : '');

/** Permissões do WOODS/.claude/settings.local.json (onde ficam as que o painel marca como "Sempre") */
export function lerPermissoes(woods) {
  let p = {};
  try { p = JSON.parse(fs.readFileSync(path.join(woods, '.claude', 'settings.local.json'), 'utf8')).permissions || {}; } catch { /* sem arquivo */ }
  return Object.fromEntries(LISTAS.map((k) => [k, Array.isArray(p[k]) ? p[k].filter((x) => typeof x === 'string').sort() : []]));
}

/** Grava as listas de permissões sem mexer no resto do arquivo */
export function gravarPermissoes(woods, perm) {
  const arq = path.join(woods, '.claude', 'settings.local.json');
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { /* novo */ }
  const permissions = { ...(atual.permissions || {}) };
  for (const k of LISTAS) { if (perm[k]?.length) permissions[k] = perm[k]; else delete permissions[k]; }
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ ...atual, permissions }, null, 2));
}

/** Forma única das preferências (ordem fixa, para comparar pelo hash) */
export function normalizar(p = {}) {
  const perm = p.permissoes || {};
  return {
    modelo: texto(p.modelo), gitNome: texto(p.gitNome), gitEmail: texto(p.gitEmail),
    permissoes: Object.fromEntries(LISTAS.map((k) => [k, [...new Set(Array.isArray(perm[k]) ? perm[k].filter((x) => typeof x === 'string') : [])].sort()])),
  };
}

/** Junta: os campos de `nova` valem (quando preenchidos) e as permissões se somam */
export function juntarPreferencias(velha, nova) {
  const a = normalizar(velha);
  const b = normalizar(nova);
  return normalizar({
    modelo: b.modelo || a.modelo, gitNome: b.gitNome || a.gitNome, gitEmail: b.gitEmail || a.gitEmail,
    permissoes: Object.fromEntries(LISTAS.map((k) => [k, [...a.permissoes[k], ...b.permissoes[k]]])),
  });
}
