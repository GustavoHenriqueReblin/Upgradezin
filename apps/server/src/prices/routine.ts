import { allSearchTerms, ENABLED_CATEGORIES, ROUTINE_MODES, STORES, type CategoryId, type RoutineInfo, type RoutineInput, type RoutineMode, type RoutineSettings, type StoreId } from '@upgradezin/shared';
import { config } from '../config.ts';
import { getDb } from '../db/instance.ts';
import { backoffInfo, BlockedError, PageLimitError, pageLimitUntil, pagesUsed, registerSuccess, SearchRedirectError } from '../pace.ts';
import { ACTIVE_STORES, storeConfig } from '../stores.ts';
import { canSweep, collectSweepPage, collectTerm, withBrowserSession } from './collect.ts';
import { dueTerms, dueTermsSpread, ensureTerms } from './prices.ts';
import { nextSweep } from './sweep.ts';

/**
 * Rotina de coleta: atualiza no banco os termos mais desatualizados de cada loja, dentro de
 * ROUTINE_PAGES_PER_HOUR (o resto do limite por hora fica para a busca do site). Mesmas regras
 * da busca: uma consulta por vez por loja, com intervalo, e loja bloqueada fica parada até o fim
 * da pausa. Depois da pausa a rotina volta a tentar: loja nenhuma sai da rotina para sempre por
 * ter bloqueado uma vez.
 *
 * Cada loja tem seu modo (admin) e sua própria agenda:
 * - normal: a cada ROUTINE_TICK_MIN, varredura das categorias e até ROUTINE_BATCH termos;
 * - reduzido: um termo a cada ROUTINE_REDUCED_GAP_MIN (+ até 20% aleatório);
 * - lento: um termo a cada ROUTINE_SLOW_GAP_MIN (+ até 20% aleatório).
 * Nos dois últimos, os termos vêm espalhados pelas categorias (dueTermsSpread).
 */

/** Páginas que um termo pode gastar (a S1 abre a página de um produto para ler o cupom). */
const PAGES_PER_TERM = 2;
/** De quanto em quanto tempo a agenda é conferida. */
const CHECK_MS = 30_000;
/** Primeira consulta depois de ligar. */
const FIRST_MS = 30_000;
/** Sem termo para coletar (ou loja em pausa), confere de novo depois disto. */
const IDLE_MS = 60_000;

let timer: NodeJS.Timeout | undefined;
let ac = new AbortController();
let lastTickAt: number | null = null;
/** Próxima vez da rotina em cada loja (ms) e lojas coletando agora. */
const nextAt = new Map<StoreId, number>();
const busy = new Set<StoreId>();

const defaultMode = (id: StoreId): RoutineMode => (config.ROUTINE_SLOW_STORES.includes(id) ? 'slow' : 'normal');

const sanitize = (s: RoutineInput, base?: RoutineSettings['modes']): RoutineSettings => ({
  enabled: !!s.enabled,
  stores: STORES.filter((id) => s.stores.includes(id)),
  modes: Object.fromEntries(
    STORES.map((id) => {
      const m = s.modes?.[id] ?? base?.[id];
      return [id, m && ROUTINE_MODES.includes(m) ? m : defaultMode(id)];
    }),
  ) as RoutineSettings['modes'],
});

/** Ligada, lojas e modos: do .env até o admin mudar; depois, o que está guardado no banco. */
let settings: RoutineSettings = sanitize({ enabled: config.ROUTINE_ENABLED, stores: config.ROUTINE_STORES as StoreId[] });
let persistSettings: ((s: RoutineSettings) => void) | undefined;

/** Passa a guardar a configuração da rotina (meta "routine"); `saved` vale no lugar do .env (modo que falta: o padrão da loja). */
export function useRoutineStorage(saved: RoutineInput | null, save: (s: RoutineSettings) => void): void {
  if (saved) settings = sanitize(saved);
  persistSettings = save;
}

export const routineSettings = (): RoutineSettings => ({ ...settings, stores: [...settings.stores], modes: { ...settings.modes } });

/** Muda a rotina pelo admin: guarda e reinicia na hora (desligar interrompe as coletas em andamento). */
export function setRoutineSettings(next: RoutineInput): RoutineSettings {
  settings = sanitize(next, settings.modes);
  persistSettings?.(settings);
  stopRoutine();
  startRoutine();
  return routineSettings();
}

export const modeMinutes = (): Record<RoutineMode, number> => ({
  normal: config.ROUTINE_TICK_MIN,
  reduced: config.ROUTINE_REDUCED_GAP_MIN,
  slow: config.ROUTINE_SLOW_GAP_MIN,
});

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
  return { ...routineSettings(), busy: busy.size > 0, lastTickAt: iso(lastTickAt), nextTickAt: next.length ? iso(Math.min(...next)) : null, minutes: modeMinutes() };
}

