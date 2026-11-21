import type { BlockReason, StoreId } from '@upgradezin/shared';
import { config } from './config.ts';

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

export function jitter(min = config.PAGE_DELAY_MIN_MS, max = config.PAGE_DELAY_MAX_MS): number {
  return Math.round(min + Math.random() * (max - min));
}

/**
 * `detail` vai só para o log; a UI recebe `reason`. `paused`: a loja já estava em pausa e a
 * consulta nem saiu (não conta como bloqueio novo nem sobe a escada da pausa).
 */
export class BlockedError extends Error {
  constructor(
    public store: StoreId,
    public reason: BlockReason,
    detail: string,
    public paused = false,
  ) {
    super(detail);
  }
}

/**
 * Backoff por loja após bloqueio: 15 min, 1 h, 6 h, 24 h.
 * Bloqueio nunca é contornado, só respeitado.
 */
const STEPS_MIN = [15, 60, 360, 1440];
export interface Backoff {
  until: number;
  step: number;
  reason: BlockReason;
}
const state = new Map<StoreId, Backoff>();

/**
 * Pausas guardadas fora da memória (no banco): reiniciar o servidor não pode zerar a pausa
 * de uma loja que acabou de bloquear.
 */
let persist: ((store: StoreId, b: Backoff | null) => void) | undefined;
export function useBackoffStorage(saved: [StoreId, Backoff][], save: (store: StoreId, b: Backoff | null) => void) {
  for (const [store, b] of saved) state.set(store, b);
  persist = save;
}

export function backoffInfo(store: StoreId) {
  const s = state.get(store);
  if (!s || s.until < Date.now()) return null;
  // BACKOFF_ENABLED=false: só a pausa manual do admin vale (as automáticas, inclusive as já guardadas, não).
  if (!config.BACKOFF_ENABLED && s.reason !== 'paused') return null;
  return s;
}

export function registerBlock(store: StoreId, reason: BlockReason) {
  if (!config.BACKOFF_ENABLED) return;
  const prev = state.get(store);
  const step = prev ? Math.min(prev.step + 1, STEPS_MIN.length - 1) : 0;
  const b = { until: Date.now() + STEPS_MIN[step]! * 60_000, step, reason };
  state.set(store, b);
  persist?.(store, b);
}

export function registerSuccess(store: StoreId) {
  if (state.delete(store)) persist?.(store, null);
}

/** Tira a pausa da loja (admin). A escada recomeça do primeiro degrau no próximo bloqueio. */
export function clearBackoff(store: StoreId): boolean {
  const had = state.delete(store);
  if (had) persist?.(store, null);
  return had;
}

/**
 * Pausa manual (admin): a loja não é consultada até `until`. Não sobe a escada: o degrau de
 * uma pausa por bloqueio que estava valendo é mantido; sem pausa antes, fica -1 (o próximo
 * bloqueio começa do primeiro degrau, 15 min).
 */
export function pauseStore(store: StoreId, minutes: number, now = Date.now()): Backoff {
  const b: Backoff = { until: now + minutes * 60_000, step: state.get(store)?.step ?? -1, reason: 'paused' };
  state.set(store, b);
  persist?.(store, b);
  return b;
}

/**
 * Limite de páginas por loja por hora (janela deslizante), para o volume ficar
 * parecido com o de uma pessoa consultando. Estourou: a loja é pulada até liberar.
 */
/**
 * A busca da loja levou o termo para outra página (ex. a da categoria, quando o termo é o nome
 * dela), sem lista de produtos. Não é bloqueio: a loja não entra em pausa, e o destino fica
 * guardado no termo; as próximas coletas desse termo nessa loja abrem o destino direto.
 */
export class SearchRedirectError extends Error {
  constructor(
    public store: StoreId,
    public to: string,
  ) {
    super(`A busca da loja redireciona este termo para outra página (${to}), sem lista de produtos`);
  }
}

export class PageLimitError extends Error {
  constructor(
    public store: StoreId,
    public until: number,
  ) {
    super(`Limite de ${config.MAX_PAGES_PER_HOUR} páginas/hora atingido`);
  }
}

