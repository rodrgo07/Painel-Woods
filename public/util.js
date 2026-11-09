// Funções puras usadas pelo servidor e pela página.

export const SLUG_OK = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Fiot’s Centro Estético" → "fiot-s-centro-estetico" (mesma regra do novo-lead.js) */
export const slugar = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Campos da ficha do lead (vault/20-leads/<slug>.md) */
export function lerFicha(md) {
  const cab = md.startsWith('---') ? md.split('---')[1] : '';
  const campo = (k) => (cab.match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm')) || [])[1]?.trim() || '';
  const link = (v) => (md.match(new RegExp(`^- Link variante ${v}:[ \\t]*(https?://\\S+)`, 'm')) || [])[1] || '';
  return {
    nome: (md.match(/^# (.+)$/m) || [])[1]?.trim() || '',
    status: campo('status'),
    responsavel: campo('responsavel'),
    cidade: campo('cidade'),
    links: { a: link('A'), b: link('B') },
  };
}

/** Uma linha legível para cada ferramenta que o Claude usa */
export function resumir(nome, entrada = {}, base = '') {
  let det = String(entrada.command ?? entrada.file_path ?? entrada.url ?? entrada.pattern
    ?? entrada.query ?? entrada.element ?? entrada.description ?? '');
  const b = base.replaceAll('\\', '/').toLowerCase();
  const d = det.replaceAll('\\', '/');
  if (b && d.toLowerCase().startsWith(b + '/')) det = d.slice(b.length + 1);
  return {
    nome: nome.replace(/^mcp__playwright__browser_/, 'navegador ').replace(/^mcp__/, ''),
    det: det.slice(0, 400),
  };
}
