// Supabase de mentira para os testes: Auth (vários computadores na mesma conta), PostgREST (upsert, insert, select,
// patch e delete com filtros eq.) e Storage. Sem rede.
import assert from 'node:assert/strict';

export const UID = '11111111-1111-4111-8111-111111111111';
export const ANON = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.assinatura`;

// Chave primária de cada tabela (o upsert usa on_conflict; insert sem upsert dá 409 se a chave já existe)
const CHAVES = {
  projetos: ['owner_id', 'slug'], previas: ['owner_id', 'projeto_slug', 'nome'], eventos: ['id'], dispositivos: ['id'],
  conversas: ['owner_id', 'projeto_slug'], preferencias: ['owner_id'], travas: ['owner_id', 'projeto_slug'],
};

export function supabaseFalso() {
  const s = {
    tabelas: Object.fromEntries(Object.keys(CHAVES).map((t) => [t, new Map()])), arquivos: new Map(), pedidos: [],
    offline: false, falha500: false, renovacoes: 0, recusarProjeto: false,
    acessos: new Set(), renovaveis: new Set(), ultimaRenovacao: '',
  };
  // Compatível com os testes antigos: ler o último token de renovação e revogar todos com 'revogado'
  Object.defineProperty(s, 'renovacaoValida', {
    get: () => s.ultimaRenovacao,
    set: (v) => { if (v === 'revogado') s.renovaveis.clear(); },
  });
  const resposta = (status, corpo) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
  const filtros = (u) => [...u.searchParams].filter(([k, v]) => !['select', 'on_conflict'].includes(k) && v.startsWith('eq.'))
    .map(([k, v]) => [k, v.slice(3)]);
  const bate = (linha, fs) => fs.every(([k, v]) => String(linha[k]) === v);
  const emitir = () => {
    s.renovacoes += 1;
    const acesso = `acesso-${s.renovacoes}`;
    const renova = `renova-${s.renovacoes}`;
    s.acessos.add(acesso);
    s.renovaveis.add(renova);
    s.ultimaRenovacao = renova;
    return resposta(200, { access_token: acesso, refresh_token: renova, expires_in: 3600, user: { id: UID, email: 'eu@woods.com' } });
  };

  s.fetch = async (url, { method, headers, body }) => {
    if (s.offline) throw new TypeError('fetch failed');
    const u = new URL(url);
    s.pedidos.push(`${method} ${u.pathname}`);
    assert.equal(headers.apikey, ANON, 'sempre a chave pública');
    if (u.pathname === '/auth/v1/token') {
      const d = JSON.parse(body);
      if (u.searchParams.get('grant_type') === 'password') {
        if (d.password !== 'senha-certa') return resposta(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      } else {
        if (!s.renovaveis.has(d.refresh_token)) return resposta(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        s.renovaveis.delete(d.refresh_token);
      }
      return emitir();
    }
    if (!s.acessos.has(String(headers.Authorization).replace('Bearer ', ''))) return resposta(401, { message: 'JWT expired' });
    if (s.falha500) return resposta(503, { message: 'indisponível' });
    if (u.pathname === '/auth/v1/logout') return resposta(204);

    // ---------- Storage ----------
    if (u.pathname.startsWith('/storage/v1/object/')) {
      const resto = decodeURIComponent(u.pathname.slice('/storage/v1/object/'.length));
      if (method === 'GET') {
        const caminho = resto.replace(/^authenticated\/[^/]+\//, '');
        const arq = s.arquivos.get(caminho);
        return arq === undefined ? resposta(400, { error: 'not_found', message: 'Object not found' }) : new Response(arq, { status: 200 });
      }
      if (method === 'DELETE') {
        for (const p of JSON.parse(body).prefixes) s.arquivos.delete(p);
        return resposta(200, []);
      }
      const [bucket, ...partes] = resto.split('/');
      s.arquivos.set(partes.join('/'), bucket === 'previas' ? String(body) : Buffer.from(body));
      return resposta(200, { Key: 'ok' });
    }

    // ---------- PostgREST ----------
    const tabela = u.pathname.replace('/rest/v1/', '');
    const t = s.tabelas[tabela];
    assert.ok(t, `tabela ${tabela}`);
    const pk = (linha) => CHAVES[tabela].map((c) => linha[c]).join(',');
    if (method === 'GET') return resposta(200, [...t.values()].filter((l) => bate(l, filtros(u))));
    if (method === 'DELETE') {
      for (const [k, l] of t) if (bate(l, filtros(u))) t.delete(k);
      return resposta(204);
    }
    if (method === 'PATCH') {
      const mudanca = JSON.parse(body);
      const feitas = [];
      for (const [k, l] of t) if (bate(l, filtros(u))) { t.set(k, { ...l, ...mudanca }); feitas.push(t.get(k)); }
      return resposta(200, feitas);
    }
    if (tabela === 'projetos' && s.recusarProjeto) return resposta(400, { code: '23514', message: 'violates check constraint' });
    const upsert = /resolution=/.test(headers.Prefer || '');
    const ignorar = /ignore-duplicates/.test(headers.Prefer || '');
    for (const linha of JSON.parse(body)) {
      assert.equal(linha.owner_id, UID);
      if (['previas', 'eventos'].includes(tabela) && !s.tabelas.projetos.has(`${UID},${linha.projeto_slug}`)) {
        return resposta(409, { code: '23503', message: 'foreign key' });
      }
      const k = pk(linha);
      const antes = t.get(k);
      if (antes && !upsert) return resposta(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      if (antes && ignorar) continue;
      // Igual ao gatilho projetos_mais_novo: dado mais velho não sobrescreve o mais novo
      if (tabela === 'projetos' && antes?.atualizado_local_em && linha.atualizado_local_em && linha.atualizado_local_em < antes.atualizado_local_em) continue;
      t.set(k, { ...antes, ...linha });
    }
    return resposta(201);
  };
  return s;
}
