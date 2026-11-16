import { useCallback } from 'react';
import { carregarDetalhe, type Detalhe as D } from '../lib/dados.ts';
import { usePeriodico } from '../lib/ganchos.ts';
import { descreverEvento, linkSeguro, dataCurta, dataHora, relativo, fase } from '../lib/regras.ts';
import { Aviso, Atualizado, Avatar, Carregando, ErroAtualizar, Icone, Status } from '../componentes/ui.tsx';

const PRINTS = [
  ['a', 'desktop', 'a-1440'], ['a', 'celular', 'a-390'],
  ['b', 'desktop', 'b-1440'], ['b', 'celular', 'b-390'],
] as const;

export function Detalhe({ slug }: { slug: string }) {
  const carregar = useCallback(() => carregarDetalhe(slug), [slug]);
  const { dados, erro, carregando, em, recarregar } = usePeriodico<D>(carregar, 60_000, slug);
  const voltar = <a href="#/sites" className="voltar"><Icone nome="voltar" />Sites</a>;

  if (!dados) {
    return <>{voltar}{erro ? <Aviso tipo="erro" titulo="Não deu para carregar o projeto" acao={<button className="btn" type="button" onClick={recarregar}>Tentar de novo</button>}>{erro}</Aviso> : <Carregando linhas={5} />}</>;
  }
  const p = dados.projeto;
  if (!p) return <>{voltar}<Aviso tipo="vazio" titulo="Projeto não encontrado">Não há projeto “{slug}” sincronizado nesta conta.</Aviso></>;

  const urlA = linkSeguro(p.url_a);
  const urlB = linkSeguro(p.url_b);
  const repo = linkSeguro(p.repositorio_url);
  const ig = linkSeguro(p.instagram);
  const previa = (nome: string) => dados.previas.find((x) => x.nome === nome);

  return (
    <>
      {voltar}
      <header className="topo">
        <div>
          <h1>{p.nome}</h1>
          <p className="suave topo-meta"><Status status={p.status} /><span>{p.slug}</span></p>
        </div>
        <Atualizado em={em} carregando={carregando} recarregar={recarregar} />
      </header>
      {erro && <ErroAtualizar erro={erro} tentar={recarregar} />}
      {p.erro_sincronia && <Aviso tipo="erro" titulo="Problema de sincronização">{p.erro_sincronia}</Aviso>}

      <div className="acoes">
        {urlA && <a className="btn primario" href={urlA} target="_blank" rel="noopener noreferrer"><Icone nome="externo" />Abrir site A</a>}
        {urlB && <a className={`btn ${urlA ? '' : 'primario'}`} href={urlB} target="_blank" rel="noopener noreferrer"><Icone nome="externo" />Abrir site B</a>}
        {repo && <a className="btn" href={repo} target="_blank" rel="noopener noreferrer"><Icone nome="codigo" />Repositório no GitHub</a>}
        {!urlA && !urlB && <span className="suave pequeno">{fase(p.status) === 'publicado' ? 'Publicado, mas a ficha ainda não tem os links A e B.' : 'Ainda não publicado.'}</span>}
      </div>

      <div className="grade-detalhe">
        <section className="painel">
          <header className="painel-topo"><h2>Cliente</h2></header>
          <dl className="dados">
            <div><dt>Instagram</dt><dd>{ig ? <a className="link" href={ig} target="_blank" rel="noopener noreferrer">{ig.replace(/^https:\/\/(www\.)?/, '')}</a> : '—'}</dd></div>
            <div><dt>Cidade</dt><dd>{p.cidade || '—'}</dd></div>
            <div><dt>Responsável</dt><dd>{p.responsavel ? <span className="com-avatar"><Avatar nome={p.responsavel} pequeno />{p.responsavel}</span> : "—"}</dd></div>
            <div><dt>Nicho</dt><dd>{p.nicho || '—'}</dd></div>
            <div><dt>Criado</dt><dd title={dataHora(p.criado_local_em)}>{dataCurta(p.criado_local_em)}</dd></div>
            <div><dt>Última alteração</dt><dd title={dataHora(p.atualizado_local_em)}>{relativo(p.atualizado_local_em)}</dd></div>
            <div><dt>Variante A</dt><dd>{p.variante_a_pronta ? 'gerada' : 'ainda não'}{urlA ? <> · <a className="link" href={urlA} target="_blank" rel="noopener noreferrer">no ar</a></> : ''}</dd></div>
            <div><dt>Variante B</dt><dd>{p.variante_b_pronta ? 'gerada' : 'ainda não'}{urlB ? <> · <a className="link" href={urlB} target="_blank" rel="noopener noreferrer">no ar</a></> : ''}</dd></div>
            <div className="largo"><dt>Sincronizado</dt><dd title={dataHora(p.sincronizado_em)}>{relativo(p.sincronizado_em)}</dd></div>
          </dl>
        </section>

        <section className="painel">
          <header className="painel-topo"><h2>Histórico</h2></header>
          {dados.eventos.length ? (
            <ol className="linha-tempo">
              {dados.eventos.map((e) => (
                <li key={e.id} className={`ev-${e.tipo}`}>
                  <span>{descreverEvento(e)}</span>
                  <time title={dataHora(e.ocorrido_em)}>{dataHora(e.ocorrido_em)}</time>
                </li>
              ))}
            </ol>
          ) : <p className="suave">Nenhum evento registrado ainda.</p>}
        </section>
      </div>

      <section className="painel">
        <header className="painel-topo"><h2>Pré-visualizações</h2><span className="suave pequeno">Prints de revisão gerados pelo Painel Woods</span></header>
        <div className="previas">
          {(['a', 'b'] as const).map((v) => (
            <div key={v} className="previa-grupo">
              <h3>Variante {v.toUpperCase()}</h3>
              <div className="previa-par">
                {PRINTS.filter(([pv]) => pv === v).map(([, aparelho, nome]) => {
                  const x = previa(nome);
                  return (
                    <figure key={nome} className={`previa previa-${aparelho}`}>
                      {x?.url
                        ? <a href={x.url} target="_blank" rel="noopener noreferrer"><img src={x.url} alt={`Variante ${v.toUpperCase()} no ${aparelho}`} loading="lazy" /></a>
                        : <div className="sem-previa">{x ? 'Não deu para carregar a imagem' : 'Prévia indisponível'}</div>}
                      <figcaption>{aparelho === 'celular' ? 'Celular · 390 px' : 'Desktop · 1440 px'}{x ? ` · ${relativo(x.atualizado_local_em)}` : ''}</figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
