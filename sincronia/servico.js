/*
 * Serviço de sincronização com o Supabase: o Woods Web (metadados dos leads) e o que precisa andar junto entre os
 * computadores (conversas e sessões do Claude, preferências, quem está trabalhando em cada lead).
 * Não escreve no WOODS: a pasta do WOODS anda entre os computadores pelo espelho do git (espelho.js).
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
import zlib from 'node:zlib';
import { lerProjetos, paraLinha, eventos, eventoDaConversa } from './mapa.js';
import {
  sha, SESSAO_OK, pastaClaude, pastaSessoes, acharSessao, paraNuvem, daNuvem, juntarLinhas,
  lerSessoes, gravarSessao, slugsLocais, normalizar, juntarPreferencias,
} from './conversas.js';

const BUCKET = 'previas';
const MAX_IMAGEM = 5 * 1024 * 1024;  // igual ao limite do bucket
const CONTATO = 5 * 60_000;           // avisa que o desktop está vivo no máximo a cada 5 min
const BUCKET_CONVERSAS = 'conversas';
const TRAVA_VALIDADE = 10 * 60_000;   // trava sem renovação há 10 min (PC desligou no meio): vale mais nada
const TRAVA_RENOVA = 2 * 60_000;

// Função, não objeto: cada estado novo tem os próprios objetos (nada compartilhado entre conexões)
const vazio = () => ({
  fila: [], fotos: {}, linhas: {}, previas: {}, erros: {}, primeiraFeita: false, ultimaSincronia: null, ultimoErro: '',
  conversas: {}, preferencias: {}, ultimaConversas: null,
});

/**
 * dados: pasta do usuário; woods: pasta do WOODS; fetch: net.fetch do Electron;
 * cofre: { disponivel(), cifrar(texto) → base64, decifrar(base64) → texto } (safeStorage)
 * claude: pasta do Claude Code (sessões); ocupado(): lead em que o Claude trabalha agora (não é tocado);
 * pausado(): o espelho do git está mexendo no WOODS; emDia(): o WOODS daqui está igual ao dos outros computadores
 * (enquanto não estiver, os projetos não vão para o Woods Web, para um notebook atrasado não mandar dado velho);
 * preferencias: { ler() → objeto, aplicar(objeto) }; aoBaixarConversa(slug): avisa a janela
 */
