import { ENABLED_CATEGORIES, MODE_SECONDS_MAX, MODE_SECONDS_MIN, ROUTINE_MODES, STORES, type CategoryId, type RoutineInfo, type RoutineInput, type RoutineMode, type RoutineSettings, type StoreId } from '@upgradezin/shared';
import { config } from '../config.ts';
import { getDb } from '../db/instance.ts';
import { backoffInfo, BlockedError, jitter, PageLimitError, pageLimitUntil, pagesUsed, registerSuccess, sleep } from '../pace.ts';
import { ACTIVE_STORES, sweepPaths } from '../stores.ts';
import { canSweep, collectSweepPage, withBrowserSession } from './collect.ts';
import { nextSweep } from './sweep.ts';

/**
 * Rotina de preços: lê as páginas de categoria de cada loja (sweep.ts), só o que está em estoque,
 * e recomeça cada categoria ROUTINE_REFRESH_H horas depois da última volta completa. Dentro de
 * ROUTINE_PAGES_PER_HOUR (o resto do limite por hora fica para a busca por texto e as fichas). Uma
 * consulta por vez por loja, e loja bloqueada fica parada até o fim da pausa; na fila da loja, a
 * busca por texto e o admin passam na frente da rotina.
 *
 * Cada vez de uma loja lê uma categoria inteira: todas as páginas com estoque, uma atrás da outra
 * (com o intervalo de sempre entre páginas da loja, PAGE_DELAY_*), até o fim da volta da categoria.
 * Depois espera os segundos do modo (editáveis no admin; padrão ROUTINE_NORMAL_GAP_S / _REDUCED_ /
 * _SLOW_) + até 20% aleatório e passa à próxima categoria.
 * As fichas técnicas têm rotina própria (sheet-routine.ts). A busca por texto é outra chave por
 * loja (`live`): ligada, o "Não achou? Buscar nas lojas" vai à loja na hora.
 */

/** Páginas que uma página de categoria pode gastar (a S1 abre a página de um produto para ler o cupom). */
const PAGES_PER_TURN = 2;
/** De quanto em quanto tempo a agenda é conferida (curto: os modos são de segundos). */
const CHECK_MS = 2_000;
/** Primeira consulta depois de ligar. */
const FIRST_MS = 10_000;
/** Nada para ler agora (todas as categorias lidas há pouco, ou loja em pausa): confere de novo depois disto. */
const IDLE_MS = 60_000;

let timer: NodeJS.Timeout | undefined;
let ac = new AbortController();
let lastTickAt: number | null = null;
/** Próxima vez da rotina em cada loja (ms) e lojas coletando agora. */
const nextAt = new Map<StoreId, number>();
const busy = new Set<StoreId>();

/** Modo de uma loja sem nada escolhido: lento para ROUTINE_SLOW_STORES, normal para as outras. */
export const defaultMode = (store: StoreId): RoutineMode => (config.ROUTINE_SLOW_STORES.includes(store) ? 'slow' : 'normal');

const DEFAULT_SECONDS: Record<RoutineMode, number> = {
  normal: config.ROUTINE_NORMAL_GAP_S,
  reduced: config.ROUTINE_REDUCED_GAP_S,
  slow: config.ROUTINE_SLOW_GAP_S,
};

const validSeconds = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= MODE_SECONDS_MIN && n <= MODE_SECONDS_MAX;

