/*
 * Serviço de sincronização com o Woods Web (Supabase). Separado da geração dos sites:
 * só LÊ o WOODS e as linhas de estado da conversa, nunca escreve nele nem mexe no Claude.
 *
 * A cada minuto (e logo depois de um evento do painel): compara os leads com a última foto,
 * põe na fila o que mudou e envia a fila. Sem internet ou com o Supabase fora, a fila espera
 * no disco e as tentativas se espaçam (30 s → 30 min). Nada aqui pode derrubar o app.
 *
 * Arquivos em <dados>:
 *   nuvem.json        URL e chave pública do projeto, e-mail, id do usuário, da equipe e do aparelho,
 *                     nome na equipe, token de renovação cifrado pelo Windows (safeStorage/DPAPI)
 *
 * Equipe: os dados vão para a equipe da conta (tabela membros), e o sócio vê tudo. Cada PC manda o que está
 * no próprio WOODS; o banco ignora a versão mais velha (a data vem do git, veja criarDatasGit).
 *   nuvem-estado.json fila pendente, última foto de cada lead, prints já enviados, última sincronização
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Fila, gravarJson, lerJson } from './fila.js';
import { criarCliente, conferirConfig, ErroNuvem } from './supabase.js';
import { lerProjetos, paraLinha, eventos, eventoDaConversa, criarDatasGit } from './mapa.js';

const BUCKET = 'previas';
const MAX_IMAGEM = 5 * 1024 * 1024;  // igual ao limite do bucket
const CONTATO = 5 * 60_000;           // avisa que o desktop está vivo no máximo a cada 5 min
export const VIVO = 15 * 60_000;      // sem contato há mais que isso: o PC está fechado (o "em andamento" dele não vale)

// Função, não objeto: cada estado novo tem os próprios objetos (nada compartilhado entre conexões)
const vazio = () => ({ fila: [], fotos: {}, linhas: {}, previas: {}, erros: {}, primeiraFeita: false, ultimaSincronia: null, ultimoErro: '' });

/**
 * dados: pasta do usuário; woods: pasta do WOODS; fetch: net.fetch do Electron;
 * cofre: { disponivel(), cifrar(texto) → base64, decifrar(base64) → texto } (safeStorage);
 * git: (args) → stdout, rodando no WOODS (opcional; sem ele as datas são as dos arquivos)
 */
