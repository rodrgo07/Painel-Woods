import { useEffect, useMemo, useState } from 'react';
import type { Geral } from '../lib/dados.ts';
import { filtrar, opcoes, relativo, dataHora, emAndamento, fase as faseDe, FILTROS_VAZIOS, ROTULO_FASE, type Fase, type Filtros } from '../lib/regras.ts';
import { ir } from '../lib/ganchos.ts';
import { Aviso, Atualizado, Avatar, Carregando, ErroAtualizar, Icone, Status, Trabalhando } from '../componentes/ui.tsx';

interface Props {
  geral: { dados: Geral | null; erro: string; carregando: boolean; em: number; recarregar: () => void };
  busca: string | null; // ?q= vindo da busca da barra lateral
  fase: string | null;  // ?fase= vindo dos cards da visão geral
}

const ABAS: (Fase | '')[] = ['', 'desenvolvimento', 'pronto', 'publicado', 'perdido'];

const lembrados = (): Filtros => {
  try { return { ...FILTROS_VAZIOS, ...JSON.parse(sessionStorage.getItem('filtros') || '{}') }; } catch { return FILTROS_VAZIOS; }
};
const guardar = (f: Filtros) => { try { sessionStorage.setItem('filtros', JSON.stringify(f)); } catch { /* sem armazenamento: só não lembra */ } };