export function criarServico({
  dados, woods, fetch, cofre, versao = '', maquina = '', registrar = () => {}, intervalo = 60_000, agora = () => Date.now(),
  claude = pastaClaude(), ocupado = () => null, pausado = () => false, emDia = () => true, preferencias = null, aoBaixarConversa = () => {},
}) {
  const ARQ_CFG = path.join(dados, 'nuvem.json');
  const ARQ_EST = path.join(dados, 'nuvem-estado.json');
  let cfg = lerJson(ARQ_CFG, { url: '', anonKey: '', email: '', usuarioId: '', dispositivoId: '', renovacao: '' });
  let est = lerJson(ARQ_EST, vazio());
  let travada = '';             // lead que este computador travou para o Claude
  let ultimaRenovacao = 0;
  let erroExtras = '';
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
      pendentes: fila.tamanho, ultimaSincronia: est.ultimaSincronia, ultimoErro: est.ultimoErro || erroExtras,
      sincronizando: Boolean(rodando), ultimaConversas: est.ultimaConversas,
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

  function varrer({ semEventos = false, apesarDaPausa = false } = {}) {
    if (!conectado() || (pausado() && !apesarDaPausa) || !emDia()) return;
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
      // semEventos: a mudança veio de outro computador pelo espelho; o evento já foi registrado por lá
      if (!semEventos || !antes) for (const ev of eventos(antes, p, { primeira, agora: iso() })) enfileirar({ chave: `evento:${ev.id}`, tipo: 'evento', dados: ev });
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
        await extras();
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

  // ---------- Conversas, preferências e travas (entre os computadores) ----------
  const gz = (buf) => zlib.gzipSync(buf);
  const ungz = (buf) => zlib.gunzipSync(buf);
  const arqPainel = (slug) => path.join(dados, 'conversas', `${slug}.jsonl`);
  const caminhoNuvem = (slug, tipo, hash) => `${cfg.usuarioId}/${slug}/${tipo}-${hash.slice(0, 32)}.jsonl.gz`;

  // Hash dos arquivos só é refeito quando eles mudam (a rodada é a cada minuto e as sessões podem ter vários MB)
  const memo = new Map();
  function hashDe(arq, transformar = (b) => b) {
    const st = fs.statSync(arq, { throwIfNoEntry: false });
    if (!st) return '';
    const chave = `${st.mtimeMs}:${st.size}`;
    if (memo.get(arq)?.chave !== chave) memo.set(arq, { chave, sha: sha(transformar(fs.readFileSync(arq))) });
    return memo.get(arq).sha;
  }
  const portatil = (buf) => Buffer.from(paraNuvem(buf.toString('utf8'), woods));

  /** A conversa de um lead como está neste computador. Sessão sem arquivo não conta (o Claude Code apagou) */
  function conversaLocal(slug) {
    const ap = arqPainel(slug);
    const sid = lerSessoes(dados)[slug] || '';
    const as = sid ? acharSessao(claude, woods, sid) : null;
    return {
      painelSha: fs.existsSync(ap) ? hashDe(ap) : '',
      sid: as ? sid : '',
      sessaoSha: as ? hashDe(as, portatil) : '',
      painel: () => fs.readFileSync(ap),
      sessao: () => portatil(fs.readFileSync(as)),
    };
  }

  /** Grava o que veio da nuvem. juntar: este computador também mudou; o histórico do painel se soma */
  async function baixarConversa(slug, r, L, t, juntar) {
    const c = cliente();
    if (r.painel_sha && r.painel_sha !== L.painelSha) {
      const veio = ungz(await c.baixarArquivo(BUCKET_CONVERSAS, caminhoNuvem(slug, 'painel', r.painel_sha), { token: t }));
      fs.mkdirSync(path.dirname(arqPainel(slug)), { recursive: true });
      fs.writeFileSync(arqPainel(slug), juntar && L.painelSha ? juntarLinhas(L.painel().toString(), veio.toString()) : veio);
    }
    if (r.sessao_id && SESSAO_OK.test(r.sessao_id) && r.sessao_sha && (r.sessao_id !== L.sid || r.sessao_sha !== L.sessaoSha)) {
      const veio = ungz(await c.baixarArquivo(BUCKET_CONVERSAS, caminhoNuvem(slug, 'sessao', r.sessao_sha), { token: t })).toString();
      const pasta = pastaSessoes(claude, woods);
      const destino = path.join(pasta, `${r.sessao_id}.jsonl`);
      fs.mkdirSync(pasta, { recursive: true });
      // A mesma sessão continuada em dois computadores sem internet: a daqui fica guardada ao lado
      if (juntar && fs.existsSync(destino)) fs.copyFileSync(destino, path.join(pasta, `${r.sessao_id}.conflito-${agora()}.jsonl.bak`));
      fs.writeFileSync(destino, daNuvem(veio, woods));
      gravarSessao(dados, slug, r.sessao_id);
    }
    aoBaixarConversa(slug);
  }

  /** Manda a conversa daqui. Só vale se ninguém mandou outra desde a versão de `r` (sem `r`: ainda não existe) */
  async function subirConversa(slug, L, r, t) {
    const c = cliente();
    if (L.painelSha && L.painelSha !== r?.painel_sha) {
      await c.enviarArquivo(BUCKET_CONVERSAS, caminhoNuvem(slug, 'painel', L.painelSha), gz(L.painel()), 'application/gzip', { token: t });
    }
    if (L.sessaoSha && L.sessaoSha !== r?.sessao_sha) {
      await c.enviarArquivo(BUCKET_CONVERSAS, caminhoNuvem(slug, 'sessao', L.sessaoSha), gz(L.sessao()), 'application/gzip', { token: t });
    }
    const linha = {
      sessao_id: L.sid || null, painel_sha: L.painelSha || null, sessao_sha: L.sessaoSha || null,
      dispositivo_id: cfg.dispositivoId || null, atualizado_em: iso(),
    };
    let versao;
    if (!r) {
      try {
        await c.inserir('conversas', [{ owner_id: cfg.usuarioId, projeto_slug: slug, versao: 1, ...linha }], { token: t });
      } catch (e) {
        if (e.status === 409) return null; // outro computador criou agora: junta na próxima rodada
        throw e;
      }
      versao = 1;
    } else {
      const feitas = await c.atualizar('conversas', `projeto_slug=eq.${slug}&versao=eq.${r.versao}`, { ...linha, versao: r.versao + 1 }, { token: t });
      if (!feitas?.length) return null; // perdeu a corrida: junta na próxima rodada
      versao = r.versao + 1;
      // Arquivos da versão anterior que ninguém mais usa
      const velhos = [];
      if (r.painel_sha && r.painel_sha !== linha.painel_sha) velhos.push(caminhoNuvem(slug, 'painel', r.painel_sha));
      if (r.sessao_sha && r.sessao_sha !== linha.sessao_sha) velhos.push(caminhoNuvem(slug, 'sessao', r.sessao_sha));
      if (velhos.length) await c.apagarArquivos(BUCKET_CONVERSAS, velhos, { token: t }).catch((e) => registrar(`nuvem: apagar conversa antiga: ${e.message}`));
    }
    return { versao, painel: L.painelSha, sessao: L.sessaoSha, sid: L.sid };
  }

  const marca = (versao, L) => ({ versao, painel: L.painelSha, sessao: L.sessaoSha, sid: L.sid });

  async function umaConversa(slug, r, t) {
    const k = est.conversas[slug] || {};
    let L = conversaLocal(slug);
    const localMudou = L.painelSha !== (k.painel || '') || L.sessaoSha !== (k.sessao || '') || L.sid !== (k.sid || '');
    // Falta aqui o arquivo da sessão que a nuvem tem (computador novo, ou o Claude Code limpou): baixa de novo
    const faltaSessao = Boolean(r?.sessao_sha) && !L.sessaoSha;
    const remotoMudou = Boolean(r) && (r.versao !== k.versao || faltaSessao);
    if (!localMudou && !remotoMudou) return;
    if (!r && !L.painelSha && !L.sessaoSha) return;
    if (remotoMudou) {
      const juntar = localMudou && Boolean(L.painelSha || L.sessaoSha);
      await baixarConversa(slug, r, L, t, juntar);
      L = conversaLocal(slug);
      const igual = L.painelSha === (r.painel_sha || '') && L.sessaoSha === (r.sessao_sha || '') && L.sid === (r.sessao_id || '');
      if (igual) { est.conversas[slug] = marca(r.versao, L); return; }
    }
    const feito = await subirConversa(slug, L, r, t);
    if (feito) est.conversas[slug] = feito;
  }

  /** Conversas de todos os leads (ou de um só). O lead em que o Claude está trabalhando fica para depois */
  async function sincronizarConversas(t, so = null) {
    const consulta = `select=projeto_slug,versao,sessao_id,painel_sha,sessao_sha${so ? `&projeto_slug=eq.${so}` : ''}`;
    const remotas = new Map((await cliente().ler('conversas', consulta, { token: t }) || []).map((r) => [r.projeto_slug, r]));
    const slugs = so ? [so] : [...new Set([...remotas.keys(), ...slugsLocais(dados)])];
    for (const slug of slugs) {
      if (slug === ocupado()) continue;
      try {
        await umaConversa(slug, remotas.get(slug), t);
      } catch (e) {
        if (e.sessao || e.temporario) throw e;
        registrar(`nuvem: conversa ${slug}: ${e.message}`);
        erroExtras = `Conversa de ${slug}: ${e.message}`;
      } finally {
        salvarEst();
      }
    }
    est.ultimaConversas = iso();
  }

  async function sincronizarPreferencias(t) {
    if (!preferencias) return;
    const c = cliente();
    const [r] = await c.ler('preferencias', 'select=versao,dados', { token: t }) || [];
    const local = normalizar(preferencias.ler());
    const k = est.preferencias || {};
    const shaLocal = sha(JSON.stringify(local));
    // Computador que acabou de conectar: as preferências da conta valem (o modelo padrão daqui não atropela o escolhido)
    const localMudou = k.sha === undefined ? !r : shaLocal !== k.sha;
    const remotoMudou = Boolean(r) && r.versao !== k.versao;
    if (!localMudou && !remotoMudou) return;
    // Os campos do lado que mudou por último valem; as permissões "Sempre" dos dois lados se somam
    const final = remotoMudou ? (localMudou ? juntarPreferencias(r.dados, local) : juntarPreferencias(local, r.dados)) : local;
    const shaFinal = sha(JSON.stringify(final));
    if (shaFinal !== shaLocal) preferencias.aplicar(final);
    let versao = r?.versao;
    if (!r || shaFinal !== sha(JSON.stringify(normalizar(r.dados)))) {
      const linha = { dados: final, dispositivo_id: cfg.dispositivoId || null, atualizado_em: iso() };
      if (!r) {
        try { await c.inserir('preferencias', [{ owner_id: cfg.usuarioId, versao: 1, ...linha }], { token: t }); } catch (e) { if (e.status === 409) return; throw e; }
        versao = 1;
      } else {
        const feitas = await c.atualizar('preferencias', `versao=eq.${r.versao}`, { ...linha, versao: r.versao + 1 }, { token: t });
        if (!feitas?.length) return;
        versao = r.versao + 1;
      }
    }
    est.preferencias = { versao, sha: shaFinal };
  }

  async function renovarTrava(t) {
    if (!travada || agora() - ultimaRenovacao < TRAVA_RENOVA) return;
    await cliente().upsert('travas', [{
      owner_id: cfg.usuarioId, projeto_slug: travada, dispositivo_id: cfg.dispositivoId, maquina: maquina.slice(0, 100), renovada_em: iso(),
    }], { token: t, conflito: 'owner_id,projeto_slug' });
    ultimaRenovacao = agora();
  }

  async function extras() {
    const t = await token();
    erroExtras = '';
    await renovarTrava(t).catch((e) => registrar(`nuvem: trava: ${e.message}`));
    await sincronizarPreferencias(t);
    await sincronizarConversas(t);
    salvarEst();
  }

  /**
   * Antes de o Claude começar num lead: traz a conversa mais nova desse lead e trava o lead para este computador.
   * Lança se outro computador está com o Claude nele. Sem internet, segue (o espelho junta depois).
   */
  async function antesDoClaude(slug) {
    if (!conectado()) return;
    let t;
    try { t = await token(); } catch (e) { registrar(`nuvem: antes do Claude em ${slug}: ${e.message}`); return; }
    const c = cliente();
    try {
      const [tr] = await c.ler('travas', `select=dispositivo_id,maquina,renovada_em,desde&projeto_slug=eq.${slug}`, { token: t }) || [];
      if (tr && tr.dispositivo_id !== cfg.dispositivoId && agora() - Date.parse(tr.renovada_em) < TRAVA_VALIDADE) {
        const desde = new Date(tr.desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        throw new ErroNuvem(`O Claude está trabalhando em ${slug} no computador ${tr.maquina || 'outro'} desde ${desde}. Espere terminar lá ou pare por lá.`, { codigo: 'travado' });
      }
      await sincronizarConversas(t, slug);
      await c.upsert('travas', [{
        owner_id: cfg.usuarioId, projeto_slug: slug, dispositivo_id: cfg.dispositivoId, maquina: maquina.slice(0, 100), desde: iso(), renovada_em: iso(),
      }], { token: t, conflito: 'owner_id,projeto_slug' });
      travada = slug;
      ultimaRenovacao = agora();
    } catch (e) {
      if (e.codigo === 'travado') throw e;
      // Sem internet, Supabase fora ou sem a migration nova: o trabalho não para (o espelho junta depois)
      registrar(`nuvem: antes do Claude em ${slug}: ${e.message}`);
      if (!e.temporario) erroExtras = e.message;
    } finally {
      salvarEst();
    }
  }

  /** O Claude terminou: solta a trava e manda a conversa já */
  async function depoisDoClaude(slug) {
    if (travada === slug) travada = '';
    if (!conectado()) return;
    try {
      const t = await token();
      await cliente().apagar('travas', `projeto_slug=eq.${slug}&dispositivo_id=eq.${cfg.dispositivoId}`, { token: t });
    } catch (e) {
      registrar(`nuvem: soltar trava de ${slug}: ${e.message}`); // vence sozinha em 10 min
    }
    adiar(1000);
  }

  /** O espelho trouxe mudanças de outro computador: atualiza a foto sem criar eventos repetidos */
  function rebasear() {
    try { varrer({ semEventos: true, apesarDaPausa: true }); } catch (e) { registrar(`nuvem: rebasear: ${e.message}`); }
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
    situacao, conectar, desconectar, sincronizar, aoEvento, antesDoClaude, depoisDoClaude, rebasear,
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
