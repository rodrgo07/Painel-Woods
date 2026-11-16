// Consultas ao Supabase. RLS garante que só voltam linhas do usuário logado.
import { supabase } from './supabase.ts';
import type { Dispositivo, Evento, Previa, Projeto } from './tipos.ts';

const COLUNAS_PROJETO = 'slug,nome,instagram,cidade,responsavel,nicho,status,variante_a_pronta,variante_b_pronta,url_a,url_b,repositorio_url,criado_local_em,atualizado_local_em,erro_sincronia,sincronizado_em';

function cliente() {
  if (!supabase) throw new Error('Woods Web sem configuração do Supabase.');
  return supabase;
}

/** Erro do Supabase ou da rede → frase para a tela */
export function mensagem(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/failed to fetch|network|load failed|fetch failed/i.test(m)) return 'Sem conexão com o Supabase. Confira a internet; o painel tenta de novo sozinho.';
  if (/jwt|token|401/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (/relation .* does not exist|schema cache/i.test(m)) return 'As tabelas não existem no Supabase. Rode a migration (veja web/README.md).';
  return m;
}

async function ok<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(mensagem(error));
  return data as T;
}

export interface Geral { projetos: Projeto[]; dispositivos: Dispositivo[] }

export async function carregarGeral(): Promise<Geral> {
  const sb = cliente();
  const [projetos, dispositivos] = await Promise.all([
    ok<Projeto[]>(sb.from('projetos').select(COLUNAS_PROJETO).order('atualizado_local_em', { ascending: false, nullsFirst: false }).limit(1000)),
    ok<Dispositivo[]>(sb.from('dispositivos').select('id,nome,versao_app,conectado,ultimo_contato,ultima_sincronizacao,pendentes,ultimo_erro')
      .order('ultimo_contato', { ascending: false }).limit(10)),
  ]);
  return { projetos, dispositivos };
}

export interface Detalhe { projeto: Projeto | null; eventos: Evento[]; previas: (Previa & { url: string | null })[] }

const ASSINATURA_S = 3600; // URLs das imagens valem 1 h; a página renova antes disso

export async function carregarDetalhe(slug: string): Promise<Detalhe> {
  const sb = cliente();
  const [projeto, eventos, previas] = await Promise.all([
    ok<Projeto | null>(sb.from('projetos').select(COLUNAS_PROJETO).eq('slug', slug).maybeSingle()),
    ok<Evento[]>(sb.from('eventos').select('id,projeto_slug,tipo,detalhe,ocorrido_em').eq('projeto_slug', slug).order('ocorrido_em', { ascending: false }).limit(200)),
    ok<Previa[]>(sb.from('previas').select('projeto_slug,nome,variante,aparelho,storage_path,atualizado_local_em').eq('projeto_slug', slug)),
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
  return { projeto, eventos, previas: previas.map((p) => ({ ...p, url: assinadas.get(p.storage_path)?.url ?? null })) };
}

const assinadas = new Map<string, { url: string; versao: string; vence: number }>();
/** Ao sair da conta, esquece as URLs assinadas */
export const esquecerAssinaturas = () => assinadas.clear();