export function Sites({ geral, busca, fase }: Props) {
  const { dados, erro, carregando, em, recarregar } = geral;
  const [f, setF] = useState<Filtros>(lembrados);
  const aplicar = (novo: Filtros) => { setF(novo); guardar(novo); };
  const mudar = (k: keyof Filtros, v: string) => aplicar({ ...f, [k]: v } as Filtros);

  // Busca ou fase vindas por link substituem os filtros lembrados, uma vez, e saem do endereço
  useEffect(() => {
    if (busca === null && fase === null) return;
    aplicar({ ...FILTROS_VAZIOS, busca: busca ?? '', fase: (ABAS as string[]).includes(fase ?? '') ? (fase as Fase) : '' });
    ir('sites');
  }, [busca, fase]);

  const projetos = useMemo(() => dados?.projetos ?? [], [dados]);
  const lista = useMemo(() => filtrar(projetos, f), [projetos, f]);
  const ops = useMemo(() => ({ status: opcoes(projetos, 'status'), cidade: opcoes(projetos, 'cidade'), responsavel: opcoes(projetos, 'responsavel') }), [projetos]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = { '': projetos.length };
    for (const p of projetos) c[faseDe(p.status)] = (c[faseDe(p.status)] ?? 0) + 1;
    return c;
  }, [projetos]);
  const filtrando = f.busca || f.fase || f.status || f.cidade || f.responsavel;
  const trabalhando = useMemo(() => (dados ? emAndamento(dados.andamento, dados.dispositivos) : new Map()), [dados]);
  const eu = dados?.eu ?? '';
  const meus = Boolean(eu) && f.responsavel === eu;

  return (
    <>
      <header className="topo">
        <div><h1>Sites</h1><p className="suave">{dados ? `${lista.length} de ${projetos.length} projetos` : 'Carregando projetos…'}</p></div>
        <Atualizado em={em} carregando={carregando} recarregar={recarregar} />
      </header>

      <nav className="abas" aria-label="Fases">
        {ABAS.map((a) => (
          <button key={a || 'todos'} type="button" className={f.fase === a ? 'ativa' : ''} aria-pressed={f.fase === a} onClick={() => mudar('fase', a)}>
            {a ? ROTULO_FASE[a] : 'Todos'}<span>{contagem[a] ?? 0}</span>
          </button>
        ))}
      </nav>

      {erro && dados && <ErroAtualizar erro={erro} tentar={recarregar} />}

      <section className="filtros" aria-label="Filtros">
        <label className="busca"><span className="sr">Buscar cliente</span>
          <Icone nome="busca" />
          <input type="search" placeholder="Buscar pelo nome do cliente" value={f.busca} onChange={(e) => mudar('busca', e.target.value)} />
        </label>
        <Seletor rotulo="Status" valor={f.status} lista={ops.status} mudar={(v) => mudar('status', v)} />
        <Seletor rotulo="Cidade" valor={f.cidade} lista={ops.cidade} mudar={(v) => mudar('cidade', v)} />
        {eu && (
          <button type="button" className={`btn ${meus ? 'primario' : ''}`} aria-pressed={meus} onClick={() => mudar('responsavel', meus ? '' : eu)}>
            Meus leads
          </button>
        )}
        <Seletor rotulo="Responsável" valor={f.responsavel} lista={ops.responsavel} mudar={(v) => mudar('responsavel', v)} />
        <label><span className="sr">Ordenar</span>
          <select value={f.ordem} onChange={(e) => mudar('ordem', e.target.value)}>
            <option value="recentes">Atualizados recentemente</option>
            <option value="antigos">Atualizados há mais tempo</option>
            <option value="criados">Criados recentemente</option>
          </select>
        </label>
        {filtrando && <button type="button" className="btn fantasma" onClick={() => aplicar(FILTROS_VAZIOS)}>Limpar filtros</button>}
      </section>

      {!dados ? (erro ? <Aviso tipo="erro" titulo="Não deu para carregar" acao={<button className="btn" type="button" onClick={recarregar}>Tentar de novo</button>}>{erro}</Aviso> : <Carregando linhas={6} />)
        : !projetos.length ? <Aviso tipo="vazio" titulo="Nenhum projeto sincronizado">Conecte o Painel Woods ao Woods Web nas configurações do app.</Aviso>
        : !lista.length ? <Aviso tipo="vazio" titulo="Nada encontrado">Nenhum projeto com esses filtros.</Aviso>
        : (
          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr><th>Cliente</th><th>Status</th><th>Cidade</th><th>Responsável</th><th>Variantes</th><th>Atualizado</th></tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.slug} onClick={() => ir(`sites/${encodeURIComponent(p.slug)}`)}>
                    <td data-rotulo="Cliente">
                      <a href={`#/sites/${encodeURIComponent(p.slug)}`} className="cliente" onClick={(e) => e.stopPropagation()}>{p.nome}</a>
                      {p.erro_sincronia && <span className="chip erro" title={p.erro_sincronia}>erro de sincronização</span>}
                      {trabalhando.has(p.slug) && <Trabalhando a={trabalhando.get(p.slug)!} />}
                    </td>
                    <td data-rotulo="Status"><Status status={p.status} /></td>
                    <td data-rotulo="Cidade">{p.cidade || <span className="suave">—</span>}</td>
                    <td data-rotulo="Responsável">{p.responsavel ? <span className="com-avatar"><Avatar nome={p.responsavel} pequeno />{p.responsavel}</span> : <span className="suave">—</span>}</td>
                    <td data-rotulo="Variantes">
                      <span className={`var ${p.variante_a_pronta ? 'ok' : ''}`} title={p.variante_a_pronta ? 'Variante A gerada' : 'Variante A ainda não gerada'}>A</span>
                      <span className={`var ${p.variante_b_pronta ? 'ok' : ''}`} title={p.variante_b_pronta ? 'Variante B gerada' : 'Variante B ainda não gerada'}>B</span>
                    </td>
                    <td data-rotulo="Atualizado"><time title={dataHora(p.atualizado_local_em)}>{relativo(p.atualizado_local_em)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

function Seletor({ rotulo, valor, lista, mudar }: { rotulo: string; valor: string; lista: string[]; mudar: (v: string) => void }) {
  return (
    <label><span className="sr">{rotulo}</span>
      <select value={valor} onChange={(e) => mudar(e.target.value)} disabled={!lista.length && !valor}>
        <option value="">{rotulo}: todos</option>
        {valor && !lista.includes(valor) && <option value={valor}>{valor}</option>}
        {lista.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  );
}
