import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, erroConfig } from './lib/supabase.ts';
import { carregarGeral, esquecerAssinaturas } from './lib/dados.ts';
import { usePeriodico, useRota } from './lib/ganchos.ts';
import { Login } from './paginas/Login.tsx';
import { Visao } from './paginas/Visao.tsx';
import { Sites } from './paginas/Sites.tsx';
import { Detalhe } from './paginas/Detalhe.tsx';
import { Integracao, Aviso, Marca } from './componentes/ui.tsx';

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
  const [pagina, ...resto] = rota.split('/');
  const slug = pagina === 'sites' && resto[0] ? decodeURIComponent(resto[0]) : '';
  useEffect(() => { window.scrollTo(0, 0); }, [rota]);

  const sair = async () => {
    esquecerAssinaturas();
    await supabase!.auth.signOut();
    window.location.hash = '';
  };

  const nav = [['', 'Visão geral'], ['sites', 'Sites']] as const;
  const ativo = pagina === 'sites' ? 'sites' : '';

  return (
    <div className="casca">
      <aside className="lateral">
        <Marca />
        <nav className="nav" aria-label="Seções">
          {nav.map(([r, rotulo]) => (
            <a key={r} href={`#/${r}`} className={ativo === r ? 'ativo' : ''} aria-current={ativo === r ? 'page' : undefined}>{rotulo}</a>
          ))}
        </nav>
        <div className="lateral-pe">
          {geral.dados && <Integracao dispositivos={geral.dados.dispositivos} compacto />}
          <div className="conta">
            <span className="conta-email" title={email}>{email}</span>
            <button type="button" className="btn fantasma" onClick={sair}>Sair</button>
          </div>
        </div>
      </aside>
      <main className="conteudo">
        {slug ? <Detalhe slug={slug} />
          : pagina === 'sites' ? <Sites geral={geral} />
          : <Visao geral={geral} />}
      </main>
    </div>
  );
}
