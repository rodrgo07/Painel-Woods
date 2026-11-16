import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Carrega e recarrega sozinho a cada `intervalo` ms, só com a aba visível.
 * Ao voltar para a aba, recarrega se a última leitura tem mais de 15 s. Mantém os dados antigos durante um erro.
 */
export function usePeriodico<T>(carregar: () => Promise<T>, intervalo: number, chave = '') {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [em, setEm] = useState(0);
  const ultimo = useRef(0);
  const vez = useRef(0);
  const fn = useRef(carregar);
  fn.current = carregar;

  const recarregar = useCallback(async () => {
    const minha = ++vez.current;
    ultimo.current = Date.now();
    setCarregando(true);
    try {
      const d = await fn.current();
      if (minha !== vez.current) return;
      setDados(d);
      setErro('');
      setEm(Date.now());
    } catch (e) {
      if (minha === vez.current) setErro(e instanceof Error ? e.message : String(e));
    } finally {
      if (minha === vez.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setDados(null);
    recarregar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') recarregar(); }, intervalo);
    const aoVoltar = () => { if (document.visibilityState === 'visible' && Date.now() - ultimo.current > 15_000) recarregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', recarregar);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar); window.removeEventListener('online', recarregar); };
  }, [intervalo, chave, recarregar]);

  return { dados, erro, carregando, em, recarregar };
}

/** Rota pelo hash (#/sites/slug): funciona em qualquer hospedagem estática sem regra de redirecionamento */
const ouvirHash = (fn: () => void) => { window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); };
export const useRota = () => useSyncExternalStore(ouvirHash, () => window.location.hash.replace(/^#\/?/, ''));
export const ir = (caminho: string) => { window.location.hash = `#/${caminho}`; };