const pageLog = new Map<StoreId, number[]>();

export function takePage(store: StoreId) {
  const now = Date.now();
  const log = (pageLog.get(store) ?? []).filter((t) => now - t < 3_600_000);
  if (log.length >= config.MAX_PAGES_PER_HOUR) throw new PageLimitError(store, log[0]! + 3_600_000);
  log.push(now);
  pageLog.set(store, log);
}

/** Se a loja já está sem páginas disponíveis nesta hora, devolve quando libera. */
export function pageLimitUntil(store: StoreId): number | null {
  const now = Date.now();
  const log = (pageLog.get(store) ?? []).filter((t) => now - t < 3_600_000);
  return log.length >= config.MAX_PAGES_PER_HOUR ? log[0]! + 3_600_000 : null;
}

/** Páginas pedidas à loja na última hora (a rotina deixa a maior parte para quem busca no site). */
export function pagesUsed(store: StoreId): number {
  const now = Date.now();
  return (pageLog.get(store) ?? []).filter((t) => now - t < 3_600_000).length;
}

/**
 * Uma consulta por vez em cada loja, venha da busca do site ou da rotina, com intervalo
 * aleatório desde o fim da anterior. A fila é por loja: lojas diferentes seguem em paralelo.
 * O ritmo da rotina (modo da loja) fica na própria rotina (prices/routine.ts), não aqui.
 *
 * Prioridade: quem busca no site passa na frente das consultas da rotina que estão esperando
 * (entre as prioritárias, ordem de chegada). A consulta que já está em andamento termina antes.
 */
interface Waiter {
  priority: boolean;
  go: () => void;
}
const running = new Set<StoreId>();
const waiters = new Map<StoreId, Waiter[]>();
const lastDone = new Map<StoreId, number>();

/** Espera a vez na loja. Cancelar tira da fila na hora (sem segurar quem vem depois). */
function acquire(store: StoreId, priority: boolean, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (!running.has(store)) {
    running.add(store);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const list = waiters.get(store) ?? [];
    const onAbort = () => {
      const i = list.indexOf(w);
      if (i >= 0) list.splice(i, 1);
      reject(signal.reason);
    };
    const w: Waiter = {
      priority,
      go: () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
    };
    const firstRoutine = priority ? list.findIndex((x) => !x.priority) : -1;
    if (firstRoutine === -1) list.push(w);
    else list.splice(firstRoutine, 0, w);
    waiters.set(store, list);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Passa a vez para o próximo da fila (a loja continua ocupada) ou libera a loja. */
function release(store: StoreId) {
  const next = waiters.get(store)?.shift();
  if (next) next.go();
  else running.delete(store);
}

/**
 * Fila da loja agora: se há consulta em andamento (de qualquer origem) e quantas esperam a vez,
 * separando as prioritárias (busca do site, admin, ficha técnica) das da rotina.
 */
export const queuedAt = (store: StoreId): { running: boolean; priority: number; routine: number } => {
  const list = waiters.get(store) ?? [];
  return { running: running.has(store), priority: list.filter((w) => w.priority).length, routine: list.filter((w) => !w.priority).length };
};

export async function withStore<T>(store: StoreId, signal: AbortSignal, fn: () => Promise<T>, opts: { priority?: boolean } = {}): Promise<T> {
  await acquire(store, opts.priority ?? false, signal);
  try {
    // Na fila atrás de uma consulta que bloqueou: não vai à loja (antes ia, e o 2º bloqueio
    // seguido subia a pausa de 15 min para 1 h).
    const paused = () => {
      const bo = backoffInfo(store);
      if (bo) throw new BlockedError(store, bo.reason, 'loja em pausa', true);
    };
    paused();
    // Intervalo aleatório entre páginas, desde o fim da consulta anterior.
    const wait = (lastDone.get(store) ?? 0) + jitter() - Date.now();
    if (wait > 0) await sleep(wait, signal);
    paused();
    try {
      return await fn();
    } finally {
      lastDone.set(store, Date.now());
    }
  } finally {
    release(store);
  }
}
