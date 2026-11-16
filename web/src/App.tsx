import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, erroConfig } from './lib/supabase.ts';
import { carregarGeral, esquecerAssinaturas } from './lib/dados.ts';
import { usePeriodico, useRota, ir } from './lib/ganchos.ts';
import { Login } from './paginas/Login.tsx';
import { Visao } from './paginas/Visao.tsx';
import { Sites } from './paginas/Sites.tsx';
import { Detalhe } from './paginas/Detalhe.tsx';
import { Integracao, Aviso, Marca, Icone, Avatar } from './componentes/ui.tsx';

export function App() {
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data } = supabase.auth.onAuthStateChange((_ev, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (erroConfig) return <main className="centro"><Aviso tipo="erro" titulo="Woods Web sem configuração">{erroConfig}</Aviso></main>;
  if (sessao === undefined) return <main className="centro"><div className="girando" aria-label="Carregando" /></main>;
  if (!sessao) return <Login />;
  return <Painel email={sessao.user.email ?? ''} />;
}

const INTERVALO = 60_000; // 1 leitura por minuto com a aba aberta: o desktop sincroniza nesse mesmo ritmo

function Painel({ email }: { email: string }) {
  const rota = useRota();
  const geral = usePeriodico(carregarGeral, INTERVALO);
  const [caminho, consulta = ''] = rota.split('?');
  const [pagina, ...resto] = caminho.split('/');
  const slug = pagina === 'sites' && resto[0] ? decodeURIComponent(resto[0]) : '';
  const params = new URLSearchParams(consulta);
  const [termo, setTermo] = useState('');
  useEffect(() => { window.scrollTo(0, 0); }, [caminho]);

  const sair = async () => {
    esquecerAssinaturas();
    await supabase!.auth.signOut();
    window.location.hash = '';
  };
  const buscar = (e: FormEvent) => {
    e.preventDefault();
    ir(`sites?q=${encodeURIComponent(termo.trim())}`);
    setTermo('');
  };

  const ativo = pagina === 'sites' ? 'sites' : '';
  const total = geral.dados?.projetos.length;

  return (
    <div className="casca">
      <aside className="lateral">
        <Marca />
        <form className="busca-lateral" role="search" onSubmit={buscar}>
          <Icone nome="busca" />
          <input type="search" placeholder="Buscar cliente…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar cliente" />
          <kbd aria-hidden="true">↵</kbd>
        </form>
        <nav className="nav" aria-label="Seções">
          <a href="#/" className={ativo === '' ? 'ativo' : ''} aria-current={ativo === '' ? 'page' : undefined}><Icone nome="visao" />Visão geral</a>
          <a href="#/sites" className={ativo === 'sites' ? 'ativo' : ''} aria-current={ativo === 'sites' ? 'page' : undefined}>
            <Icone nome="sites" />Sites{total !== undefined && <span className="contador">{total}</span>}
          </a>
        </nav>
        <div className="lateral-pe">
          {geral.dados && <Integracao dispositivos={geral.dados.dispositivos} compacto />}
          <div className="conta">
            <Avatar nome={email} pequeno />
            <span className="conta-email" title={email}>{email}</span>
            <button type="button" className="btn-icone" onClick={sair} title="Sair" aria-label="Sair"><Icone nome="sair" /></button>
          </div>
        </div>
      </aside>
      <main className="conteudo">
        {slug ? <Detalhe slug={slug} />
          : pagina === 'sites' ? <Sites geral={geral} busca={params.get('q')} fase={params.get('fase')} />
          : <Visao geral={geral} />}
      </main>
    </div>
  );
}
