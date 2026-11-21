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
  return s;
}

export function registerBlock(store: StoreId, reason: BlockReason) {
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
 * Lojas lentas (ROUTINE_SLOW_STORES, as de navegador): aceitam a primeira página e bloqueiam
 * a seguinte quando ela vem segundos depois (nos logs: 7–26 s depois de uma coleta boa). Entre
 * duas consultas a elas, venham da rotina ou da busca do site, passa no mínimo SLOW_MIN_GAP_S.
 * A última consulta fica no banco: reiniciar o servidor não libera uma rajada.
 */
export const isSlowStore = (store: StoreId) => config.ROUTINE_SLOW_STORES.includes(store);
const slowLast = new Map<StoreId, number>();
let persistSlow: ((store: StoreId, at: number) => void) | undefined;
export function useSlowStorage(saved: [StoreId, number][], save: (store: StoreId, at: number) => void) {
  for (const [store, at] of saved) slowLast.set(store, at);
  persistSlow = save;
}
/** Quando a loja lenta pode receber a próxima consulta (ms); 0 para as outras. */
export const slowReadyAt = (store: StoreId) => (isSlowStore(store) ? (slowLast.get(store) ?? 0) + config.SLOW_MIN_GAP_S * 1000 : 0);

/**
 * Uma consulta por vez em cada loja, venha da busca do site ou da rotina, com intervalo
 * aleatório desde o fim da anterior (nas lojas lentas, também SLOW_MIN_GAP_S). A fila é por loja: lojas diferentes seguem em paralelo.
 */
const queues = new Map<StoreId, Promise<void>>();
const lastDone = new Map<StoreId, number>();

export async function withStore<T>(store: StoreId, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(store) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  queues.set(store, prev.then(() => mine));
  try {
    // Esperando a vez; cancelar libera na hora (sem segurar a fila de quem vem depois).
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      void prev.then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
    // Na fila atrás de uma consulta que bloqueou: não vai à loja (antes ia, e o 2º bloqueio
    // seguido subia a pausa de 15 min para 1 h).
    const paused = () => {
      const bo = backoffInfo(store);
      if (bo) throw new BlockedError(store, bo.reason, 'loja em pausa', true);
    };
    paused();
    const wait = Math.max((lastDone.get(store) ?? 0) + jitter(), slowReadyAt(store)) - Date.now();
    if (wait > 0) await sleep(wait, signal);
    paused();
    try {
      return await fn();
    } finally {
      lastDone.set(store, Date.now());
      if (isSlowStore(store)) {
        slowLast.set(store, Date.now());
        persistSlow?.(store, Date.now());
      }
    }
  } finally {
    release();
  }
}
