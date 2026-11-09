import { slugar } from './util.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lembrar = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

const estado = {
  leads: [], rodando: null, atual: null, lead: null, fonte: null, rodandoAqui: false,
  vista: lembrar('vista') || 'a', aparelho: lembrar('aparelho') || 'celular',
};

// ---------- Utilidades ----------
async function api(url, dados) {
  const r = await fetch(url, dados === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

const pill = (status) => (status ? `<span class="pill" data-status="${esc(status)}">${esc(status)}</span>` : '');

// Markdown mínimo das respostas do Claude
const md = (t) => esc(t)
  .replace(/^#{1,4} (.+)$/gm, '<strong>$1</strong>')
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

// ---------- Tema ----------
$('#tema').onclick = () => {
  const raiz = document.documentElement;
  const atual = raiz.dataset.tema || 'dark';
  raiz.dataset.tema = atual === 'dark' ? 'light' : 'dark';
  lembrar('tema', raiz.dataset.tema);
};

// ---------- Lista de leads ----------
async function carregarLista() {
  const j = await api('/api/leads');
  estado.leads = j.leads;
  estado.rodando = j.rodando;
  $('#aviso-login').hidden = j.temLogin;
  desenharLista();
}

function desenharLista() {
  const q = $('#busca').value.trim().toLowerCase();
  const itens = estado.leads.filter((l) => `${l.nome} ${l.slug} ${l.cidade}`.toLowerCase().includes(q));
  $('#lista').innerHTML = itens.map((l) => `
    <a class="item${l.slug === estado.atual ? ' ativo' : ''}" href="#/lead/${esc(l.slug)}">
      <span class="item-nome">${esc(l.nome)}${estado.rodando === l.slug ? '<span class="pulso" title="Claude trabalhando"></span>' : ''}</span>
      <span class="item-meta">${pill(l.status)}${l.cidade ? `<span>${esc(l.cidade)}</span>` : ''}</span>
    </a>`).join('') || `<p class="vazio-lista">${q ? 'Nada encontrado.' : 'Nenhum lead ainda.'}</p>`;
  const s = $('#claude-status');
  s.textContent = estado.rodando ? `Trabalhando em ${estado.rodando}` : 'Claude livre';
  s.classList.toggle('ativo', Boolean(estado.rodando));
}
$('#busca').oninput = desenharLista;

// ---------- Rotas: #/novo e #/lead/<slug> ----------
function rota() {
  const [, tipo, slug] = location.hash.split('/');
  estado.fonte?.close();
  estado.fonte = null;
  if (tipo === 'lead' && slug) abrirLead(decodeURIComponent(slug));
  else mostrarNovo();
}
window.addEventListener('hashchange', rota);

// ---------- Novo lead ----------
const form = $('#form-novo');
let slugManual = false;

function mostrarNovo() {
  estado.atual = null;
  desenharLista();
  $('#tela-lead').hidden = true;
  $('#tela-novo').hidden = false;
  form.reset();
  slugManual = false;
  form.responsavel.value = lembrar('responsavel') || 'R Host';
  form.nome.focus();
}

form.slug.oninput = () => { slugManual = Boolean(form.slug.value); };
form.nome.oninput = () => { if (!slugManual) form.slug.value = slugar(form.nome.value); };

form.onsubmit = async (e) => {
  e.preventDefault();
  const botao = form.querySelector('[type=submit]');
  botao.disabled = true;
  try {
    const dados = Object.fromEntries(new FormData(form));
    lembrar('responsavel', dados.responsavel);
    const { slug } = await api('/api/leads', dados);
    await carregarLista();
    location.hash = `#/lead/${slug}`;
  } catch (err) {
    toast(err.message);
  } finally {
    botao.disabled = false;
  }
};

// ---------- Lead ----------
async function abrirLead(slug) {
  estado.atual = slug;
  estado.rodandoAqui = false;
  desenharLista();
  $('#tela-novo').hidden = true;
  $('#tela-lead').hidden = false;
  $('#log').replaceChildren();
  try {
    await atualizarLead();
  } catch (err) {
    toast(err.message);
    return;
  }
  const fonte = estado.fonte = new EventSource(`/api/leads/${encodeURIComponent(slug)}/eventos`);
  fonte.onopen = () => $('#log').replaceChildren(); // reconexão manda o histórico de novo
  fonte.onmessage = (e) => receber(JSON.parse(e.data));
}

async function atualizarLead() {
  const l = estado.lead = await api(`/api/leads/${encodeURIComponent(estado.atual)}`);
  $('#lead-nome').textContent = l.nome;
  $('#lead-meta').innerHTML = [pill(l.status), esc(l.slug), esc(l.cidade), esc(l.responsavel)].filter(Boolean).join('<span class="ponto">·</span>');
  const links = ['a', 'b'].filter((v) => l.links[v])
    .map((v) => `<a class="btn" href="${esc(l.links[v])}" target="_blank" rel="noopener">${v.toUpperCase()} no ar ↗</a>`);
  if (l.status === 'site pronto') links.push('<button id="aprovar" class="btn primario" type="button">Aprovar e publicar</button>');
  $('#lead-acoes').innerHTML = links.join('');
  $('#aprovar')?.addEventListener('click', aprovar);
  desenharPalco();
}

function aprovar() {
  if (!confirm('Aprovar os prints e publicar?\nO Claude segue as etapas 7 e 8 (deploy, commit e push). O push ainda pede sua permissão aqui.')) return;
  mandar('Aprovado. Siga as etapas 7 e 8 do fluxo: deploy e fechar a tarefa.');
}

// ---------- Palco: prévia A/B, prints e ficha ----------
function marcarSeg(grupo, attr, valor) {
  grupo.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === valor)));
}