export function criarServico({ dados, woods, fetch, cofre, git = null, versao = '', maquina = '', registrar = () => {}, intervalo = 60_000, agora = () => Date.now() }) {
  const ARQ_CFG = path.join(dados, 'nuvem.json');
  const ARQ_EST = path.join(dados, 'nuvem-estado.json');
  let cfg = lerJson(ARQ_CFG, { url: '', anonKey: '', email: '', usuarioId: '', equipeId: '', nome: '', dispositivoId: '', renovacao: '' });
  const datas = git ? criarDatasGit(git) : null;
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
  const cliente = (tempo) => criarCliente({ url: cfg.url, anonKey: cfg.anonKey, fetch, tempo });
  const iso = (ms = agora()) => new Date(ms).toISOString();
  const anotarErro = (msg) => { est.ultimoErro = String(msg || '').slice(0, 300); };

  function situacao() {
    return {
      configurado: Boolean(cfg.url && cfg.anonKey), conectado: conectado(), expirada,
      url: cfg.url, anonKey: cfg.anonKey, email: cfg.email, nome: cfg.nome, equipe: Boolean(cfg.equipeId),
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
    let quando;
    if (datas) {
      try { quando = datas(); } catch (e) { registrar(`nuvem: datas pelo git: ${e.message}`); } // segue com as datas dos arquivos
    }
    let projetos;
    try { projetos = lerProjetos(woods, quando); } catch (e) { registrar(`nuvem: ler o WOODS: ${e.message}`); return; }
    const primeira = !est.primeiraFeita;
    removidos(projetos);
    for (const p of projetos) {
      const antes = est.fotos[p.slug];
      const linha = JSON.stringify(paraLinha(p, est.erros[p.slug]));
      if (est.linhas[p.slug] !== linha) {
        enfileirar({ chave: `projeto:${p.slug}`, tipo: 'projeto', dados: JSON.parse(linha) });
        est.linhas[p.slug] = linha;
      }
      for (const ev of eventos(antes, p, { primeira, agora: iso() })) enfileirar({ chave: `evento:${ev.id}`, tipo: 'evento', dados: ev });
      for (const [nome, v] of Object.entries(p.prints)) {
        if (est.previas[`${p.slug}/${nome}`] !== v) enfileirar({ chave: `previa:${p.slug}/${nome}`, tipo: 'previa', dados: { slug: p.slug, nome, em: v } });
      }
      est.fotos[p.slug] = p;
    }
    est.primeiraFeita = true;
    salvarEst();
  }

  /**
   * Lead que estava aqui e sumiu do WOODS: marca como removido no Woods Web (some do painel, o histórico fica).
   * Se sumir muita coisa de uma vez (pasta trocada, ramo diferente), não marca nada: melhor sobrar do que apagar.
   */
  function removidos(projetos) {
    const tem = new Set(projetos.map((p) => p.slug));
    const antes = Object.keys(est.fotos);
    const sumiram = antes.filter((s) => !tem.has(s));
    if (!sumiram.length) return;
    if (!fs.existsSync(path.join(woods, 'vault', '20-leads')) || sumiram.length > Math.max(3, antes.length * 0.2)) {
      registrar(`nuvem: ${sumiram.length} leads sumiram do WOODS de uma vez; não marquei como removidos`);
      return;
    }
    for (const slug of sumiram) {
      enfileirar({ chave: `projeto:${slug}`, tipo: 'remover', dados: { slug, em: iso() } });
      delete est.fotos[slug];
      delete est.linhas[slug];
      for (const k of Object.keys(est.previas)) if (k.startsWith(`${slug}/`)) delete est.previas[k];
    }
  }

  // ---------- Equipe ----------
  async function buscarEquipe(c, t, usuarioId) {
    const m = await c.selecionar('membros', { usuario_id: `eq.${usuarioId}`, select: 'equipe_id,nome', order: 'created_at.asc', limit: '1' }, { token: t });
    if (!m.length) {
      throw new ErroNuvem('Esta conta não está em nenhuma equipe do Woods Web. No Supabase, rode select public.adicionar_membro(\'seu@email\', \'Seu nome\'); (veja docs/woods-web.md).');
    }
    return { equipeId: m[0].equipe_id, nome: m[0].nome || '' };
  }

  /** Conexão feita antes da equipe existir: descobre a equipe e reenvia tudo (linhas e prints vão para a equipe) */
  async function garantirEquipe() {
    if (cfg.equipeId) return;
    const t = await token();
    Object.assign(cfg, await buscarEquipe(cliente(), t, cfg.usuarioId));
    est.linhas = {};
    est.previas = {};
    salvarCfg();
    salvarEst();
  }

  // ---------- Fila → Supabase ----------
  async function executar(op, t) {
    const c = cliente();
    const dono = cfg.usuarioId;
    const equipe = cfg.equipeId;
    const daEquipe = { equipe_id: `eq.${equipe}` };
    if (op.tipo === 'projeto') {
      await c.upsert('projetos', [{ ...op.dados, equipe_id: equipe, owner_id: dono, sincronizado_em: iso() }], { token: t, conflito: 'equipe_id,slug' });
    } else if (op.tipo === 'remover') {
      await c.alterar('projetos', { ...daEquipe, slug: `eq.${op.dados.slug}` }, { removido_em: op.dados.em, owner_id: dono }, { token: t });
    } else if (op.tipo === 'evento') {
      await c.upsert('eventos', [{ ...op.dados, equipe_id: equipe, owner_id: dono }], { token: t, ignorar: true });
    } else if (op.tipo === 'andamento') {
      const { slug, ativo, desde } = op.dados;
      await c.upsert('andamento', [{
        equipe_id: equipe, projeto_slug: slug, owner_id: dono, dispositivo_id: cfg.dispositivoId,
        quem: (cfg.nome || cfg.email).slice(0, 100), computador: maquina.slice(0, 100), ativo, desde, atualizado_em: iso(),
      }], { token: t, conflito: 'equipe_id,projeto_slug' });
    } else if (op.tipo === 'liberar') {
      // O app acabou de abrir: nada está rodando aqui. Solta o "em andamento" que ficou de um fechamento à força
      await c.alterar('andamento', { dispositivo_id: `eq.${cfg.dispositivoId}`, ativo: 'is.true' }, { ativo: false, owner_id: dono, atualizado_em: iso() }, { token: t });
    } else if (op.tipo === 'previa') {
      const { slug, nome } = op.dados;
      const arq = path.join(woods, 'sites', slug, 'prints', `${nome}.jpg`);
      const st = fs.statSync(arq, { throwIfNoEntry: false });
      if (!st) return; // o print saiu do disco: nada a enviar
      if (st.size > MAX_IMAGEM) throw new ErroNuvem(`O print ${nome} passa de 5 MB`);
      const em = op.dados.em || Math.round(st.mtimeMs);
      // O sócio já mandou um print mais novo: não troca a imagem dele pela nossa
      const atual = await c.selecionar('previas', { ...daEquipe, projeto_slug: `eq.${slug}`, nome: `eq.${nome}`, select: 'atualizado_local_em' }, { token: t });
      if (!atual[0] || Date.parse(atual[0].atualizado_local_em) <= em) {
        const caminho = `${equipe}/${slug}/${nome}.jpg`;
        await c.enviarArquivo(BUCKET, caminho, fs.readFileSync(arq), 'image/jpeg', { token: t });
        await c.upsert('previas', [{ equipe_id: equipe, owner_id: dono, projeto_slug: slug, nome, storage_path: caminho, atualizado_local_em: iso(em) }],
          { token: t, conflito: 'equipe_id,projeto_slug,nome' });
      }
      est.previas[`${slug}/${nome}`] = em;
    }
  }

  async function avisarContato(t, forcar = false) {
    if (!cfg.dispositivoId || (!forcar && agora() - ultimoContato < CONTATO)) return;
    try {
      await cliente().upsert('dispositivos', [{
        id: cfg.dispositivoId, equipe_id: cfg.equipeId, owner_id: cfg.usuarioId, nome: maquina.slice(0, 100), versao_app: versao.slice(0, 40), conectado: true,
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
        if (!['projeto', 'remover', 'liberar'].includes(op.tipo) && est.erros[op.dados.slug ?? op.dados.projeto_slug]) delete est.erros[op.dados.slug ?? op.dados.projeto_slug];
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
        await garantirEquipe();
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
    const c = criarCliente({ ...conf, fetch });
    const s = await c.entrar(email, String(senha));
    if (!s.usuario.id || !s.renovacao) throw new ErroNuvem('O Supabase não devolveu a sessão.');
    const eq = await buscarEquipe(c, s.acesso, s.usuario.id);
    if (cfg.usuarioId !== s.usuario.id || cfg.url !== conf.url || cfg.equipeId !== eq.equipeId) { // outra conta, projeto ou equipe: começa do zero
      est = vazio();
      fila = new Fila();
    }
    cfg = {
      ...conf, email: s.usuario.email || email, usuarioId: s.usuario.id, ...eq,
      dispositivoId: cfg.dispositivoId || crypto.randomUUID(), renovacao: cofre.cifrar(s.renovacao),
    };
    enfileirar({ chave: 'liberar', tipo: 'liberar', dados: {} });
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
        await c.upsert('dispositivos', [{ id: cfg.dispositivoId, equipe_id: cfg.equipeId, owner_id: cfg.usuarioId, conectado: false, ultimo_contato: iso(), pendentes: fila.tamanho }],
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
      const antes = conversando[slug];
      const ev = eventoDaConversa(slug, linha, antes);
      const e = JSON.parse(linha);
      if (e.t === 'estado') conversando[slug] = Boolean(e.rodando);
      // Em andamento: começa quando o Claude começa; acaba no fim ou quando ele para (inclusive pelo botão Parar)
      let ativo = null;
      if (e.t === 'estado' && e.rodando && !antes) ativo = true;
      else if (e.t === 'fim' || (e.t === 'estado' && !e.rodando && antes)) ativo = false;
      if (!ev && ativo === null) return;
      varrer(); // lead recém-criado: a linha do projeto entra na fila antes do evento
      if (ev) enfileirar({ chave: `evento:${ev.id}`, tipo: 'evento', dados: ev });
      if (ativo !== null) {
        const desde = new Date(Number(e.em) || agora()).toISOString();
        enfileirar({ chave: `andamento:${slug}`, tipo: 'andamento', dados: { slug, ativo, desde } });
      }
      salvarEst();
      adiar(ativo ? 500 : 3000); // "em andamento" vai logo, para o sócio ver a tempo
    } catch (e) {
      registrar(`nuvem: evento: ${e.message}`);
    }
  }

  /**
   * O que a equipe sabe deste lead, para avisar antes de começar: { projeto, andamento } ou null
   * (desconectado, sem internet ou demorou: o app segue sem aviso).
   * andamento: outro PC com o Claude nesse lead agora (só se esse PC deu sinal de vida há pouco)
   */
  async function consultar(slug) {
    if (!conectado() || !cfg.equipeId || !slug) return null;
    try {
      const t = await token();
      const c = cliente(5000);
      const daEquipe = { equipe_id: `eq.${cfg.equipeId}` };
      const [proj, and] = await Promise.all([
        c.selecionar('projetos', { ...daEquipe, slug: `eq.${slug}`, select: 'responsavel,status,removido_em' }, { token: t }),
        c.selecionar('andamento', { ...daEquipe, projeto_slug: `eq.${slug}`, ativo: 'is.true', select: 'dispositivo_id,quem,computador,desde' }, { token: t }),
      ]);
      let outro = and.find((a) => a.dispositivo_id !== cfg.dispositivoId) || null;
      if (outro) {
        const d = await c.selecionar('dispositivos', { id: `eq.${outro.dispositivo_id}`, select: 'ultimo_contato,conectado' }, { token: t });
        if (!d[0]?.conectado || agora() - Date.parse(d[0].ultimo_contato) > VIVO) outro = null;
      }
      const p = proj[0] && !proj[0].removido_em ? proj[0] : null;
      return {
        projeto: p && { responsavel: p.responsavel, status: p.status },
        andamento: outro && { quem: outro.quem, computador: outro.computador, desde: outro.desde },
      };
    } catch (e) {
      registrar(`nuvem: consultar ${slug}: ${e.message}`);
      return null;
    }
  }

  return {
    situacao, conectar, desconectar, sincronizar, aoEvento, consultar,
    /** Tenta já o que estava esperando (a internet voltou, o PC acordou, o usuário pediu) */
    agora: () => { fila.liberar(agora()); return sincronizar(); },
    iniciar() {
      if (timer) return;
      if (conectado()) { enfileirar({ chave: 'liberar', tipo: 'liberar', dados: {} }); salvarEst(); }
      timer = setInterval(() => { sincronizar(); }, intervalo);
      timer.unref?.();
      adiar(5000);
    },
    parar() { clearInterval(timer); clearTimeout(adiada); timer = null; },
  };
}