/** Junta o enviado com o que já valia (`base`); o que falta ou é inválido fica como estava (ou o padrão). */
const sanitize = (s: RoutineInput, base?: RoutineSettings): RoutineSettings => ({
  enabled: !!s.enabled,
  stores: STORES.filter((id) => s.stores.includes(id)),
  modes: Object.fromEntries(
    STORES.map((id) => {
      const m = s.modes?.[id];
      return [id, m && ROUTINE_MODES.includes(m) ? m : (base?.modes[id] ?? defaultMode(id))];
    }),
  ) as RoutineSettings['modes'],
  live: Object.fromEntries(
    STORES.map((id) => {
      const v = s.live?.[id];
      return [id, typeof v === 'boolean' ? v : (base?.live[id] ?? true)];
    }),
  ) as RoutineSettings['live'],
  seconds: Object.fromEntries(
    ROUTINE_MODES.map((m) => {
      const v = s.seconds?.[m];
      return [m, validSeconds(v) ? v : (base?.seconds[m] ?? DEFAULT_SECONDS[m])];
    }),
  ) as RoutineSettings['seconds'],
});

/** Ligada, lojas, modos, busca ao vivo e segundos: do .env até o admin mudar; depois, o que está guardado no banco. */
let settings: RoutineSettings = sanitize({ enabled: config.ROUTINE_ENABLED, stores: config.ROUTINE_STORES as StoreId[] });
let persistSettings: ((s: RoutineSettings) => void) | undefined;

/** Passa a guardar a configuração da rotina (meta "routine"); `saved` vale no lugar do .env (o que falta: o padrão). */
export function useRoutineStorage(saved: RoutineInput | null, save: (s: RoutineSettings) => void): void {
  if (saved) settings = sanitize(saved);
  persistSettings = save;
}

export const routineSettings = (): RoutineSettings => ({
  ...settings,
  stores: [...settings.stores],
  modes: { ...settings.modes },
  live: { ...settings.live },
  seconds: { ...settings.seconds },
});

/** A loja é consultada na hora quando alguém pesquisa no site (admin, "Busca ao vivo"). */
export const isLive = (store: StoreId): boolean => settings.live[store] ?? true;

/**
 * Muda a rotina pelo admin e guarda. Ligar, desligar ou mudar as lojas reinicia na hora (desligar
 * interrompe as coletas em andamento); modo, segundos e busca ao vivo valem sem reiniciar (o
 * intervalo novo conta a partir da próxima coleta de cada loja).
 */
export function setRoutineSettings(next: RoutineInput): RoutineSettings {
  const prev = settings;
  settings = sanitize(next, settings);
  persistSettings?.(settings);
  if (prev.enabled !== settings.enabled || prev.stores.join() !== settings.stores.join() || !timer) {
    stopRoutine();
    startRoutine();
  }
  return routineSettings();
}

/** Próxima vez da rotina na loja (ms), ou null se a rotina não está rodando nela. */
export function routineNextAt(store: StoreId): number | null {
  if (!timer || !routineStores().includes(store)) return null;
  return nextAt.get(store) ?? null;
}

export const routineBusy = (store: StoreId) => busy.has(store);

export function routineInfo(): RoutineInfo {
  const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
  const next = routineStores()
    .map((s) => routineNextAt(s))
    .filter((t): t is number => t != null);
  return { ...routineSettings(), busy: busy.size > 0, lastTickAt: iso(lastTickAt), nextTickAt: next.length ? iso(Math.min(...next)) : null };
}

export function startRoutine(): void {
  if (timer || !settings.enabled || !routineStores().length) return;
  if (ac.signal.aborted) ac = new AbortController();
  const first = Date.now() + FIRST_MS;
  for (const s of STORES) nextAt.set(s, first);
  timer = setInterval(() => void tick(), CHECK_MS);
}

export function stopRoutine(): void {
  clearInterval(timer);
  timer = undefined;
  nextAt.clear();
  ac.abort();
}

/** Confere a agenda: cada loja da rotina que chegou na hora e não está coletando começa a sua vez. */
export async function tick(now = Date.now()): Promise<void> {
  const signal = ac.signal;
  const due = routineStores().filter((s) => !busy.has(s) && now >= (nextAt.get(s) ?? 0));
  if (!due.length) return;
  lastTickAt = now;
  await Promise.all(
    due.map(async (store) => {
      busy.add(store);
      try {
        await withBrowserSession(() => turn(store, signal));
      } finally {
        busy.delete(store);
      }
    }),
  );
}

