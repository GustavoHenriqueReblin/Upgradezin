import { useEffect, useRef } from 'react';
import type { AdminChange } from '@upgradezin/shared';

/**
 * Canal ao vivo do admin (/api/admin/live, SSE), uma conexão só para a página toda. O servidor
 * manda `attempt` (consulta terminou) e `change` (loja lendo ou em pausa, algo mudado pelo admin,
 * busca no site). Cada tela diz o que a interessa e recarrega quando chega.
 */
export type LiveKind = 'attempt' | AdminChange;

type Listener = (kind: LiveKind) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;

function connect() {
  if (es || typeof EventSource === 'undefined') return;
  es = new EventSource('/api/admin/live');
  es.addEventListener('attempt', () => listeners.forEach((fn) => fn('attempt')));
  es.addEventListener('change', (e) => {
    const kind = (JSON.parse((e as MessageEvent).data) as { kind: AdminChange }).kind;
    listeners.forEach((fn) => fn(kind));
  });
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  connect();
  return () => {
    listeners.delete(fn);
    if (!listeners.size && es) {
      es.close();
      es = null;
    }
  };
}

type Options = { delayMs?: number; fallbackMs?: number };

/**
 * Chama `reload` quando chega um aviso de um dos `kinds` (com uma folga de `delayMs` para juntar
 * avisos seguidos: ao conectar, o canal manda as últimas consultas de uma vez), quando a aba do
 * navegador volta a ficar visível (avisos perdidos com ela escondida) e, por garantia, a cada
 * `fallbackMs` com ela visível (o que não gera aviso, como o fim de uma pausa pelo tempo; 0: nunca).
 * Devolve a função que para.
 */
export function watchLive(kinds: LiveKind[], reload: () => void, { delayMs = 500, fallbackMs = 30_000 }: Options = {}): () => void {
  if (!kinds.length && !fallbackMs) return () => {};
  const wanted = new Set<string>(kinds);
  let t: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(t);
    t = setTimeout(reload, delayMs);
  };
  const off = kinds.length ? subscribe((kind) => wanted.has(kind) && later()) : () => {};
  const visible = () => document.visibilityState === 'visible';
  const onVisible = () => visible() && later();
  document.addEventListener('visibilitychange', onVisible);
  const every = fallbackMs ? setInterval(() => visible() && reload(), fallbackMs) : undefined;
  return () => {
    off();
    clearTimeout(t);
    clearInterval(every);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** `watchLive` numa tela: liga ao montar, para ao desmontar; usa sempre o `reload` mais recente. */
export function useLiveReload(kinds: LiveKind[], reload: () => void, { delayMs = 500, fallbackMs = 30_000 }: Options = {}) {
  const ref = useRef(reload);
  useEffect(() => {
    ref.current = reload;
  });
  const key = kinds.join();
  useEffect(() => watchLive(key ? (key.split(',') as LiveKind[]) : [], () => ref.current(), { delayMs, fallbackMs }), [key, delayMs, fallbackMs]);
}