$('#vistas').onclick = (e) => {
  const v = e.target.closest('button')?.dataset.vista;
  if (!v) return;
  estado.vista = v;
  lembrar('vista', v);
  desenharPalco();
};
$('#aparelhos').onclick = (e) => {
  const a = e.target.closest('button')?.dataset.aparelho;
  if (!a) return;
  estado.aparelho = a;
  lembrar('aparelho', a);
  marcarSeg($('#aparelhos'), 'aparelho', a);
  ajustarEscala();
};
$('#recarregar').onclick = () => atualizarLead().catch((err) => toast(err.message));

function desenharPalco() {
  const l = estado.lead;
  const palco = $('#palco');
  const v = estado.vista;
  marcarSeg($('#vistas'), 'vista', v);
  marcarSeg($('#aparelhos'), 'aparelho', estado.aparelho);
  const ehSite = v === 'a' || v === 'b';
  $('#aparelhos').hidden = !ehSite;
  const abrir = $('#abrir');
  abrir.hidden = !ehSite || !l.site[v];
  abrir.href = ehSite ? `/site/${l.slug}/dist/${v}/` : '#';

  if (ehSite) {
    palco.innerHTML = l.site[v]
      ? `<div class="moldura"><iframe title="Variante ${v.toUpperCase()}" src="/site/${esc(l.slug)}/dist/${v}/?t=${Date.now()}"></iframe></div>`
      : vazio(`A variante ${v.toUpperCase()} ainda não foi gerada.`, 'O Claude roda o build depois de preencher o site.config.json.');
    ajustarEscala();
  } else if (v === 'prints') {
    palco.innerHTML = l.prints.length
      ? `<div class="prints">${l.prints.map((p) => `
          <a class="print" href="/site/${esc(l.slug)}/prints/${p.nome}.jpg?v=${p.v}" target="_blank" rel="noopener">
            <img src="/site/${esc(l.slug)}/prints/${p.nome}.jpg?v=${p.v}" alt="Print ${p.nome}" loading="lazy">
            <span>${p.nome.replace('-', ' · ')} px</span>
          </a>`).join('')}</div>`
      : vazio('Sem prints ainda.', 'Eles aparecem aqui quando o Claude roda npm run prints.');
  } else {
    palco.innerHTML = `<pre class="ficha">${esc(l.ficha)}</pre>`;
  }
}

const vazio = (titulo, texto) => `<div class="vazio"><strong>${esc(titulo)}</strong><span>${esc(texto)}</span></div>`;

// O site é desenhado na largura real (390 ou 1440 px) e reduzido para caber
function ajustarEscala() {
  const palco = $('#palco');
  const moldura = palco.querySelector('.moldura');
  if (!moldura) return;
  const largura = estado.aparelho === 'celular' ? 390 : 1440;
  const escala = Math.min(1, (palco.clientWidth - 48) / largura);
  const altura = palco.clientHeight - 48;
  moldura.style.width = `${largura * escala}px`;
  moldura.style.height = `${altura}px`;
  const f = moldura.querySelector('iframe');
  f.style.width = `${largura}px`;
  f.style.height = `${altura / escala}px`;
  f.style.transform = `scale(${escala})`;
}
new ResizeObserver(ajustarEscala).observe($('#palco'));

