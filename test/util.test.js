import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugar, SLUG_OK, lerFicha, resumir } from './public/util.js';

test('slugar gera slug válido para o novo-lead.js', () => {
  assert.equal(slugar('  Recanto Pet!  '), 'recanto-pet');
  assert.equal(slugar('Fiot’s Centro Estético de Animais'), 'fiot-s-centro-estetico-de-animais');
  assert.ok(SLUG_OK.test(slugar('Ção & Cia')));
  assert.ok(!SLUG_OK.test('../etc'));
});

test('lerFicha lê o cabeçalho, o título e os links', () => {
  const md = '---\nstatus: site pronto\nresponsavel: R Host\ncidade: Cotia\n---\n# Pet X\n- Status: pesquisa | site pronto\n'
    + '- Link variante A: https://pet-x-a.pages.dev/\n- Link variante B:\n';
  assert.deepEqual(lerFicha(md), {
    nome: 'Pet X', status: 'site pronto', responsavel: 'R Host', cidade: 'Cotia',
    links: { a: 'https://pet-x-a.pages.dev/', b: '' },
  });
});

test('resumir encurta caminhos do WOODS e nomes do Playwright', () => {
  assert.deepEqual(resumir('Edit', { file_path: 'C:\\W\\WOODS\\sites\\x\\a.json' }, 'C:\\W\\WOODS'), { nome: 'Edit', det: 'sites/x/a.json' });
  assert.deepEqual(resumir('mcp__playwright__browser_navigate', { url: 'https://g.co' }), { nome: 'navegador navigate', det: 'https://g.co' });
});