/** Lojas ligadas que estão na rotina (admin; antes, ROUTINE_STORES). */
const routineStores = (): StoreId[] => (settings.enabled ? ACTIVE_STORES.filter((s) => settings.stores.includes(s)) : []);

const hasBudget = (store: StoreId) => pagesUsed(store) + PAGES_PER_TURN <= config.ROUTINE_PAGES_PER_HOUR;

/** Intervalo do modo: os segundos do modo mais até 20% aleatório (ms). */
export const modeDelay = (gapS: number, rand = Math.random()) => Math.round(gapS * 1000 * (1 + rand / 5));

/** Quantos caminhos de categoria cada categoria tem numa loja (as sem caminho ficam de fora). */
export function sweepPathCounts(store: StoreId): Partial<Record<CategoryId, number>> {
  if (!canSweep(store)) return {};
  const out: Partial<Record<CategoryId, number>> = {};
  for (const c of ENABLED_CATEGORIES) {
    const n = sweepPaths(store, c).length;
    if (n) out[c] = n;
  }
  return out;
}

/** Teto de páginas numa vez da rotina (uma categoria inteira, todos os caminhos). */
const MAX_PAGES_PER_TURN = 200;

/**
 * Uma categoria inteira da loja, se alguma está na hora: as páginas com estoque, uma atrás da outra
 * (retoma de onde parou), até o fim da volta da categoria. Para antes se a loja entrar em pausa, o
 * limite da hora acabar ou a rotina desligar. Devolve se foi à loja.
 */
async function sweepCategory(store: StoreId, signal: AbortSignal): Promise<boolean> {
  const first = nextSweep(getDb(), store, sweepPathCounts(store), Date.now(), config.ROUTINE_REFRESH_H * 3_600_000, config.ROUTINE_RETRY_MIN * 60_000);
  if (!first) return false;
  const { category } = first;
  let pages = 0;
  let saved = 0;
  try {
    for (let n = 0; n < MAX_PAGES_PER_TURN && !signal.aborted; n++) {
      if (n > 0) {
        if (backoffInfo(store) || pageLimitUntil(store) || !hasBudget(store)) break;
        await sleep(jitter(), signal);
      }
      const next = nextSweep(getDb(), store, { [category]: sweepPathCounts(store)[category] ?? 0 }, Date.now(), config.ROUTINE_REFRESH_H * 3_600_000, config.ROUTINE_RETRY_MIN * 60_000);
      if (!next) break;
      const r = await collectSweepPage(store, category, next.path, next.page, signal);
      registerSuccess(store);
      pages++;
      saved += r.saved;
      if (r.roundDone) {
        console.info(`[rotina ${store}] ${category}: ${pages} página(s), ${saved} ofertas gravadas; volta completa${r.outOfStock ? `, ${r.outOfStock} sem estoque agora` : ''}`);
        return true;
      }
    }
    console.info(`[rotina ${store}] ${category}: ${pages} página(s), ${saved} ofertas gravadas; parou antes do fim (continua na próxima vez)`);
  } catch (err) {
    if (!signal.aborted && !(err instanceof BlockedError) && !(err instanceof PageLimitError)) console.error(`[rotina ${store}] ${category}:`, err);
  }
  return true;
}

/** A vez de uma loja: uma categoria inteira e marca a próxima vez para o intervalo do modo depois que ela terminar. */
async function turn(store: StoreId, signal: AbortSignal): Promise<void> {
  if (backoffInfo(store) || pageLimitUntil(store) || !hasBudget(store)) {
    nextAt.set(store, Date.now() + IDLE_MS);
    return;
  }
  const did = await sweepCategory(store, signal);
  nextAt.set(store, Date.now() + (did ? modeDelay(settings.seconds[settings.modes[store]]) : IDLE_MS));
}
