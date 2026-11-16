import type { ReactNode } from 'react';
import { fase, integracao, relativo, dataHora, ROTULO_FASE } from '../lib/regras.ts';
import type { Dispositivo } from '../lib/tipos.ts';

export function Marca() {
  return (
    <a className="marca" href="#/">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 10l3.2 12L16 12l4.8 10L24 10" /></svg>
      <span>Woods <em>Web</em></span>
    </a>
  );
}

/** Status da ficha como está escrito, com a cor da fase */
export function Status({ status }: { status: string | null }) {
  const f = fase(status);
  return <span className={`status fase-${f}`} title={ROTULO_FASE[f]}><i aria-hidden="true" />{status || 'sem status'}</span>;
}

export function Aviso({ tipo = 'info', titulo, children, acao }: { tipo?: 'info' | 'erro' | 'vazio'; titulo: string; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : undefined}>
      <strong>{titulo}</strong>
      {children && <p>{children}</p>}
      {acao}
    </div>
  );
}

export function Carregando({ linhas = 3 }: { linhas?: number }) {
  return <div className="esqueleto" aria-busy="true" aria-label="Carregando">{Array.from({ length: linhas }, (_, i) => <span key={i} />)}</div>;
}

/** Faixa de erro sobre dados que já estavam na tela */
export function ErroAtualizar({ erro, tentar }: { erro: string; tentar: () => void }) {
  return (
    <div className="faixa-erro" role="status">
      <span>{erro}</span>
      <button type="button" className="btn fantasma" onClick={tentar}>Tentar de novo</button>
    </div>
  );
}

const TEXTO_DESKTOP = {
  nenhum: ['Desktop nunca conectado', 'Conecte o Painel Woods em Configurações → Woods Web.'],
  online: ['Desktop conectado', ''],
  'sem-contato': ['Desktop sem contato', 'O Painel Woods está fechado ou sem internet.'],
  desconectado: ['Desktop desconectado', 'A conta foi desconectada no Painel Woods.'],
} as const;

export function Integracao({ dispositivos, compacto = false }: { dispositivos: Dispositivo[]; compacto?: boolean }) {
  const { situacao, dispositivo: d } = integracao(dispositivos);
  const [titulo, dica] = TEXTO_DESKTOP[situacao];
  if (compacto) {
    return (
      <div className={`integracao-mini sit-${situacao}`} title={dica || undefined}>
        <i aria-hidden="true" />
        <span>{titulo}{d ? ` · ${relativo(d.ultimo_contato)}` : ''}</span>
      </div>
    );
  }
  return (
    <section className={`painel integracao sit-${situacao}`} aria-label="Integração com o desktop">
      <header><i aria-hidden="true" /><h2>{titulo}</h2></header>
      {dica && <p className="suave">{dica}</p>}
      {d && (
        <dl className="dados">
          <div><dt>Computador</dt><dd>{d.nome || '—'}{d.versao_app ? ` · v${d.versao_app}` : ''}</dd></div>
          <div><dt>Último contato</dt><dd title={dataHora(d.ultimo_contato)}>{relativo(d.ultimo_contato)}</dd></div>
          <div><dt>Última sincronização</dt><dd title={dataHora(d.ultima_sincronizacao)}>{relativo(d.ultima_sincronizacao)}</dd></div>
          <div><dt>Pendentes no desktop</dt><dd className={d.pendentes ? 'atencao' : ''}>{d.pendentes ? `${d.pendentes} envio(s)` : 'nenhum'}</dd></div>
          {d.ultimo_erro && <div className="largo"><dt>Último erro</dt><dd className="atencao">{d.ultimo_erro}</dd></div>}
        </dl>
      )}
    </section>
  );
}

export function Atualizado({ em, carregando, recarregar }: { em: number; carregando: boolean; recarregar: () => void }) {
  return (
    <button type="button" className="atualizado" onClick={recarregar} disabled={carregando} title="Atualizar agora">
      <svg viewBox="0 0 16 16" aria-hidden="true" className={carregando ? 'gira' : ''}><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" /></svg>
      {carregando ? 'Atualizando…' : em ? `Atualizado ${relativo(new Date(em).toISOString())}` : 'Atualizar'}
    </button>
  );
}