// ---------- Conversa com o Claude ----------
function receber(ev) {
  const log = $('#log');
  const noFim = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const add = (html, classe) => {
    const d = document.createElement('div');
    d.className = classe;
    d.innerHTML = html;
    log.append(d);
    return d;
  };

  switch (ev.t) {
    case 'eu': add(esc(ev.texto), 'msg msg-eu'); break;
    case 'claude': add(md(ev.texto), 'msg msg-claude'); break;
    case 'ferramenta': add(`<b>${esc(ev.nome)}</b><span>${esc(ev.det)}</span>`, 'ferr').title = ev.det; break;
    case 'permissao': {
      const d = add(`
        <div class="perm-titulo">Permissão: <b>${esc(ev.nome)}</b></div>
        <pre>${esc(ev.det)}</pre>
        <div class="perm-botoes">
          <button class="btn primario" type="button" data-perm="${ev.id}" data-ok="1">Permitir</button>
          <button class="btn" type="button" data-perm="${ev.id}" data-ok="1" data-sempre="1" title="Não pergunta de novo nesta sessão">Sempre</button>
          <button class="btn" type="button" data-perm="${ev.id}" data-ok="0">Negar</button>
        </div>`, 'perm');
      d.dataset.id = ev.id;
      break;
    }
    case 'resposta': fecharPermissao(ev.id, ev.ok ? 'Permitido' : 'Negado'); break;
    case 'fim': add(ev.ok ? `Concluído${ev.custo ? ` · US$ ${ev.custo.toFixed(2).replace('.', ',')}` : ''}` : esc(ev.erro || 'Terminou com erro'), ev.ok ? 'fim' : 'fim erro'); break;
    case 'erro': add(esc(ev.texto), 'msg erro'); break;
    case 'estado': {
      log.querySelectorAll('.perm:not(.respondida)').forEach((p) => {
        if (!ev.pendentes?.includes(p.dataset.id)) fecharPermissao(p.dataset.id, 'Expirou');
      });
      const terminou = estado.rodandoAqui && !ev.rodando;
      estado.rodandoAqui = ev.rodando;
      $('#trabalhando').hidden = !ev.rodando;
      $('#parar').hidden = !ev.rodando;
      $('#mandar').disabled = ev.rodando;
      $('#atalhos').hidden = ev.rodando;
      if (ev.rodando) estado.rodando = estado.atual;
      if (terminou) {
        atualizarLead().catch(() => {});
        carregarLista().catch(() => {});
      } else desenharLista();
      break;
    }
  }
  if (noFim) log.scrollTop = log.scrollHeight;
}

function fecharPermissao(id, rotulo) {
  const card = $('#log').querySelector(`.perm[data-id="${CSS.escape(id)}"]`);
  if (!card || card.classList.contains('respondida')) return;
  card.classList.add('respondida');
  card.querySelector('.perm-botoes').innerHTML = `<span class="suave">${rotulo}</span>`;
}

$('#log').onclick = async (e) => {
  const b = e.target.closest('[data-perm]');
  if (!b) return;
  try {
    await api(`/api/permissao/${b.dataset.perm}`, { ok: b.dataset.ok === '1', sempre: Boolean(b.dataset.sempre) });
  } catch (err) {
    toast(err.message);
    fecharPermissao(b.dataset.perm, 'Expirou');
  }
};

async function mandar(texto) {
  try {
    await api(`/api/leads/${encodeURIComponent(estado.atual)}/mensagem`, { texto });
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

$('#enviar').onsubmit = async (e) => {
  e.preventDefault();
  const texto = $('#msg').value.trim();
  if (texto && await mandar(texto)) $('#msg').value = '';
};
$('#msg').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!$('#mandar').disabled) $('#enviar').requestSubmit();
  }
};
$('#atalhos').onclick = (e) => { const t = e.target.closest('[data-texto]')?.dataset.texto; if (t) mandar(t); };
$('#parar').onclick = () => api(`/api/leads/${encodeURIComponent(estado.atual)}/parar`, {}).catch((err) => toast(err.message));

// ---------- Início ----------
carregarLista().then(rota).catch((err) => toast(err.message));
setInterval(() => carregarLista().catch(() => {}), 10000);
