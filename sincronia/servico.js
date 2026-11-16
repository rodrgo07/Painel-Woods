/*
 * Serviço de sincronização com o Woods Web (Supabase). Separado da geração dos sites:
 * só LÊ o WOODS e as linhas de estado da conversa, nunca escreve nele nem mexe no Claude.
 *
 * A cada minuto (e logo depois de um evento do painel): compara os leads com a última foto,
 * põe na fila o que mudou e envia a fila. Sem internet ou com o Supabase fora, a fila espera
 * no disco e as tentativas se espaçam (30 s → 30 min). Nada aqui pode derrubar o app.
 *
 * Arquivos em <dados>:
 *   nuvem.json        URL e chave pública do projeto, e-mail, id do usuário e do aparelho,
 *                     token de renovação cifrado pelo Windows (safeStorage/DPAPI)
 *   nuvem-estado.json fila pendente, última foto de cada lead, prints já enviados, última sincronização
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Fila, gravarJson, lerJson } from './fila.js';
import { criarCliente, conferirConfig, ErroNuvem } from './supabase.js';
import { lerProjetos, paraLinha, eventos, eventoDaConversa } from './mapa.js';

const BUCKET = 'previas';
const MAX_IMAGEM = 5 * 1024 * 1024;  // igual ao limite do bucket
const CONTATO = 5 * 60_000;           // avisa que o desktop está vivo no máximo a cada 5 min

// Função, não objeto: cada estado novo tem os próprios objetos (nada compartilhado entre conexões)
const vazio = () => ({ fila: [], fotos: {}, linhas: {}, previas: {}, erros: {}, primeiraFeita: false, ultimaSincronia: null, ultimoErro: '' });

/**
 * dados: pasta do usuário; woods: pasta do WOODS; fetch: net.fetch do Electron;
 * cofre: { disponivel(), cifrar(texto) → base64, decifrar(base64) → texto } (safeStorage)
 */
