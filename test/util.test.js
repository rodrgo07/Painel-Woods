import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugar, SLUG_OK, lerFicha, gravarNaFicha, resumir } from '../public/util.js';

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

test('gravarNaFicha anota Instagram e cidade só nos campos vazios, em uma linha', () => {
  const modelo = '---\nstatus: pesquisa\ncidade:\n---\n# Pet X\n- Nicho / Cidade:\n- Instagram:\n- WhatsApp:\n';
  const md = gravarNaFicha(modelo, { instagram: '@petx $1\nstatus: publicado', cidade: ' Cotia ' });
  assert.equal(lerFicha(md).cidade, 'Cotia');
  assert.equal(lerFicha(md).status, 'pesquisa', 'quebra de linha no campo não cria outro campo');
  assert.ok(md.includes('\n- Instagram: @petx $1 status: publicado\n- WhatsApp:'));
  assert.equal(gravarNaFicha(modelo, { instagram: '', cidade: '' }), modelo);
  assert.equal(gravarNaFicha(md, { instagram: '@outro', cidade: 'Jundiaí' }), md, 'não troca o que já está preenchido');
});

test('resumir encurta caminhos do WOODS e nomes do Playwright', () => {
  assert.deepEqual(resumir('Edit', { file_path: 'C:\\W\\WOODS\\sites\\x\\a.json' }, 'C:\\W\\WOODS'), { nome: 'Edit', det: 'sites/x/a.json' });
  assert.deepEqual(resumir('mcp__playwright__browser_navigate', { url: 'https://g.co' }), { nome: 'navegador navigate', det: 'https://g.co' });
});
