/*
 * Fila local das operações que ainda não chegaram ao Supabase. Fica num arquivo JSON e sobrevive a fechar o app.
 * Cada operação tem uma chave: uma nova com a mesma chave substitui a antiga (o projeto vai só na versão mais nova).
 */
import fs from 'node:fs';
import path from 'node:path';

export const ESPERA_MIN = 30_000;        // 30 s depois da primeira falha
export const ESPERA_MAX = 30 * 60_000;   // nunca mais que 30 min entre tentativas
export const MAX_TENTATIVAS = 8;         // erro permanente (dado recusado): desiste depois disso

/** Espera antes da próxima tentativa: dobra a cada falha, com até 20% de variação para não bater todos juntos */
export const espera = (tentativas, sorte = Math.random) =>
  Math.min(ESPERA_MAX, ESPERA_MIN * 2 ** Math.max(0, tentativas - 1)) * (1 + 0.2 * sorte());

/** Grava o JSON inteiro de uma vez: escreve ao lado e troca, para um arquivo pela metade nunca ficar no lugar */
export function gravarJson(arq, dados) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados));
  fs.renameSync(tmp, arq);
}

export function lerJson(arq, padrao) {
  try { return { ...padrao, ...JSON.parse(fs.readFileSync(arq, 'utf8')) }; } catch { return { ...padrao }; }
}

export class Fila {
  constructor(itens = []) { this.itens = itens; }

  get tamanho() { return this.itens.length; }

  /** op: { chave, tipo, dados }. Substitui a operação com a mesma chave, mantendo a vez dela na fila */
  adicionar(op, agora = Date.now()) {
    const nova = { ...op, tentativas: 0, proxima: agora, erro: '' };
    const i = this.itens.findIndex((o) => o.chave === op.chave);
    if (i >= 0) this.itens[i] = nova; else this.itens.push(nova);
  }

  /** Operações que já podem ir, na ordem em que entraram */
  prontas(agora = Date.now()) { return this.itens.filter((o) => o.proxima <= agora); }

  concluir(chave) { this.itens = this.itens.filter((o) => o.chave !== chave); }

  /** Falha: agenda de novo. Devolve true se desistiu (erro permanente repetido demais) */
  falhar(chave, erro, { permanente = false, agora = Date.now(), sorte } = {}) {
    const o = this.itens.find((x) => x.chave === chave);
    if (!o) return false;
    o.tentativas += 1;
    o.erro = String(erro).slice(0, 300);
    if (permanente && o.tentativas >= MAX_TENTATIVAS) { this.concluir(chave); return true; }
    o.proxima = agora + espera(o.tentativas, sorte);
    return false;
  }

  /** Volta a tentar já (a internet voltou ou o usuário pediu) */
  liberar(agora = Date.now()) { for (const o of this.itens) o.proxima = Math.min(o.proxima, agora); }

  toJSON() { return this.itens; }
}