export function startRoutine(): void {
  if (timer || !settings.enabled || !routineStores().length) return;
  if (ac.signal.aborted) ac = new AbortController();
  ensureTerms(getDb(), allSearchTerms(), 'seed');
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

const hasBudget = (store: StoreId) => pagesUsed(store) + PAGES_PER_TERM <= config.ROUTINE_PAGES_PER_HOUR;

/** Intervalo do modo reduzido ou lento: os minutos do modo mais até 20% aleatório (ms). */
export const modeDelay = (gapMin: number, rand = Math.random()) => Math.round(gapMin * 60_000 * (1 + rand / 5));

/** Categorias que a rotina varre numa loja (adapter que sabe e caminhos de varredura na configuração). */
export const sweepCategories = (store: StoreId): CategoryId[] =>
  canSweep(store) ? ENABLED_CATEGORIES.filter((c) => storeConfig(store).sweep[c]) : [];

/** Páginas de varredura por loja na última hora (orçamento próprio, dentro do da rotina). */
const sweepLog = new Map<StoreId, number[]>();
const sweepPagesLastHour = (store: StoreId) => {
  const log = (sweepLog.get(store) ?? []).filter((t) => Date.now() - t < 3_600_000);
  sweepLog.set(store, log);
  return log.length;
};

/**
 * Varredura: lê páginas das categorias da loja até o orçamento da hora, retomando de onde parou.
 * Vem antes dos termos porque cobre todo produto à venda, não só os de cada termo.
 */
async function sweepRound(store: StoreId, signal: AbortSignal): Promise<void> {
  const cats = sweepCategories(store);
  const refreshMs = config.ROUTINE_SWEEP_REFRESH_H * 3_600_000;
  const retryMs = config.ROUTINE_RETRY_MIN * 60_000;
  while (cats.length && !signal.aborted && !backoffInfo(store) && hasBudget(store) && sweepPagesLastHour(store) < config.ROUTINE_SWEEP_PAGES_PER_HOUR) {
    const next = nextSweep(getDb(), store, cats, Date.now(), refreshMs, retryMs);
    if (!next) return;
    sweepLog.get(store)!.push(Date.now());
    try {
      const n = await collectSweepPage(store, next.category, next.page, signal);
      registerSuccess(store);
      console.info(`[varredura ${store}] ${next.category} pág ${next.page}: ${n} ofertas`);
    } catch (err) {
      if (signal.aborted || err instanceof BlockedError || err instanceof PageLimitError) return;
      console.error(`[varredura ${store}] ${next.category} pág ${next.page}:`, err);
    }
  }
}

/** A vez de uma loja: marca a próxima conforme o modo e coleta. */
async function turn(store: StoreId, signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const mode = settings.modes[store];
  if (backoffInfo(store) || pageLimitUntil(store) || !hasBudget(store)) {
    nextAt.set(store, now + IDLE_MS);
    return;
  }
  const iso = (ms: number) => new Date(ms).toISOString();
  const textSince = iso(now - config.ROUTINE_TEXT_DAYS * 86_400_000);
  const retrySince = iso(now - config.ROUTINE_RETRY_MIN * 60_000);
  if (mode === 'normal') {
    nextAt.set(store, now + config.ROUTINE_TICK_MIN * 60_000);
    await sweepRound(store, signal);
    if (signal.aborted || backoffInfo(store) || !hasBudget(store)) return;
    await collectTerms(store, dueTerms(getDb(), store, iso(now - config.ROUTINE_REFRESH_H * 3_600_000), retrySince, config.ROUTINE_BATCH, textSince), signal);
    return;
  }
  // Reduzido e lento: um termo, espalhando as categorias (dueTermsSpread).
  const due = dueTermsSpread(getDb(), store, iso(now - config.ROUTINE_SLOW_REFRESH_H * 3_600_000), retrySince, 1, textSince);
  const gap = mode === 'reduced' ? config.ROUTINE_REDUCED_GAP_MIN : config.ROUTINE_SLOW_GAP_MIN;
  nextAt.set(store, now + (due.length ? modeDelay(gap) : IDLE_MS));
  await collectTerms(store, due, signal);
}

async function collectTerms(store: StoreId, due: ReturnType<typeof dueTerms>, signal: AbortSignal): Promise<void> {
  for (const t of due) {
    if (signal.aborted || !hasBudget(store) || backoffInfo(store)) return;
    try {
      const offers = await collectTerm(store, t, signal, { origin: 'routine' });
      registerSuccess(store);
      console.info(`[rotina ${store}] ${t.category} "${t.term}": ${offers.length} ofertas`);
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof BlockedError || err instanceof PageLimitError) return; // a loja descansa; volta depois da pausa
      if (err instanceof SearchRedirectError) {
        console.info(`[rotina ${store}] ${t.category} "${t.term}": a busca redireciona para ${err.to}; na próxima vez vai direto lá`);
        continue;
      }
      console.error(`[rotina ${store}] ${t.category} "${t.term}":`, err);
    }
  }
}
