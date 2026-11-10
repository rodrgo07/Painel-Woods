// Peças sem Electron nem SDK do Claude: dá para testar com `npm test`.
import fs from 'node:fs';
import path from 'node:path';
import { SLUG_OK } from './public/util.js';

// ---------- Configurações (%APPDATA%\PainelWoods\config.json) ----------
export const MODELOS = ['claude-opus-5-5', 'claude-fable-5-2'];
export const NAVEGADORES = ['', 'chrome', 'edge']; // '' = automático
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const linha = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

/** Só campos conhecidos e válidos; o que vier errado volta ao padrão */
export function validar(c = {}) {
  const email = linha(c.gitEmail);
  return {
    modelo: MODELOS.includes(c.modelo) ? c.modelo : MODELOS[0],
    gitNome: linha(c.gitNome),
    gitEmail: EMAIL.test(email) ? email : '',
    navegador: NAVEGADORES.includes(c.navegador) ? c.navegador : '',
    chaveApi: typeof c.chaveApi === 'string' ? c.chaveApi : '', // cifrada pelo safeStorage (DPAPI), em base64
  };
}

export function ler(arq) {
  try { return validar(JSON.parse(fs.readFileSync(arq, 'utf8'))); } catch { return validar(); }
}

export function salvar(arq, c) {
  const v = validar(c);
  fs.writeFileSync(arq, JSON.stringify(v, null, 2));
  return v;
}

// ---------- Arquivos servidos para a janela ----------
/** Arquivo dentro de `base`, ou null: bloqueia ../ e caminho absoluto. Pasta vira index.html */
export function caminhoSeguro(base, partes) {
  let arq = path.resolve(base, ...partes);
  if (arq !== base && !arq.startsWith(base + path.sep)) return null;
  if (fs.statSync(arq, { throwIfNoEntry: false })?.isDirectory()) arq = path.join(arq, 'index.html');
  return fs.statSync(arq, { throwIfNoEntry: false })?.isFile() ? arq : null;
}

// ---------- Conversas de uma instalação antiga ----------
/** Copia os <slug>.jsonl de `origem` para `destino` sem trocar os que já existem. Devolve quantos copiou */
export function importarConversas(origem, destino) {
  let copiadas = 0;
  for (const f of fs.readdirSync(origem)) {
    const para = path.join(destino, f);
    if (!f.endsWith('.jsonl') || !SLUG_OK.test(f.slice(0, -6)) || fs.existsSync(para)) continue;
    fs.copyFileSync(path.join(origem, f), para);
    copiadas++;
  }
  return copiadas;
}

// ---------- Log (%APPDATA%\PainelWoods\logs) ----------
const SEGREDO = /\b(sk-ant-[\w-]{8,}|gh[pousr]_\w{20,}|github_pat_\w{20,})/g;
/** Tira chaves e tokens de um texto antes de gravar ou mostrar */
export const limpar = (t) => String(t).replace(SEGREDO, '[segredo]');

let pastaLogs = '';
export function iniciarLog(pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  pastaLogs = pasta;
}

// shortcut: os logs não são apagados (um arquivo pequeno por dia); limpar os antigos se a pasta crescer
export function registrar(msg) {
  if (!pastaLogs) return;
  const agora = new Date().toISOString();
  try {
    fs.appendFileSync(path.join(pastaLogs, `painel-${agora.slice(0, 10)}.log`), `[${agora}] ${limpar(msg)}\n`);
  } catch { /* o log nunca derruba o app */ }
}
