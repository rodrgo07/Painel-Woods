// Regras puras do painel (sem React nem rede): fases do status, filtros, integração e textos. Testadas em teste/.
import type { Andamento, Dispositivo, Evento, Projeto } from './tipos.ts';

/** Status da ficha do WOODS: pesquisa | site pronto | aprovado | publicado | ligado | fechado | perdido */
export type Fase = 'desenvolvimento' | 'pronto' | 'publicado' | 'perdido';

export function fase(status: string | null): Fase {
  switch ((status || '').trim().toLowerCase()) {
    case 'site pronto': case 'aprovado': return 'pronto';
    case 'publicado': case 'ligado': case 'fechado': return 'publicado';
    case 'perdido': return 'perdido';
    default: return 'desenvolvimento'; // pesquisa, vazio ou algo que a ficha ainda não usa
  }
}

export const ROTULO_FASE: Record<Fase, string> = {
  desenvolvimento: 'Em desenvolvimento', pronto: 'Pronto', publicado: 'Publicado', perdido: 'Perdido',
};

export interface Resumo { total: number; desenvolvimento: number; pronto: number; publicado: number; perdido: number; comProblema: number }

export function resumir(projetos: Projeto[]): Resumo {
  const r: Resumo = { total: projetos.length, desenvolvimento: 0, pronto: 0, publicado: 0, perdido: 0, comProblema: 0 };
  for (const p of projetos) {
    r[fase(p.status)] += 1;
    if (p.erro_sincronia) r.comProblema += 1;
  }
  return r;
}

export interface Filtros { busca: string; fase: Fase | ''; status: string; cidade: string; responsavel: string; ordem: 'recentes' | 'antigos' | 'criados' }
export const FILTROS_VAZIOS: Filtros = { busca: '', fase: '', status: '', cidade: '', responsavel: '', ordem: 'recentes' };

/** Projetos de cada responsável, com quantos em cada fase (painel "Responsáveis") */
export function porResponsavel(projetos: Projeto[]) {
  const m = new Map<string, Record<Fase, number> & { total: number }>();
  for (const p of projetos) {
    const nome = p.responsavel || 'Sem responsável';
    const r = m.get(nome) ?? { total: 0, desenvolvimento: 0, pronto: 0, publicado: 0, perdido: 0 };
    r.total += 1;
    r[fase(p.status)] += 1;
    m.set(nome, r);
  }
  return [...m].map(([nome, r]) => ({ nome, ...r })).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "R Host" → "RH", "Lima Pet Salon" → "LP" */
export const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tempo = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

export function filtrar(projetos: Projeto[], f: Filtros): Projeto[] {
  const busca = semAcento(f.busca.trim());
  const lista = projetos.filter((p) => (!busca || semAcento(`${p.nome} ${p.slug}`).includes(busca))
    && (!f.fase || fase(p.status) === f.fase)
    && (!f.status || p.status === f.status)
    && (!f.cidade || p.cidade === f.cidade)
    && (!f.responsavel || p.responsavel === f.responsavel));
  const chave = f.ordem === 'criados' ? (p: Projeto) => tempo(p.criado_local_em) : (p: Projeto) => tempo(p.atualizado_local_em);
  return lista.sort((a, b) => (f.ordem === 'antigos' ? chave(a) - chave(b) : chave(b) - chave(a)));
}

/** Valores que existem nos dados, para os filtros (sem inventar opções) */
export const opcoes = (projetos: Projeto[], campo: 'status' | 'cidade' | 'responsavel') =>
  [...new Set(projetos.map((p) => p[campo]).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

/** Integração com o desktop. O desktop avisa a cada 5 min enquanto aberto */
export const SEM_CONTATO_MS = 15 * 60_000;
export type SituacaoDesktop = 'nenhum' | 'online' | 'sem-contato' | 'desconectado';

export const situacaoDe = (d: Dispositivo, agora = Date.now()): SituacaoDesktop =>
  (!d.conectado ? 'desconectado' : agora - tempo(d.ultimo_contato) <= SEM_CONTATO_MS ? 'online' : 'sem-contato');

/** A situação geral é a do PC com contato mais recente; `todos` traz cada PC da equipe com a sua */
export function integracao(dispositivos: Dispositivo[], agora = Date.now()) {
  const todos = [...dispositivos].sort((a, b) => tempo(b.ultimo_contato) - tempo(a.ultimo_contato))
    .map((d) => ({ dispositivo: d, situacao: situacaoDe(d, agora) }));
  const d = todos[0];
  if (!d) return { situacao: 'nenhum' as SituacaoDesktop, dispositivo: null, todos };
  return { situacao: d.situacao, dispositivo: d.dispositivo, todos };
}

/**
 * Leads com o Claude trabalhando agora, por slug. Só vale se o PC que marcou deu sinal de vida há pouco
 * (PC desligado no meio do trabalho não fica "em andamento" para sempre).
 */
export function emAndamento(andamento: Andamento[], dispositivos: Dispositivo[], agora = Date.now()): Map<string, Andamento> {
  const vivos = new Set(dispositivos.filter((d) => situacaoDe(d, agora) === 'online').map((d) => d.id));
  return new Map(andamento.filter((a) => a.ativo && vivos.has(a.dispositivo_id)).map((a) => [a.projeto_slug, a]));
}

export const textoAndamento = (a: Andamento) => `${a.quem || 'Alguém'} com o Claude${a.computador ? ` no ${a.computador}` : ''}`;

/** Só links http(s) vindos do banco viram botão: nada de painel://, javascript: etc. */
export const linkSeguro = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

export function descreverEvento(e: Evento): string {
  const d = e.detalhe || {};
  switch (e.tipo) {
    case 'importado': return 'Projeto enviado ao Woods Web pela primeira vez';
    case 'criado': return 'Lead cadastrado no Painel Woods';
    case 'status': return `Status: ${String(d.de ?? '—')} → ${String(d.para ?? '—')}`;
    case 'variante_a_pronta': return 'Variante A gerada';
    case 'variante_b_pronta': return 'Variante B gerada';
    case 'previas_prontas': return 'Os 4 prints de revisão ficaram prontos';
    case 'publicado': return 'Site publicado';
    case 'trabalho_iniciado': return 'Claude começou a trabalhar no projeto';
    case 'trabalho_concluido': return 'Claude terminou a etapa';
    case 'trabalho_com_erro': return 'Claude parou com erro';
    default: return e.tipo;
  }
}

export function relativo(iso: string | null, agora = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((agora - Date.parse(iso)) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `há ${Math.floor(s / 86400)} d`;
  return dataCurta(iso);
}

export const dataCurta = (iso: string | null) =>
  (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dataHora = (iso: string | null) =>
  (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
