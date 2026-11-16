// Regras do Woods Web: fases do status, resumo dos cards, filtros, integração e links. `npm test` em web/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fase, resumir, filtrar, opcoes, integracao, linkSeguro, descreverEvento, FILTROS_VAZIOS, SEM_CONTATO_MS } from '../src/lib/regras.ts';
import type { Dispositivo, Projeto } from '../src/lib/tipos.ts';

const proj = (p: Partial<Projeto>): Projeto => ({
  slug: 's', nome: 'S', instagram: null, cidade: null, responsavel: null, nicho: null, status: 'pesquisa',
  variante_a_pronta: false, variante_b_pronta: false, url_a: null, url_b: null, repositorio_url: null,
  criado_local_em: null, atualizado_local_em: null, erro_sincronia: null, sincronizado_em: '2026-11-15T00:00:00Z', ...p,
});

test('fase: os status da ficha do WOODS', () => {
  assert.equal(fase('pesquisa'), 'desenvolvimento');
  assert.equal(fase(null), 'desenvolvimento');
  assert.equal(fase('site pronto'), 'pronto');
  assert.equal(fase('aprovado'), 'pronto');
  for (const s of ['publicado', 'ligado', 'fechado', ' Publicado ']) assert.equal(fase(s), 'publicado');
  assert.equal(fase('perdido'), 'perdido');
});

test('resumo dos cards', () => {
  const r = resumir([proj({ status: 'pesquisa' }), proj({ status: 'site pronto', erro_sincronia: 'x' }), proj({ status: 'publicado' }), proj({ status: 'perdido' })]);
  assert.deepEqual(r, { total: 4, desenvolvimento: 1, pronto: 1, publicado: 1, perdido: 1, comProblema: 1 });
});

test('filtros: busca sem acento, status, cidade, responsável e ordem', () => {
  const lista = [
    proj({ slug: 'a', nome: 'Fiot’s Centro Estético', cidade: 'Cotia', responsavel: 'R Host', atualizado_local_em: '2026-11-10T00:00:00Z', criado_local_em: '2026-11-01T00:00:00Z' }),
    proj({ slug: 'b', nome: 'Lima Pet Salon', cidade: 'Cotia', responsavel: 'L Host', status: 'site pronto', atualizado_local_em: '2026-11-12T00:00:00Z', criado_local_em: '2026-10-01T00:00:00Z' }),
    proj({ slug: 'c', nome: 'Cute Pet', cidade: 'Caucaia', responsavel: 'R Host', atualizado_local_em: '2026-11-11T00:00:00Z', criado_local_em: '2026-11-05T00:00:00Z' }),
  ];
  const slugs = (f: Partial<typeof FILTROS_VAZIOS>) => filtrar(lista, { ...FILTROS_VAZIOS, ...f }).map((p) => p.slug);
  assert.deepEqual(slugs({}), ['b', 'c', 'a'], 'mais recentes primeiro');
  assert.deepEqual(slugs({ ordem: 'antigos' }), ['a', 'c', 'b']);
  assert.deepEqual(slugs({ ordem: 'criados' }), ['c', 'a', 'b']);
  assert.deepEqual(slugs({ busca: 'estetico' }), ['a']);
  assert.deepEqual(slugs({ busca: '  PET ' }), ['b', 'c']);
  assert.deepEqual(slugs({ cidade: 'Cotia', responsavel: 'R Host' }), ['a']);
  assert.deepEqual(slugs({ status: 'site pronto' }), ['b']);
  assert.deepEqual(opcoes(lista, 'cidade'), ['Caucaia', 'Cotia']);
  assert.equal(filtrar(lista, FILTROS_VAZIOS) !== lista, true, 'não altera a lista original');
});

test('integração com o desktop', () => {
  const agora = Date.parse('2026-11-15T12:00:00Z');
  const d = (p: Partial<Dispositivo>): Dispositivo => ({ id: '1', nome: 'PC', versao_app: '1.0.0', conectado: true, ultimo_contato: '2026-11-15T11:58:00Z', ultima_sincronizacao: null, pendentes: 0, ultimo_erro: null, ...p });
  assert.equal(integracao([], agora).situacao, 'nenhum');
  assert.equal(integracao([d({})], agora).situacao, 'online');
  assert.equal(integracao([d({ ultimo_contato: new Date(agora - SEM_CONTATO_MS - 1).toISOString() })], agora).situacao, 'sem-contato');
  assert.equal(integracao([d({ conectado: false })], agora).situacao, 'desconectado');
  assert.equal(integracao([d({ id: 'velho', ultimo_contato: '2026-01-01T00:00:00Z' }), d({ id: 'novo' })], agora).dispositivo?.id, 'novo');
});

test('links: só http(s), nunca painel:// ou javascript:', () => {
  assert.equal(linkSeguro('https://lima-pet-salon-a.pages.dev/'), 'https://lima-pet-salon-a.pages.dev/');
  assert.equal(linkSeguro('painel://site/lima/dist/a/'), null);
  assert.equal(linkSeguro('javascript:alert(1)'), null);
  assert.equal(linkSeguro(null), null);
  assert.equal(descreverEvento({ id: '1', projeto_slug: 's', tipo: 'status', detalhe: { de: 'pesquisa', para: 'site pronto' }, ocorrido_em: '' }), 'Status: pesquisa → site pronto');
});
