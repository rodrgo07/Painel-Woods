import { slugar } from './util.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lembrar = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
const SITE = 'painel://site'; // prévia e prints dos leads, servidos pelo app em outra origem

const estado = {
  sit: null, // situação geral vinda do app: o que falta, configurações, leads
  leads: [], rodando: null, atual: null, lead: null, aoVivo: null, rodandoAqui: false,
  vista: lembrar('vista') || 'a', aparelho: lembrar('aparelho') || 'celular',
  checagem: null, github: false,
};

// ---------- Utilidades ----------
/** Pede uma ação ao app (window.painel vem do preload) */
async function api(acao, dados) {
  const r = await window.painel.pedir(acao, dados);
  if (r.erro) throw new Error(r.erro);
  return r.ok;
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
const TELAS = ['#tela-config', '#tela-novo', '#tela-lead'];
const mostrar = (qual) => TELAS.forEach((t) => { $(t).hidden = t !== qual; });

// Markdown mínimo das respostas do Claude
const md = (t) => esc(t)
  .replace(/^#{1,4} (.+)$/gm, '<strong>$1</strong>')
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

// ---------- Lista de leads ----------
async function carregarLista() {
  const s = estado.sit = await api('inicio');
  estado.leads = s.leads;
  estado.rodando = s.rodando;
  const aviso = $('#aviso');
  aviso.hidden = !s.falta.length && !s.novidades;
  aviso.textContent = s.falta.length ? 'Configuração incompleta. Abrir as configurações.'
    : `O WOODS tem ${s.novidades === 1 ? '1 atualização' : `${s.novidades} atualizações`}. Abrir as configurações.`;
  desenharLista();
  if (!$('#tela-config').hidden) desenharConfig();
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

// ---------- Rotas: #/config, #/novo e #/lead/<slug> ----------
function rota() {
  const [, tipo, slug] = location.hash.split('/');
  estado.aoVivo = null;
  // Primeira execução (ou algo quebrou): só as configurações, até não faltar nada
  if (tipo !== 'config' && estado.sit?.falta.length) { location.hash = '#/config'; return; }
  if (tipo === 'config') mostrarConfig();
  else if (tipo === 'lead' && slug) abrirLead(decodeURIComponent(slug));
  else mostrarNovo();
}
window.addEventListener('hashchange', rota);

// ---------- Configurações e primeira execução ----------
function mostrarConfig() {
  estado.atual = null;
  desenharLista();
  mostrar('#tela-config');
  const c = estado.sit.config;
  $('#c-modelo').innerHTML = estado.sit.modelos.map((m) => `<option>${esc(m)}</option>`).join('');
  $('#c-modelo').value = c.modelo;
  $('#c-navegador').value = c.navegador;
  $('#c-git-nome').value = c.gitNome;
  $('#c-git-email').value = c.gitEmail;
  desenharConfig();
  checar();
}

async function checar() {
  estado.checagem = await api('checar').catch(() => null);
  desenharConfig();
}

function passo(id, feito) {
  $(id).classList.toggle('feito', feito);
  $(`${id} .situacao`).textContent = feito ? 'pronto' : 'pendente';
}

function desenharConfig() {
  const s = estado.sit;
  const k = estado.checagem;
  $('#config-titulo').textContent = s.falta.length ? 'Bem-vindo ao Painel Woods' : 'Configurações';
  $('#config-sub').textContent = s.falta.length ? `Falta: ${s.falta.join('; ')}.` : `Tudo pronto. Versão ${s.versao}.`;

  const itens = [[Boolean(s.navegador), s.navegador ? `Navegador: ${s.navegador}` : 'Sem Chrome nem Edge. Baixe o Chromium no botão abaixo.']];
  if (k) {
    itens.push([k.internet, k.internet ? 'Internet funcionando' : 'Sem acesso ao github.com'],
      [k.livreGb >= 2, `${k.livreGb} GB livres no disco${k.livreGb >= 2 ? '' : ' (o painel precisa de 2 GB)'}`]);
  }
  $('#checagens').innerHTML = itens.map(([ok, t]) => `<li class="${ok ? 'ok' : 'ruim'}">${esc(t)}</li>`).join('')
    + (k ? '' : '<li class="suave">Verificando internet e disco…</li>');
  $('#b-chromium').hidden = Boolean(s.navegador);
  passo('#p-pc', itens.every(([ok]) => ok));

  passo('#p-github', s.clonado || estado.github);

  passo('#p-woods', s.clonado && s.deps);
  $('#e-woods').textContent = !s.clonado ? `Vai ser baixado em ${s.pasta}`
    : !s.deps ? 'Baixado. Faltam as dependências (npm).'
    : `Em ${s.pasta}${s.novidades ? `. Há ${s.novidades === 1 ? '1 atualização' : `${s.novidades} atualizações`} no GitHub.` : ''}`;
  $('#b-woods').hidden = s.clonado && s.deps;
  $('#b-woods').textContent = s.clonado ? 'Instalar as dependências' : 'Baixar o WOODS';
  $('#b-atualizar').hidden = !s.clonado;

  passo('#p-claude', s.temLogin);
  $('#e-claude').textContent = s.temChave ? 'Usando a chave da API guardada no cofre do Windows.'
    : s.temLogin ? 'Conta do Claude conectada.'
    : 'Entre com a conta do Claude (abre uma janela de terminal e o navegador) ou use uma chave da API.';
  $('#b-sem-chave').hidden = !s.temChave;
  $('[data-acao="loginClaude"]').classList.toggle('primario', !s.temLogin);

  passo('#p-git', Boolean(s.config.gitNome && s.config.gitEmail));
  $('#config-pronto').hidden = Boolean(s.falta.length);
}

/** Barra de progresso das tarefas longas. Erro fica na tela até a próxima ação */
function progresso(ev) {
  const p = $('#progresso');
  if (ev.fim) { if (!p.classList.contains('erro')) p.hidden = true; return; }
  p.hidden = false;
  p.classList.toggle('erro', Boolean(ev.erro));
  $('#prog-titulo').textContent = ev.titulo;
  $('#prog-linha').textContent = ev.linha || '';
  const barra = $('#prog-barra');
  barra.hidden = Boolean(ev.erro);
  if (ev.pct >= 0) barra.value = ev.pct; else barra.removeAttribute('value'); // sem valor: barra indeterminada
}

const FEITO = {
  github: 'Acesso ao GitHub confirmado.', baixarWoods: 'WOODS pronto.', baixarChromium: 'Chromium baixado.',
  loginClaude: 'Termine o login na janela que abriu. O painel percebe sozinho.', removerChave: 'Chave removida.',
};
$('#tela-config').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-acao]');
  if (!b) return;
  const acao = b.dataset.acao;
  b.disabled = true;
  $('#progresso').hidden = true;
  $('#progresso').classList.remove('erro');
  try {
    if (acao === 'checar') { estado.checagem = null; desenharConfig(); await checar(); return; }
    const r = await api(acao === 'removerChave' ? 'salvarChave' : acao, {});
    if (acao === 'github') estado.github = true;
    if (acao === 'atualizar') toast(r.commits ? `WOODS atualizado: ${r.commits === 1 ? '1 commit novo' : `${r.commits} commits novos`}.` : 'O WOODS já estava atualizado.');
    else if (acao === 'importar' && r.importadas >= 0) toast(r.importadas ? `${r.importadas} conversas importadas.` : 'Nenhuma conversa nova nessa pasta.');
    else if (FEITO[acao]) toast(FEITO[acao]);
  } catch (err) {
    progresso({ erro: true, titulo: 'Não deu certo', linha: err.message });
  } finally {
    b.disabled = false;
    await carregarLista().catch(() => {});
  }
});

