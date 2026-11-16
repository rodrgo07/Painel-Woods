/*
 * Cliente mínimo do Supabase para o desktop: login, renovação da sessão, upsert e envio de imagem.
 * Usa só a chave pública (anon / publishable). A segurança está nas políticas RLS do banco.
 * `fetch` é injetado: no app é o net.fetch do Electron (respeita o proxy do Windows), nos testes um falso.
 */

/** Erro com a decisão de tentar de novo ou não */
export class ErroNuvem extends Error {
  constructor(msg, { status = 0, temporario = false, sessao = false, codigo = '' } = {}) {
    super(msg);
    Object.assign(this, { status, temporario, sessao, codigo });
  }
}

/** Confere a URL do projeto e a chave antes de guardar. A chave secreta (service_role) nunca entra no app */
export function conferirConfig({ url = '', anonKey = '' } = {}) {
  url = String(url).trim().replace(/\/+$/, '');
  anonKey = String(anonKey).trim();
  let u;
  try { u = new URL(url); } catch { throw new ErroNuvem('URL do Supabase inválida. Ela é parecida com https://xxxx.supabase.co'); }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new ErroNuvem('A URL do Supabase precisa começar com https://');
  if (u.pathname !== '/' || u.search) throw new ErroNuvem('Use só o endereço do projeto, sem caminho. Exemplo: https://xxxx.supabase.co');
  if (/^sb_secret_/.test(anonKey)) throw new ErroNuvem('Essa é a chave secreta. Use a chave pública (anon ou publishable).');
  if (/^eyJ/.test(anonKey)) {
    let papel = '';
    try { papel = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString()).role; } catch { /* conferido abaixo */ }
    if (papel === 'service_role') throw new ErroNuvem('Essa é a chave service_role (secreta). Use a chave anon (pública).');
    if (papel !== 'anon') throw new ErroNuvem('Chave do Supabase inválida.');
  } else if (!/^sb_publishable_[\w-]{10,}$/.test(anonKey)) {
    throw new ErroNuvem('Chave do Supabase inválida. Use a chave anon (começa com eyJ) ou a publishable (sb_publishable_…).');
  }
  return { url: u.origin, anonKey };
}

export function criarCliente({ url, anonKey, fetch, tempo = 20_000 }) {
  async function pedir(caminho, { metodo = 'POST', token, corpo, cabecalhos = {} } = {}) {
    let r;
    try {
      r = await fetch(`${url}${caminho}`, {
        method: metodo,
        headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, ...cabecalhos },
        body: corpo,
        signal: AbortSignal.timeout(tempo),
      });
    } catch (e) {
      throw new ErroNuvem(`Sem conexão com o Supabase (${e.name === 'TimeoutError' ? 'tempo esgotado' : e.message})`, { temporario: true });
    }
    if (r.ok) return r.status === 204 ? null : r.json().catch(() => null);
    const info = await r.json().catch(() => ({}));
    const msg = info.msg || info.message || info.error_description || info.error || `HTTP ${r.status}`;
    throw new ErroNuvem(String(msg).slice(0, 300), {
      status: r.status,
      codigo: String(info.code || info.error_code || info.error || ''),
      temporario: r.status >= 500 || [408, 425, 429].includes(r.status),
      sessao: r.status === 401 || (r.status === 403 && /jwt|token/i.test(msg)),
    });
  }
  const json = (o) => JSON.stringify(o);
  const sessao = (s) => ({
    acesso: s.access_token, renovacao: s.refresh_token,
    validade: (Number(s.expires_in) || 3600) * 1000, usuario: { id: s.user?.id, email: s.user?.email },
  });

  return {
    async entrar(email, senha) {
      return sessao(await pedir('/auth/v1/token?grant_type=password', {
        corpo: json({ email, password: senha }), cabecalhos: { 'Content-Type': 'application/json' },
      }));
    },
    async renovar(renovacao) {
      try {
        return sessao(await pedir('/auth/v1/token?grant_type=refresh_token', {
          corpo: json({ refresh_token: renovacao }), cabecalhos: { 'Content-Type': 'application/json' },
        }));
      } catch (e) {
        if (!e.temporario) e.sessao = true; // token de renovação recusado: precisa entrar de novo
        throw e;
      }
    },
    sair: (token) => pedir('/auth/v1/logout?scope=local', { token }),
    /** Insere ou atualiza pela chave `conflito`. ignorar=true: se já existe, deixa como está */
    upsert: (tabela, linhas, { token, conflito, ignorar = false }) => pedir(
      `/rest/v1/${tabela}${conflito ? `?on_conflict=${conflito}` : ''}`,
      {
        token, corpo: json(linhas),
        cabecalhos: { 'Content-Type': 'application/json', Prefer: `resolution=${ignorar ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      },
    ),
    /** Lê linhas. filtros no formato do PostgREST: { slug: 'eq.x', select: 'a,b' } */
    selecionar: (tabela, filtros, { token }) => pedir(`/rest/v1/${tabela}?${new URLSearchParams(filtros)}`, { metodo: 'GET', token })
      .then((r) => (Array.isArray(r) ? r : [])),
    /** Altera as linhas que batem com os filtros */
    alterar: (tabela, filtros, dados, { token }) => pedir(`/rest/v1/${tabela}?${new URLSearchParams(filtros)}`, {
      metodo: 'PATCH', token, corpo: json(dados), cabecalhos: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    }),
    enviarArquivo: (bucket, caminho, conteudo, tipo, { token }) => pedir(
      `/storage/v1/object/${bucket}/${caminho.split('/').map(encodeURIComponent).join('/')}`,
      { token, corpo: conteudo, cabecalhos: { 'Content-Type': tipo, 'x-upsert': 'true', 'cache-control': '3600' } },
    ),
  };
}
