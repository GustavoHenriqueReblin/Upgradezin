import { useCallback, useEffect, useRef, useState } from 'react';
import type { CategoryId, Offer, StoreId, StoreStatusEvent } from '@upgradezin/shared';

export type StatusMap = Partial<Record<StoreId, StoreStatusEvent>>;

const STOPPED: StoreStatusEvent['state'][] = ['running', 'queued', 'needs-human'];

/** Lojas que ainda estavam buscando passam a aparecer como canceladas. */
export const settleStatus = (status: StatusMap): StatusMap =>
  Object.fromEntries(Object.entries(status).map(([k, s]) => [k, s && STOPPED.includes(s.state) ? { ...s, state: 'cancelled' } : s]));

/** Loja ainda na fila ou consultando ao vivo nesta busca (a lista dela vem da própria busca). */
export const isLive = (s?: StoreStatusEvent): boolean => !!s && STOPPED.includes(s.state);

/** Estado de uma busca, para guardar e restaurar ao trocar de categoria. */
export interface SearchSnapshot {
  offers: Offer[];
  status: StatusMap;
  lastTerms: string[] | null;
}

/** Novidade que chegou depois da busca (coleta nova no banco), para o aviso discreto na tela. */
export interface Fresh {
  store: StoreId;
  /** Ofertas da loja na lista nova. */
  count: number;
  /** Marca de tempo do aviso (troca a cada novidade, mesmo da mesma loja). */
  seq: number;
}

export function useSearch() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [status, setStatus] = useState<StatusMap>({});
  const [running, setRunning] = useState(false);
  const [lastTerms, setLastTerms] = useState<string[] | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const watchRef = useRef<EventSource | null>(null);
  // Estado atual das lojas para o watch (que escuta desde o começo da busca) saber quem ainda está ao vivo.
  const statusRef = useRef<StatusMap>({});
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const stopWatch = useCallback(() => {
    watchRef.current?.close();
    watchRef.current = null;
  }, []);

  /**
   * Desde o começo da busca, a tela fica escutando: quando uma coleta grava algo da categoria
   * (rotina, loja que estava em pausa, busca de outra pessoa), a lista daquela loja é trocada sozinha.
   * Começa junto com a busca, não no fim: a rotina pode coletar uma loja que ainda espera a vez (ou está
   * em pausa) enquanto outra loja ainda está ao vivo (antes, essa coleta se perdia). Loja ainda na fila ou ao
   * vivo nesta busca é ignorada aqui: a lista dela vem da própria busca.
   */
  const watch = useCallback((params: URLSearchParams) => {
    watchRef.current?.close();
    const es = new EventSource(`/api/watch?${params}`);
    watchRef.current = es;
    es.addEventListener('offers', (e) => {
      const { store, offers: list } = JSON.parse((e as MessageEvent).data) as { store: StoreId; offers: Offer[] };
      if (isLive(statusRef.current[store])) return;
      setOffers((prev) => [...prev.filter((o) => o.store !== store), ...list]);
      setStatus((prev) => ({ ...prev, [store]: { store, state: 'cached', count: list.length, at: new Date().toISOString() } }));
    });
    es.addEventListener('fresh', (e) => {
      const { store, count } = JSON.parse((e as MessageEvent).data) as { store: StoreId; count: number };
      if (isLive(statusRef.current[store])) return;
      setFresh({ store, count, seq: Date.now() });
    });
    // Erro de rede: o navegador reconecta sozinho. Recusado (limite de abas): fica sem escutar.
  }, []);

  /** `text`: um dos termos é texto livre ("Buscar nas lojas" do filtro de texto). */
  const search = useCallback((category: CategoryId, terms: string[], stores: StoreId[], text = false) => {
    esRef.current?.close();
    stopWatch();
    setFresh(null);
    setOffers([]);
    setStatus(Object.fromEntries(stores.map((s) => [s, { store: s, state: 'queued' }])));
    setRunning(true);
    setLastTerms(terms);

    const params = new URLSearchParams({ category, terms: terms.join(','), stores: stores.join(','), ...(text ? { text: '1' } : {}) });
    const es = new EventSource(`/api/search/stream?${params}`);
    esRef.current = es;
    statusRef.current = Object.fromEntries(stores.map((s) => [s, { store: s, state: 'queued' }]));
    watch(params);

    es.addEventListener('status', (e) => {
      const s = JSON.parse((e as MessageEvent).data) as StoreStatusEvent;
      setStatus((prev) => ({ ...prev, [s.store]: s }));
    });
    es.addEventListener('offers', (e) => {
      const { store, offers: batch, partial } = JSON.parse((e as MessageEvent).data) as {
        store: StoreId;
        offers: Offer[];
        partial: boolean;
      };
      setOffers((prev) => {
        if (!partial) return [...prev.filter((o) => o.store !== store), ...batch];
        const seen = new Set(prev.map((o) => `${o.store}:${o.storeSku}`));
        return [...prev, ...batch.filter((o) => !seen.has(`${o.store}:${o.storeSku}`))];
      });
    });
    es.addEventListener('end', () => {
      es.close();
      setRunning(false);
    });
    es.onerror = () => {
      es.close();
      setRunning(false);
      // Conexão recusada ou caída: lojas que não terminaram não ficam presas em "na fila".
      setStatus(settleStatus);
    };
  }, []);

  const cancel = useCallback(() => {
    esRef.current?.close();
    stopWatch();
    esRef.current = null;
    setRunning(false);
    // Fechar a conexão faz o servidor abortar; aqui só refletimos isso na tela.
    setStatus(settleStatus);
  }, []);

  /** Troca o estado exibido (null = vazio). Interrompe a busca em andamento. */
  const restore = useCallback((snap: SearchSnapshot | null) => {
    esRef.current?.close();
    stopWatch();
    setFresh(null);
    esRef.current = null;
    setRunning(false);
    setOffers(snap?.offers ?? []);
    setStatus(snap?.status ?? {});
    setLastTerms(snap?.lastTerms ?? null);
  }, []);

  // Saiu da tela (componente desmontado): para de escutar.
  useEffect(() => () => {
    esRef.current?.close();
    stopWatch();
  }, [stopWatch]);

  return { offers, status, running, lastTerms, fresh, search, cancel, restore };
}
