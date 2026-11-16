import type { ReactNode } from 'react';
import { fase, integracao, iniciais, relativo, dataHora, ROTULO_FASE } from '../lib/regras.ts';
import type { Dispositivo } from '../lib/tipos.ts';

// Ícones de traço (24×24), desenhados aqui: sem biblioteca de ícones
const ICONES = {
  visao: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  sites: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  externo: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  codigo: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
  sair: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  local: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  atualizar: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  voltar: 'M15 18l-6-6 6-6',
} as const;

export function Icone({ nome, className = '' }: { nome: keyof typeof ICONES; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`icone ${className}`} aria-hidden="true"><path d={ICONES[nome]} /></svg>;
}

export function Avatar({ nome, pequeno = false }: { nome: string; pequeno?: boolean }) {
  return <span className={`avatar ${pequeno ? 'pequeno' : ''}`} title={nome} aria-hidden="true">{iniciais(nome)}</span>;
}

export function Marca() {
  return (
    <a className="marca" href="#/" aria-label="Woods Web, visão geral">
      <span className="marca-simbolo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6l3.2 12L12 8.5 16.8 18 20 6" /></svg></span>
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
        <span>{titulo}{d ? <small>{relativo(d.ultimo_contato)}</small> : null}</span>
      </div>
    );
  }
  return (
    <section className={`painel integracao sit-${situacao}`} aria-label="Integração com o desktop">
      <header className="painel-topo"><h2>Integração</h2><span className="selo-sit"><i aria-hidden="true" />{titulo}</span></header>
      {dica && <p className="suave pequeno">{dica}</p>}
      {d && (
        <dl className="dados">
          <div><dt>Computador</dt><dd>{d.nome || '—'}{d.versao_app ? <span className="suave"> · v{d.versao_app}</span> : ''}</dd></div>
          <div><dt>Último contato</dt><dd title={dataHora(d.ultimo_contato)}>{relativo(d.ultimo_contato)}</dd></div>
          <div><dt>Última sincronização</dt><dd title={dataHora(d.ultima_sincronizacao)}>{relativo(d.ultima_sincronizacao)}</dd></div>
          <div><dt>Pendentes</dt><dd className={d.pendentes ? 'atencao' : ''}>{d.pendentes ? `${d.pendentes} envio(s)` : 'nenhum'}</dd></div>
          {d.ultimo_erro && <div className="largo"><dt>Último erro</dt><dd className="atencao">{d.ultimo_erro}</dd></div>}
        </dl>
      )}
    </section>
  );
}

export function Atualizado({ em, carregando, recarregar }: { em: number; carregando: boolean; recarregar: () => void }) {
  return (
    <button type="button" className="atualizado" onClick={recarregar} disabled={carregando} title="Atualizar agora">
      <Icone nome="atualizar" className={carregando ? 'gira' : ''} />
      {carregando ? 'Atualizando…' : em ? `Atualizado ${relativo(new Date(em).toISOString())}` : 'Atualizar'}
    </button>
  );
}