export function criarServico({ dados, woods, fetch, cofre, versao = '', maquina = '', registrar = () => {}, intervalo = 60_000, agora = () => Date.now() }) {
  const ARQ_CFG = path.join(dados, 'nuvem.json');
  const ARQ_EST = path.join(dados, 'nuvem-estado.json');
  let cfg = lerJson(ARQ_CFG, { url: '', anonKey: '', email: '', usuarioId: '', dispositivoId: '', renovacao: '' });
  let est = lerJson(ARQ_EST, vazio());
  let fila = new Fila(Array.isArray(est.fila) ? est.fila : []);
  let sessao = null;             // { acesso, expira }: só em memória
  let expirada = false;          // a renovação foi recusada: precisa entrar de novo
  let rodando = null;            // promessa da sincronização em andamento
  let timer = null;
  let adiada = null;
  let ultimoContato = 0;
  const conversando = {};        // slug → o Claude está trabalhando nele (para achar o início)

  const salvarCfg = () => gravarJson(ARQ_CFG, cfg);
  const salvarEst = () => gravarJson(ARQ_EST, { ...est, fila });
  const conectado = () => Boolean(cfg.url && cfg.anonKey && cfg.renovacao && cfg.usuarioId);
  const cliente = () => criarCliente({ url: cfg.url, anonKey: cfg.anonKey, fetch });
  const iso = (ms = agora()) => new Date(ms).toISOString();
  const anotarErro = (msg) => { est.ultimoErro = String(msg || '').slice(0, 300); };

  function situacao() {
    return {
      configurado: Boolean(cfg.url && cfg.anonKey), conectado: conectado(), expirada,
      url: cfg.url, anonKey: cfg.anonKey, email: cfg.email,
      pendentes: fila.tamanho, ultimaSincronia: est.ultimaSincronia, ultimoErro: est.ultimoErro,
      sincronizando: Boolean(rodando),
    };
  }

  // ---------- Sessão ----------
  async function token() {
    if (sessao && sessao.expira - 60_000 > agora()) return sessao.acesso;
    let renovacao;
    try { renovacao = cofre.decifrar(cfg.renovacao); } catch { renovacao = ''; }
    if (!renovacao) { expirada = true; throw new ErroNuvem('Sessão do Woods Web perdida. Conecte de novo.', { sessao: true }); }
    try {
      const s = await cliente().renovar(renovacao);
      sessao = { ...s, expira: agora() + s.validade };
      expirada = false;
      cfg.renovacao = cofre.cifrar(s.renovacao); // o Supabase troca o token de renovação a cada uso
      salvarCfg();
      return s.acesso;
    } catch (e) {
      if (e.sessao) expirada = true;
      throw e;
    }
  }

  // ---------- Leitura do WOODS → fila ----------
  function enfileirar(op) { fila.adicionar(op, agora()); }

  function varrer() {
    if (!conectado()) return;
    let projetos;
    try { projetos = lerProjetos(woods); } catch (e) { registrar(`nuvem: ler o WOODS: ${e.message}`); return; }
    const primeira = !est.primeiraFeita;
    for (const p of projetos) {
      const antes = est.fotos[p.slug];
      const linha = JSON.stringify(paraLinha(p, est.erros[p.slug]));
      if (est.linhas[p.slug] !== linha) {
        enfileirar({ chave: `projeto:${p.slug}`, tipo: 'projeto', dados: JSON.parse(linha) });
        est.linhas[p.slug] = linha;
      }
      for (const ev of eventos(antes, p, { primeira, agora: iso() })) enfileirar({ chave: `evento:${ev.id}`, tipo: 'evento', dados: ev });
      for (const [nome, v] of Object.entries(p.prints)) {
        if (est.previas[`${p.slug}/${nome}`] !== v) enfileirar({ chave: `previa:${p.slug}/${nome}`, tipo: 'previa', dados: { slug: p.slug, nome } });
      }
      est.fotos[p.slug] = p;
    }
    est.primeiraFeita = true;
    salvarEst();
  }

  // ---------- Fila → Supabase ----------
  async function executar(op, t) {
    const c = cliente();
    const dono = cfg.usuarioId;
    if (op.tipo === 'projeto') {
      await c.upsert('projetos', [{ ...op.dados, owner_id: dono, sincronizado_em: iso() }], { token: t, conflito: 'owner_id,slug' });
    } else if (op.tipo === 'evento') {
      await c.upsert('eventos', [{ ...op.dados, owner_id: dono }], { token: t, ignorar: true });
    } else if (op.tipo === 'previa') {
      const { slug, nome } = op.dados;
      const arq = path.join(woods, 'sites', slug, 'prints', `${nome}.jpg`);
      const st = fs.statSync(arq, { throwIfNoEntry: false });
      if (!st) return; // o print saiu do disco: nada a enviar
      if (st.size > MAX_IMAGEM) throw new ErroNuvem(`O print ${nome} passa de 5 MB`);
      const caminho = `${dono}/${slug}/${nome}.jpg`;
      await c.enviarArquivo(BUCKET, caminho, fs.readFileSync(arq), 'image/jpeg', { token: t });
      await c.upsert('previas', [{ owner_id: dono, projeto_slug: slug, nome, storage_path: caminho, atualizado_local_em: iso(st.mtimeMs) }],
        { token: t, conflito: 'owner_id,projeto_slug,nome' });
      est.previas[`${slug}/${nome}`] = Math.round(st.mtimeMs);
    }
  }

  async function avisarContato(t, forcar = false) {
    if (!cfg.dispositivoId || (!forcar && agora() - ultimoContato < CONTATO)) return;
    try {
      await cliente().upsert('dispositivos', [{
        id: cfg.dispositivoId, owner_id: cfg.usuarioId, nome: maquina.slice(0, 100), versao_app: versao.slice(0, 40), conectado: true,
        ultimo_contato: iso(), ultima_sincronizacao: est.ultimaSincronia, pendentes: fila.tamanho, ultimo_erro: est.ultimoErro || null,
      }], { token: t, conflito: 'id' });
      ultimoContato = agora();
    } catch (e) {
      registrar(`nuvem: aviso do aparelho: ${e.message}`);
    }
  }

  async function enviar() {
    let t = await token();
    const tinha = fila.tamanho;
    let parou = false;
    for (const op of fila.prontas(agora())) {
      try {
        try {
          await executar(op, t);
        } catch (e) {
          if (!e.sessao) throw e;
          sessao = null; // token recusado antes da hora: renova e tenta esta operação mais uma vez
          t = await token();
          await executar(op, t);
        }
        fila.concluir(op.chave);
        if (op.tipo !== 'projeto' && est.erros[op.dados.slug ?? op.dados.projeto_slug]) delete est.erros[op.dados.slug ?? op.dados.projeto_slug];
      } catch (e) {
        if (e.sessao) { sessao = null; throw e; }
        const desistiu = fila.falhar(op.chave, e.message, { permanente: !e.temporario, agora: agora() });
        registrar(`nuvem: ${op.chave}: ${e.message}${desistiu ? ' (desisti)' : ''}`);
        anotarErro(e.message);
        if (e.temporario) { parou = true; break; } // sem rede ou Supabase fora: espera a próxima rodada
        const slug = op.dados.slug ?? op.dados.projeto_slug;
        if (slug) est.erros[slug] = e.message; // aparece no painel web como problema de sincronização
      } finally {
        salvarEst();
      }
    }
    if (!parou) {
      est.ultimaSincronia = iso();
      if (!fila.prontas(agora()).length && !fila.tamanho) anotarErro('');
      salvarEst();
    }
    await avisarContato(t, tinha !== fila.tamanho);
  }

  /** Uma rodada completa. Nunca lança: o erro fica em situacao().ultimoErro */
  function sincronizar() {
    if (rodando) return rodando;
    if (!conectado()) return Promise.resolve(situacao());
    rodando = (async () => {
      try {
        varrer();
        await enviar();
        varrer(); // erro novo de um projeto: manda a linha com o erro já nesta rodada
        if (fila.prontas(agora()).length) await enviar();
      } catch (e) {
        anotarErro(e.message);
        salvarEst();
        if (!e.temporario) registrar(`nuvem: ${e.message}`);
      } finally {
        rodando = null;
      }
      return situacao();
    })();
    return rodando;
  }

  function adiar(ms = 3000) {
    clearTimeout(adiada);
    adiada = setTimeout(() => { sincronizar(); }, ms);
    adiada.unref?.();
  }

  // ---------- Conectar e desconectar (pelas configurações do painel) ----------
  async function conectar({ url, anonKey, email, senha }) {
    const conf = conferirConfig({ url, anonKey });
    email = String(email || '').trim();
    if (!email || !senha) throw new ErroNuvem('Preencha o e-mail e a senha da conta do Woods Web.');
    if (!cofre.disponivel()) throw new ErroNuvem('O Windows não liberou o cofre (DPAPI) para guardar a sessão.');
    const s = await criarCliente({ ...conf, fetch }).entrar(email, String(senha));
    if (!s.usuario.id || !s.renovacao) throw new ErroNuvem('O Supabase não devolveu a sessão.');
    if (cfg.usuarioId !== s.usuario.id || cfg.url !== conf.url) { // outra conta ou outro projeto: começa do zero
      est = vazio();
      fila = new Fila();
    }
    cfg = {
      ...conf, email: s.usuario.email || email, usuarioId: s.usuario.id,
      dispositivoId: cfg.dispositivoId || crypto.randomUUID(), renovacao: cofre.cifrar(s.renovacao),
    };
    sessao = { ...s, expira: agora() + s.validade };
    expirada = false;
    salvarCfg();
    salvarEst();
    ultimoContato = 0;
    sincronizar();
    return situacao();
  }

  async function desconectar() {
    if (conectado()) {
      try {
        const t = await token();
        const c = cliente();
        await c.upsert('dispositivos', [{ id: cfg.dispositivoId, owner_id: cfg.usuarioId, conectado: false, ultimo_contato: iso(), pendentes: fila.tamanho }],
          { token: t, conflito: 'id' }).catch(() => {});
        await c.sair(t).catch(() => {});
      } catch { /* sem rede: só esquece a sessão aqui */ }
    }
    // Fica a fila e a foto: reconectar na mesma conta continua de onde parou
    cfg = { ...cfg, renovacao: '' };
    sessao = null;
    expirada = false;
    salvarCfg();
    return situacao();
  }

  /** Linha de evento da conversa (o mesmo que vai para a janela). Só o tipo do evento é usado, nunca o texto */
  function aoEvento(slug, linha) {
    try {
      if (!slug || !conectado() || !/"t":"(estado|fim)"/.test(linha)) return;
      const ev = eventoDaConversa(slug, linha, conversando[slug]);
      const e = JSON.parse(linha);
      if (e.t === 'estado') conversando[slug] = Boolean(e.rodando);
      if (!ev) return;
      varrer(); // lead recém-criado: a linha do projeto entra na fila antes do evento
      enfileirar({ chave: `evento:${ev.id}`, tipo: 'evento', dados: ev });
      salvarEst();
      adiar();
    } catch (e) {
      registrar(`nuvem: evento: ${e.message}`);
    }
  }

  return {
    situacao, conectar, desconectar, sincronizar, aoEvento,
    /** Tenta já o que estava esperando (a internet voltou, o PC acordou, o usuário pediu) */
    agora: () => { fila.liberar(agora()); return sincronizar(); },
    iniciar() {
      if (timer) return;
      timer = setInterval(() => { sincronizar(); }, intervalo);
      timer.unref?.();
      adiar(5000);
    },
    parar() { clearInterval(timer); clearTimeout(adiada); timer = null; },
  };
}
