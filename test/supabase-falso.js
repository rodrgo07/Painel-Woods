// Supabase de mentira para os testes, com o que a migration garante. Sem rede.
//   Auth: duas contas da mesma equipe (você e o sócio), vários computadores por conta (cada login tem o próprio token)
//   PostgREST: upsert, insert (409 se a chave existe), select, patch e delete com filtros eq. / is.true
//   RLS: dados da equipe (projetos, prévias, eventos, aparelhos, travas) a equipe lê; cada um só escreve em nome próprio.
//        Conversas e preferências são de cada conta. A trava de um lead só é aceita do Responsável dele.
//   Gatilho: a versão mais velha de um projeto ou prévia não sobrescreve a mais nova
//   Storage: previas/<equipe>/…, conversas/<conta>/…
import assert from 'node:assert/strict';

export const UID = '11111111-1111-4111-8111-111111111111';
export const SOCIO = '22222222-2222-4222-8222-222222222222';
export const EQ = '99999999-9999-4999-8999-999999999999';
export const CONTAS = { 'eu@woods.com': UID, 'socio@woods.com': SOCIO };
export const ANON = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.assinatura`;

// Chave primária de cada tabela (o upsert usa on_conflict; insert sem upsert dá 409 se a chave já existe)
const CHAVES = {
  projetos: ['equipe_id', 'slug'], previas: ['equipe_id', 'projeto_slug', 'nome'], eventos: ['id'], dispositivos: ['id'],
  travas: ['equipe_id', 'projeto_slug'], conversas: ['owner_id', 'projeto_slug'], preferencias: ['owner_id'],
};
const DA_EQUIPE = ['projetos', 'previas', 'eventos', 'dispositivos', 'travas'];
const PRECISA_PROJETO = ['previas', 'eventos'];

export function supabaseFalso() {
  const s = {
    tabelas: Object.fromEntries(Object.keys(CHAVES).map((t) => [t, new Map()])), arquivos: new Map(), pedidos: [],
    membros: [{ equipe_id: EQ, usuario_id: UID, nome: 'R Host' }, { equipe_id: EQ, usuario_id: SOCIO, nome: 'L Host' }],
    offline: false, falha500: false, renovacoes: 0, recusarProjeto: false,
    acessos: new Map(), renovaveis: new Map(), // token → conta
  };
  // Último token de renovação de cada conta; set(conta, 'revogado') revoga todos os dessa conta
  const ultimo = new Map();
  s.renovacoes_validas = {
    get: (quem) => ultimo.get(quem),
    set: (quem, v) => { if (v === 'revogado') for (const [k, q] of s.renovaveis) if (q === quem) s.renovaveis.delete(k); },
  };

  const resposta = (status, corpo) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
  const negado = () => resposta(403, { code: '42501', message: 'new row violates row-level security policy' });
  const filtrar = (linhas, params) => linhas.filter((l) => [...params].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(l[k]) === v.slice(3);
    if (v === 'is.true') return l[k] === true;
    throw new Error(`filtro não suportado no falso: ${k}=${v}`);
  }));
  const emitir = (quem) => {
    s.renovacoes += 1;
    const acesso = `acesso-${s.renovacoes}`;
    const renova = `renova-${s.renovacoes}`;
    s.acessos.set(acesso, quem);
    s.renovaveis.set(renova, quem);
    ultimo.set(quem, renova);
    const email = Object.keys(CONTAS).find((e) => CONTAS[e] === quem);
    return resposta(200, { access_token: acesso, refresh_token: renova, expires_in: 3600, user: { id: quem, email } });
  };

  s.fetch = async (url, { method, headers, body }) => {
    if (s.offline) throw new TypeError('fetch failed');
    const u = new URL(url);
    s.pedidos.push(`${method} ${u.pathname}`);
    assert.equal(headers.apikey, ANON, 'sempre a chave pública');
    if (u.pathname === '/auth/v1/token') {
      const d = JSON.parse(body);
      if (u.searchParams.get('grant_type') === 'password') {
        const quem = CONTAS[d.email];
        if (d.password !== 'senha-certa' || !quem) return resposta(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return emitir(quem);
      }
      const quem = s.renovaveis.get(d.refresh_token);
      if (!quem) return resposta(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      s.renovaveis.delete(d.refresh_token);
      return emitir(quem);
    }
    const eu = s.acessos.get(String(headers.Authorization).replace('Bearer ', ''));
    if (!eu) return resposta(401, { message: 'JWT expired' });
    if (s.falha500) return resposta(503, { message: 'indisponível' });
    if (u.pathname === '/auth/v1/logout') return resposta(204);
    const equipes = s.membros.filter((m) => m.usuario_id === eu).map((m) => m.equipe_id);
    const meuNome = (eq) => s.membros.find((m) => m.usuario_id === eu && m.equipe_id === eq)?.nome;

    // ---------- Storage ----------
    if (u.pathname.startsWith('/storage/v1/object/')) {
      const resto = decodeURIComponent(u.pathname.slice('/storage/v1/object/'.length)).replace(/^authenticated\//, '');
      const [bucket, ...partes] = resto.split('/');
      const pode = (caminho) => (bucket === 'previas' ? equipes.includes(caminho.split('/')[0]) : caminho.split('/')[0] === eu);
      if (method === 'DELETE') {
        for (const p of JSON.parse(body).prefixes) if (pode(p)) s.arquivos.delete(p);
        return resposta(200, []);
      }
      const caminho = partes.join('/');
      if (!pode(caminho)) return negado();
      if (method === 'GET') {
        const arq = s.arquivos.get(caminho);
        return arq === undefined ? resposta(400, { error: 'not_found', message: 'Object not found' }) : new Response(arq, { status: 200 });
      }
      s.arquivos.set(caminho, bucket === 'previas' ? String(body) : Buffer.from(body));
      return resposta(200, { Key: 'ok' });
    }

    // ---------- PostgREST ----------
    const tabela = u.pathname.replace('/rest/v1/', '');
    const daEquipe = DA_EQUIPE.includes(tabela);
    const visivel = (l) => (daEquipe ? equipes.includes(l.equipe_id) : l.owner_id === eu);
    if (method === 'GET') {
      if (tabela === 'membros') return resposta(200, filtrar(s.membros.filter((m) => equipes.includes(m.equipe_id)), u.searchParams));
      assert.ok(s.tabelas[tabela], `tabela ${tabela}`);
      return resposta(200, filtrar([...s.tabelas[tabela].values()].filter(visivel), u.searchParams));
    }
    const t = s.tabelas[tabela];
    assert.ok(t, `tabela ${tabela}`);
    const pk = (linha) => CHAVES[tabela].map((c) => linha[c]).join(',');
    if (method === 'DELETE') {
      // travas: cada um solta só as próprias
      for (const [k, l] of t) if (visivel(l) && (tabela !== 'travas' || l.owner_id === eu) && filtrar([l], u.searchParams).length) t.delete(k);
      return resposta(204);
    }
    if (method === 'PATCH') {
      const mudanca = JSON.parse(body);
      if (daEquipe) assert.equal(mudanca.owner_id, eu, 'só escreve em nome próprio');
      const feitas = [];
      for (const [k, l] of t) if (visivel(l) && filtrar([l], u.searchParams).length) { t.set(k, { ...l, ...mudanca }); feitas.push(t.get(k)); }
      return resposta(200, feitas);
    }
    if (tabela === 'projetos' && s.recusarProjeto) return resposta(400, { code: '23514', message: 'violates check constraint' });
    const upsert = /resolution=/.test(headers.Prefer || '');
    const ignorar = /ignore-duplicates/.test(headers.Prefer || '');
    if (upsert) assert.equal(u.searchParams.get('on_conflict') || 'id', CHAVES[tabela].join(','), 'on_conflict igual à chave da tabela');
    for (const linha of JSON.parse(body)) {
      assert.equal(linha.owner_id, eu, 'só escreve em nome próprio');
      if (daEquipe && !equipes.includes(linha.equipe_id)) return negado();
      if (PRECISA_PROJETO.includes(tabela) && !s.tabelas.projetos.has(`${linha.equipe_id},${linha.projeto_slug}`)) {
        return resposta(409, { code: '23503', message: 'foreign key' });
      }
      if (tabela === 'travas') {
        // Igual a public.pode_travar: lead sem responsável, ainda fora do banco ou do próprio membro
        const p = s.tabelas.projetos.get(`${linha.equipe_id},${linha.projeto_slug}`);
        if (p?.responsavel && p.responsavel !== meuNome(linha.equipe_id)) return negado();
      }
      const k = pk(linha);
      const antes = t.get(k);
      if (antes && !upsert) return resposta(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      if (antes && ignorar) continue;
      // A trava de outra conta só se toma depois de vencida (10 min sem renovar)
      if (antes && tabela === 'travas' && antes.owner_id !== eu
        && Date.parse(linha.renovada_em) - Date.parse(antes.renovada_em) < 10 * 60_000) return negado();
      // Igual ao gatilho recusar_versao_velha: dado mais velho não sobrescreve o mais novo
      if (antes && ['projetos', 'previas'].includes(tabela) && linha.atualizado_local_em && antes.atualizado_local_em
        && Date.parse(linha.atualizado_local_em) < Date.parse(antes.atualizado_local_em)) continue;
      t.set(k, { ...antes, ...linha });
    }
    return resposta(201);
  };
  return s;
}