async function salvarConfig(dados, aviso) {
  try {
    await api('salvarConfig', dados);
    await carregarLista();
    if (aviso) toast(aviso);
  } catch (err) {
    toast(err.message);
  }
}
$('#c-modelo').onchange = (e) => salvarConfig({ modelo: e.target.value }, 'Modelo salvo.');
$('#c-navegador').onchange = (e) => salvarConfig({ navegador: e.target.value }, 'Navegador salvo.');
$('#p-git').onsubmit = (e) => {
  e.preventDefault();
  salvarConfig({ gitNome: $('#c-git-nome').value, gitEmail: $('#c-git-email').value }, 'Assinatura salva.');
};
$('#form-chave').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('salvarChave', { chave: $('#c-chave').value });
    $('#c-chave').value = '';
    await carregarLista();
    toast('Chave guardada no cofre do Windows.');
  } catch (err) {
    toast(err.message);
  }
};

// ---------- Novo lead ----------
const form = $('#form-novo');
let slugManual = false;

function mostrarNovo() {
  estado.atual = null;
  desenharLista();
  mostrar('#tela-novo');
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
    const { slug } = await api('criar', dados);
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
  mostrar('#tela-lead');
  $('#log').replaceChildren();
  try {
    await atualizarLead();
    const h = await api('eventos', { slug });
    if (estado.atual !== slug) return; // trocou de lead enquanto carregava
    for (const linha of h.linhas) { try { receber(JSON.parse(linha)); } catch { /* linha cortada no histórico */ } }
    receber(h.estado);
    estado.aoVivo = slug; // daqui em diante os eventos chegam ao vivo
  } catch (err) {
    toast(err.message);
  }
}

