// Consultas ao Supabase. RLS garante que só voltam linhas da equipe de quem está logado.
import { supabase } from './supabase.ts';
import type { Andamento, Dispositivo, Evento, Membro, Previa, Projeto, Trava } from './tipos.ts';
import { daTrava } from './regras.ts';

const COLUNAS_PROJETO = 'slug,nome,instagram,cidade,responsavel,nicho,status,variante_a_pronta,variante_b_pronta,url_a,url_b,repositorio_url,criado_local_em,atualizado_local_em,erro_sincronia,sincronizado_em,removido_em';
const COLUNAS_TRAVA = 'projeto_slug,dispositivo_id,quem,maquina,desde,renovada_em';
/** Quem está com o Claude em cada lead: a trava que o Painel Woods põe antes de começar */
const ativas = (t: Trava[]): Andamento[] => t.map((x) => daTrava(x)).filter((a) => a.ativo);
const COLUNAS_DISPOSITIVO = 'id,nome,versao_app,conectado,ultimo_contato,ultima_sincronizacao,pendentes,ultimo_erro';

function cliente() {
  if (!supabase) throw new Error('Woods Web sem configuração do Supabase.');
  return supabase;
}

/** Erro do Supabase ou da rede → frase para a tela */
export function mensagem(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/failed to fetch|network|load failed|fetch failed/i.test(m)) return 'Sem conexão com o Supabase. Confira a internet; o painel tenta de novo sozinho.';
  if (/jwt|token|401/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (/relation .* does not exist|schema cache|column .* does not exist/i.test(m)) return 'O banco do Supabase está desatualizado. Rode as migrations (veja docs/woods-web.md).';
  return m;
}

async function ok<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(mensagem(error));
  return data as T;
}

/** eu: meu nome na equipe (para o filtro "Meus leads"); vazio se ninguém deu nome a esta conta */
export interface Geral { projetos: Projeto[]; dispositivos: Dispositivo[]; andamento: Andamento[]; eu: string }

export async function carregarGeral(): Promise<Geral> {
  const sb = cliente();
  const { data: s } = await sb.auth.getSession();
  const [projetos, dispositivos, andamento, membros] = await Promise.all([
    ok<Projeto[]>(sb.from('projetos').select(COLUNAS_PROJETO).is('removido_em', null)
      .order('atualizado_local_em', { ascending: false, nullsFirst: false }).limit(1000)),
    ok<Dispositivo[]>(sb.from('dispositivos').select(COLUNAS_DISPOSITIVO).order('ultimo_contato', { ascending: false }).limit(10)),
    ok<Trava[]>(sb.from('travas').select(COLUNAS_TRAVA)).then(ativas),
    ok<Membro[]>(sb.from('membros').select('usuario_id,nome')),
  ]);
  const eu = membros.find((m) => m.usuario_id === s.session?.user.id)?.nome ?? '';
  return { projetos, dispositivos, andamento, eu };
}

export interface Detalhe {
  projeto: Projeto | null; eventos: Evento[]; previas: (Previa & { url: string | null })[];
  andamento: Andamento[]; dispositivos: Dispositivo[];
}

const ASSINATURA_S = 3600; // URLs das imagens valem 1 h; a página renova antes disso

export async function carregarDetalhe(slug: string): Promise<Detalhe> {
  const sb = cliente();
  const [projeto, eventos, previas, andamento, dispositivos] = await Promise.all([
    ok<Projeto | null>(sb.from('projetos').select(COLUNAS_PROJETO).eq('slug', slug).maybeSingle()),
    ok<Evento[]>(sb.from('eventos').select('id,projeto_slug,tipo,detalhe,ocorrido_em').eq('projeto_slug', slug).order('ocorrido_em', { ascending: false }).limit(200)),
    ok<Previa[]>(sb.from('previas').select('projeto_slug,nome,variante,aparelho,storage_path,atualizado_local_em').eq('projeto_slug', slug)),
    ok<Trava[]>(sb.from('travas').select(COLUNAS_TRAVA).eq('projeto_slug', slug)).then(ativas),
    ok<Dispositivo[]>(sb.from('dispositivos').select(COLUNAS_DISPOSITIVO).limit(10)),
  ]);
  // Reaproveita a URL assinada enquanto o print não mudar e faltar mais de 10 min para vencer:
  // assim a imagem não é baixada de novo a cada atualização da página
  const agora = Date.now();
  const assinar = previas.filter((p) => {
    const c = assinadas.get(p.storage_path);
    return !c || c.versao !== p.atualizado_local_em || c.vence - agora < 10 * 60_000;
  });
  if (assinar.length) {
    const { data, error } = await sb.storage.from('previas').createSignedUrls(assinar.map((p) => p.storage_path), ASSINATURA_S);
    if (!error && data) {
      for (const d of data) {
        const p = assinar.find((x) => x.storage_path === d.path);
        if (p && d.signedUrl) assinadas.set(p.storage_path, { url: d.signedUrl, versao: p.atualizado_local_em, vence: agora + ASSINATURA_S * 1000 });
      }
    }
  }
  return { projeto, eventos, andamento, dispositivos, previas: previas.map((p) => ({ ...p, url: assinadas.get(p.storage_path)?.url ?? null })) };
}

const assinadas = new Map<string, { url: string; versao: string; vence: number }>();
/** Ao sair da conta, esquece as URLs assinadas */
export const esquecerAssinaturas = () => assinadas.clear();
