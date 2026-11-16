import type { Geral } from '../lib/dados.ts';
import { resumir, relativo, porResponsavel, fase, ROTULO_FASE, type Fase } from '../lib/regras.ts';
import type { Projeto } from '../lib/tipos.ts';
import { Aviso, Atualizado, Avatar, Carregando, ErroAtualizar, Icone, Integracao, Status } from '../componentes/ui.tsx';

interface Props { geral: { dados: Geral | null; erro: string; carregando: boolean; em: number; recarregar: () => void } }

const FASES: Fase[] = ['desenvolvimento', 'pronto', 'publicado', 'perdido'];
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

export function Visao({ geral }: Props) {
  const { dados, erro, carregando, em, recarregar } = geral;
  const cabecalho = (
    <header className="topo">
      <div><h1>Visão geral</h1><p className="suave">Todos os sites do WOODS, sincronizados pelo Painel Woods.</p></div>
      <Atualizado em={em} carregando={carregando} recarregar={recarregar} />
    </header>
  );
  if (!dados) {
    return <>{cabecalho}{erro ? <Aviso tipo="erro" titulo="Não deu para carregar" acao={<button className="btn" type="button" onClick={recarregar}>Tentar de novo</button>}>{erro}</Aviso> : <Carregando linhas={4} />}</>;
  }
  const r = resumir(dados.projetos);
  const recentes = dados.projetos.slice(0, 5);
  const problemas = dados.projetos.filter((p) => p.erro_sincronia);
  const responsaveis = porResponsavel(dados.projetos);
  const maiorFase = Math.max(1, ...FASES.map((f) => r[f]));

  return (
    <>
      {cabecalho}
      {erro && <ErroAtualizar erro={erro} tentar={recarregar} />}

      <section className="metricas" aria-label="Resumo">
        <a className="metrica" href="#/sites">
          <span className="metrica-rotulo">Total de projetos</span>
          <div className="metrica-corpo">
            <strong>{r.total}</strong>
            {/* Barras por fase: desenvolvimento, pronto, publicado, perdido */}
            <span className="mini-barras" aria-label={FASES.map((f) => `${r[f]} ${f}`).join(', ')}>
              {FASES.map((f) => <i key={f} className={`fase-${f}`} style={{ height: `${18 + (r[f] / maiorFase) * 82}%` }} />)}
            </span>
          </div>
        </a>
        {(['desenvolvimento', 'pronto', 'publicado'] as const).map((f) => (
          <a key={f} className="metrica" href={`#/sites?fase=${f}`}>
            <span className="metrica-rotulo">{f === 'desenvolvimento' ? 'Em desenvolvimento' : f === 'pronto' ? 'Prontos' : 'Publicados'}
              <span className={`selo fase-${f}`}>{pct(r[f], r.total)}%</span>
            </span>
            <div className="metrica-corpo">
              <strong>{r[f]}</strong>
              <span className="mini-trilho"><i className={`fase-${f}`} style={{ width: `${pct(r[f], r.total)}%` }} /></span>
            </div>
          </a>
        ))}
        <div className={`metrica ${r.comProblema ? 'alerta' : ''}`}>
          <span className="metrica-rotulo">Problemas de sincronização{r.comProblema ? <span className="selo alerta">atenção</span> : <span className="selo fase-publicado">ok</span>}</span>
          <div className="metrica-corpo"><strong>{r.comProblema}</strong></div>
        </div>
      </section>

      <div className="grade-2">
        <section className="secao">
          <header className="secao-topo"><h2>Atualizados recentemente</h2><a href="#/sites" className="btn pequeno">Ver todos</a></header>
          {recentes.length ? (
            <div className="cards-projeto">{recentes.map((p) => <CardProjeto key={p.slug} p={p} />)}</div>
          ) : <Aviso tipo="vazio" titulo="Nenhum projeto ainda">Conecte o Painel Woods ao Woods Web nas configurações do app. Os leads aparecem aqui na primeira sincronização.</Aviso>}
        </section>

        <div className="pilha">
          <Integracao dispositivos={dados.dispositivos} />
          {responsaveis.length > 0 && (
            <section className="painel">
              <header className="painel-topo"><h2>Responsáveis</h2></header>
              <ul className="responsaveis">
                {responsaveis.map((x) => (
                  <li key={x.nome}>
                    <Avatar nome={x.nome} />
                    <div>
                      <span className="resp-nome">{x.nome}<small>{x.total} {x.total === 1 ? 'projeto' : 'projetos'}</small></span>
                      <span className="segmentos" aria-label={FASES.map((f) => `${x[f]} ${f}`).join(', ')}>
                        {FASES.filter((f) => x[f]).map((f) => <i key={f} className={`fase-${f}`} style={{ flexGrow: x[f] }} />)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="legenda">{FASES.map((f) => <span key={f}><i className={`fase-${f}`} />{ROTULO_FASE[f]}</span>)}</p>
            </section>
          )}
          {problemas.length > 0 && (
            <section className="painel">
              <header className="painel-topo"><h2>Problemas de sincronização</h2></header>
              <ul className="lista">
                {problemas.map((p) => (
                  <li key={p.slug}><a href={`#/sites/${encodeURIComponent(p.slug)}`}><span className="lista-nome">{p.nome}<small className="atencao">{p.erro_sincronia}</small></span></a></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function CardProjeto({ p }: { p: Projeto }) {
  return (
    <a className={`card-projeto fase-borda-${fase(p.status)}`} href={`#/sites/${encodeURIComponent(p.slug)}`}>
      <div className="card-linha">
        <span className="chip"><Icone nome="relogio" />{relativo(p.atualizado_local_em)}</span>
        <span className="variantes" aria-label="Variantes geradas">
          <span className={`var ${p.variante_a_pronta ? 'ok' : ''}`} title={p.variante_a_pronta ? 'Variante A gerada' : 'Variante A ainda não gerada'}>A</span>
          <span className={`var ${p.variante_b_pronta ? 'ok' : ''}`} title={p.variante_b_pronta ? 'Variante B gerada' : 'Variante B ainda não gerada'}>B</span>
        </span>
      </div>
      <strong className="card-titulo">{p.nome}</strong>
      <div className="card-linha">
        <span className="chips">
          <Status status={p.status} />
          {p.cidade && <span className="chip"><Icone nome="local" />{p.cidade}</span>}
          {p.erro_sincronia && <span className="chip erro">erro de sincronização</span>}
        </span>
        {p.responsavel && <Avatar nome={p.responsavel} pequeno />}
      </div>
    </a>
  );
}