window.painel.ouvir((slug, linha) => {
  const ev = JSON.parse(linha);
  if (ev.t === 'progresso') progresso(ev);
  else if (slug === estado.aoVivo) receber(ev);
});

async function atualizarLead() {
  const l = estado.lead = await api('lead', { slug: estado.atual });
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
  abrir.href = ehSite ? `${SITE}/${l.slug}/dist/${v}/` : '#';

  if (ehSite) {
    palco.innerHTML = l.site[v]
      ? `<div class="moldura"><iframe title="Variante ${v.toUpperCase()}" src="${SITE}/${esc(l.slug)}/dist/${v}/?t=${Date.now()}"></iframe></div>`
      : vazio(`A variante ${v.toUpperCase()} ainda não foi gerada.`, 'O Claude roda o build depois de preencher o site.config.json.');
    ajustarEscala();
  } else if (v === 'prints') {
    palco.innerHTML = l.prints.length
      ? `<div class="prints">${l.prints.map((p) => `
          <a class="print" href="${SITE}/${esc(l.slug)}/prints/${p.nome}.jpg?v=${p.v}" target="_blank" rel="noopener">
            <img src="${SITE}/${esc(l.slug)}/prints/${p.nome}.jpg?v=${p.v}" alt="Print ${p.nome}" loading="lazy">
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
          <button class="btn primario" type="button" data-perm="${esc(ev.id)}" data-ok="1">Permitir</button>
          <button class="btn" type="button" data-perm="${esc(ev.id)}" data-ok="1" data-sempre="1" title="Não pergunta de novo nesta sessão">Sempre</button>
          <button class="btn" type="button" data-perm="${esc(ev.id)}" data-ok="0">Negar</button>
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
    await api('permissao', { id: b.dataset.perm, ok: b.dataset.ok === '1', sempre: Boolean(b.dataset.sempre) });
  } catch (err) {
    toast(err.message);
    fecharPermissao(b.dataset.perm, 'Expirou');
  }
};

async function mandar(texto) {
  try {
    await api('mensagem', { slug: estado.atual, texto });
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
$('#parar').onclick = () => api('parar', { slug: estado.atual }).catch((err) => toast(err.message));

// ---------- Início ----------
carregarLista().then(rota).catch((err) => toast(err.message));
setInterval(() => carregarLista().catch(() => {}), 10000);
// Voltou do navegador ou do terminal (login do GitHub ou do Claude): confere na hora
window.addEventListener('focus', () => carregarLista().catch(() => {}));
