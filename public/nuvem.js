// Cartão "Woods Web" das configurações. Separado do app.js: só conversa com as ações nuvem* do main.js.
// A senha vai uma vez para o main.js entrar no Supabase e não fica guardada. Tokens nunca chegam aqui.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(acao, dados) {
  const r = await window.painel.pedir(acao, dados);
  if (r.erro) throw new Error(r.erro);
  return r.ok;
}

const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');
let ultimoErroForm = '';

function desenhar(s) {
  const card = $('#p-nuvem');
  card.classList.toggle('feito', s.conectado && !s.expirada);
  $('#p-nuvem .situacao').textContent = s.conectado ? (s.expirada ? 'sessão expirada' : 'conectado') : 'desligado';
  const itens = [];
  if (s.conectado) {
    itens.push([!s.expirada, s.expirada ? `A sessão de ${s.email} expirou. Conecte de novo.` : `Conectado como ${s.email}`]);
    itens.push([true, `Última sincronização: ${quando(s.ultimaSincronia)}${s.sincronizando ? ' (sincronizando…)' : ''}`]);
    itens.push([s.pendentes === 0, s.pendentes ? `${s.pendentes} envio(s) pendente(s)` : 'Nada pendente']);
  }
  const erro = s.ultimoErro || ultimoErroForm;
  if (erro) itens.push([false, erro]);
  $('#nuvem-info').innerHTML = itens.map(([ok, t]) => `<li class="${ok ? 'ok' : 'ruim'}">${esc(t)}</li>`).join('');
  $('#form-nuvem').hidden = s.conectado && !s.expirada;
  $('#nuvem-acoes').hidden = !s.conectado;
  if (!$('#n-url').value) $('#n-url').value = s.url || '';
  if (!$('#n-chave').value) $('#n-chave').value = s.anonKey || '';
  if (!$('#n-email').value) $('#n-email').value = s.email || '';
}

async function atualizar() {
  if ($('#tela-config').hidden) return;
  try { desenhar(await api('nuvem')); } catch { /* o resto das configurações continua funcionando */ }
}

$('#form-nuvem').onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  ultimoErroForm = '';
  try {
    desenhar(await api('nuvemConectar', {
      url: $('#n-url').value, anonKey: $('#n-chave').value, email: $('#n-email').value, senha: $('#n-senha').value,
    }));
  } catch (err) {
    ultimoErroForm = err.message;
    await atualizar();
  } finally {
    $('#n-senha').value = '';
    b.disabled = false;
  }
};

$('#nuvem-acoes').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-nuvem]');
  if (!b) return;
  b.disabled = true;
  try { desenhar(await api(b.dataset.nuvem)); } catch (err) { ultimoErroForm = err.message; } finally { b.disabled = false; await atualizar(); }
});

// ---------- Sincronização entre computadores (espelho do WOODS pelo git) ----------
let erroSincronia = '';
function desenharSincronia(s) {
  const card = $('#p-sincronia');
  card.classList.toggle('feito', s.emDia && !s.conflito);
  $('#p-sincronia .situacao').textContent = s.conflito ? 'conflito' : s.emDia ? 'em dia' : s.clonado ? 'pendente' : '';
  const itens = [];
  if (!s.clonado) itens.push([false, 'Baixe o WOODS primeiro (passo 3).']);
  else {
    itens.push([s.emDia, `Última sincronização: ${quando(s.ultimaSincronia)}${s.sincronizando ? ' (sincronizando…)' : ''}`]);
    if (s.conflito) {
      itens.push([false, s.conflito.motivo]);
      for (const f of s.conflito.arquivos.slice(0, 8)) itens.push([false, f]);
      if (s.conflito.arquivos.length > 8) itens.push([false, `e mais ${s.conflito.arquivos.length - 8} arquivo(s)`]);
    }
    if (s.ultimoErro) itens.push([false, s.ultimoErro]);
    itens.push([s.nuvem, s.nuvem ? 'Conversas e preferências: pelo Woods Web' : 'Conversas e preferências só sincronizam com o Woods Web conectado (abaixo)']);
  }
  if (erroSincronia) itens.push([false, erroSincronia]);
  $('#sincronia-info').innerHTML = itens.map(([ok, t]) => `<li class="${ok ? 'ok' : 'ruim'}">${esc(t)}</li>`).join('');
  $('#sincronia-conflito').hidden = !s.conflito;
}

async function atualizarSincronia() {
  if ($('#tela-config').hidden) return;
  try { desenharSincronia(await api('espelho')); } catch { /* o resto das configurações continua funcionando */ }
}

$('#p-sincronia').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-sincronia]');
  if (!b) return;
  if (b.dataset.lado && !confirm(b.dataset.lado === 'local'
    ? 'A versão deste computador vai valer para todos. A outra fica guardada no histórico do git. Continuar?'
    : 'A versão do outro computador vai substituir a deste. A deste fica guardada no histórico do git. Continuar?')) return;
  const botoes = [...$('#p-sincronia').querySelectorAll('button')];
  botoes.forEach((x) => { x.disabled = true; });
  erroSincronia = '';
  try {
    desenharSincronia(await api(b.dataset.sincronia, { lado: b.dataset.lado }));
  } catch (err) {
    erroSincronia = err.message;
  } finally {
    botoes.forEach((x) => { x.disabled = false; });
    await atualizarSincronia();
    await atualizar();
  }
});

// Atualiza quando as configurações aparecem e, enquanto abertas, a cada 10 s
const tudo = () => { atualizar(); atualizarSincronia(); };
new MutationObserver(tudo).observe($('#tela-config'), { attributes: true, attributeFilter: ['hidden'] });
setInterval(tudo, 10_000);
tudo();
