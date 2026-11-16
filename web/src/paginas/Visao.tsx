import type { Geral } from '../lib/dados.ts';
import { resumir, relativo } from '../lib/regras.ts';
import { Aviso, Atualizado, Carregando, ErroAtualizar, Integracao, Status } from '../componentes/ui.tsx';

interface Props { geral: { dados: Geral | null; erro: string; carregando: boolean; em: number; recarregar: () => void } }

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
  const cards = [
    ['Total de projetos', r.total, ''],
    ['Em desenvolvimento', r.desenvolvimento, 'fase-desenvolvimento'],
    ['Prontos', r.pronto, 'fase-pronto'],
    ['Publicados', r.publicado, 'fase-publicado'],
    ['Problemas de sincronização', r.comProblema, r.comProblema ? 'alerta' : ''],
  ] as const;
  const recentes = dados.projetos.slice(0, 6);
  const problemas = dados.projetos.filter((p) => p.erro_sincronia);

  return (
    <>
      {cabecalho}
      {erro && <ErroAtualizar erro={erro} tentar={recarregar} />}
      <section className="cards" aria-label="Resumo">
        {cards.map(([rotulo, n, classe]) => (
          <article key={rotulo} className={`card ${classe}`}><span className="card-rotulo">{rotulo}</span><strong>{n}</strong></article>
        ))}
      </section>

      <div className="grade-2">
        <section className="painel">
          <header className="painel-topo"><h2>Atualizados recentemente</h2><a href="#/sites" className="link">Ver todos</a></header>
          {recentes.length ? (
            <ul className="lista">
              {recentes.map((p) => (
                <li key={p.slug}>
                  <a href={`#/sites/${encodeURIComponent(p.slug)}`}>
                    <span className="lista-nome">{p.nome}<small>{[p.cidade, p.responsavel].filter(Boolean).join(' · ') || p.slug}</small></span>
                    <Status status={p.status} />
                    <time className="suave">{relativo(p.atualizado_local_em)}</time>
                  </a>
                </li>
              ))}
            </ul>
          ) : <Aviso tipo="vazio" titulo="Nenhum projeto ainda">Conecte o Painel Woods ao Woods Web nas configurações do app. Os leads aparecem aqui na primeira sincronização.</Aviso>}
        </section>

        <div className="pilha">
          <Integracao dispositivos={dados.dispositivos} />
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
