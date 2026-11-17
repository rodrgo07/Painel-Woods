// Linhas das tabelas do Supabase (supabase/migrations). Preenchidas pelo serviço de sincronização do Painel Woods.

export interface Projeto {
  slug: string;
  nome: string;
  instagram: string | null;
  cidade: string | null;
  responsavel: string | null;
  nicho: string | null;
  status: string | null;
  variante_a_pronta: boolean;
  variante_b_pronta: boolean;
  url_a: string | null;
  url_b: string | null;
  repositorio_url: string | null;
  criado_local_em: string | null;
  atualizado_local_em: string | null;
  erro_sincronia: string | null;
  sincronizado_em: string;
  removido_em?: string | null;
}

/** Linha da tabela travas: o computador que está com o Claude num lead */
export interface Trava {
  projeto_slug: string;
  dispositivo_id: string;
  quem: string | null;
  maquina: string | null;
  desde: string;
  renovada_em: string;
}

/** Quem está com o Claude num lead agora (vem da trava) */
export interface Andamento {
  projeto_slug: string;
  dispositivo_id: string;
  quem: string | null;
  computador: string | null;
  ativo: boolean;
  desde: string;
}

/** Pessoa da equipe (tabela membros). nome = o "Responsável" das fichas */
export interface Membro {
  usuario_id: string;
  nome: string | null;
}

export type TipoEvento =
  | 'importado' | 'criado' | 'status' | 'variante_a_pronta' | 'variante_b_pronta' | 'previas_prontas'
  | 'publicado' | 'trabalho_iniciado' | 'trabalho_concluido' | 'trabalho_com_erro';

export interface Evento {
  id: string;
  projeto_slug: string;
  tipo: TipoEvento;
  detalhe: Record<string, unknown>;
  ocorrido_em: string;
}

export interface Previa {
  projeto_slug: string;
  nome: 'a-390' | 'b-390' | 'a-1440' | 'b-1440';
  variante: 'a' | 'b';
  aparelho: 'celular' | 'desktop';
  storage_path: string;
  atualizado_local_em: string;
}

export interface Dispositivo {
  id: string;
  nome: string | null;
  versao_app: string | null;
  conectado: boolean;
  ultimo_contato: string;
  ultima_sincronizacao: string | null;
  pendentes: number;
  ultimo_erro: string | null;
}
