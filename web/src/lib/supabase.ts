import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Só valores públicos. A chave anon/publishable vai para o navegador; quem protege os dados é o RLS.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function papel(jwt: string) {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role as string; } catch { return ''; }
}

/** Mensagem para a tela quando o build foi feito sem as variáveis (ou com a chave errada) */
export const erroConfig = !url || !chave
  ? 'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no build. Veja web/.env.example.'
  : /^sb_secret_/.test(chave) || papel(chave) === 'service_role'
    ? 'A chave configurada é secreta. Use a chave anon (pública) e troque a service_role no Supabase.'
    : '';

export const supabase: SupabaseClient | null = erroConfig
  ? null
  : createClient(url!, chave!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
