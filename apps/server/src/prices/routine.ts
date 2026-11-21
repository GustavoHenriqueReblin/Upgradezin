import { allSearchTerms, ENABLED_CATEGORIES, MODE_SECONDS_MAX, MODE_SECONDS_MIN, ROUTINE_MODES, SHEETS_PER_HOUR_MAX, STORES, type CategoryId, type RoutineInfo, type RoutineInput, type RoutineMode, type RoutineSettings, type StoreId } from '@upgradezin/shared';
import { config } from '../config.ts';
import { getDb } from '../db/instance.ts';
import { backoffInfo, BlockedError, PageLimitError, pageLimitUntil, pagesUsed, registerSuccess, SearchRedirectError } from '../pace.ts';
import { ACTIVE_STORES, storeConfig } from '../stores.ts';
import { canReadSheet, canSweep, collectSweepPage, collectTerm, sheetOf, withBrowserSession } from './collect.ts';
import { dueTerms, ensureTerms } from './prices.ts';
import { nextSheets, SHEET_SCOPE_DAYS } from './sheets.ts';
import { nextSweep } from './sweep.ts';

/**
 * Rotina de coleta: atualiza no banco os termos mais desatualizados de cada loja, dentro de
 * ROUTINE_PAGES_PER_HOUR (o resto do limite por hora fica para a busca do site). Mesmas regras
 * da busca: uma consulta por vez por loja, e loja bloqueada fica parada até o fim da pausa.
 * Na fila da loja, a busca do site passa na frente da rotina.
 *
 * Cada loja tem seu modo (admin) e sua própria agenda: os segundos do modo (editáveis no admin;
 * padrão ROUTINE_NORMAL_GAP_S / _REDUCED_ / _SLOW_), + até 20% aleatório, depois de cada coisa
 * que a rotina faz: uma página da varredura (só no normal, loja com varredura, se estiver na hora
 * e houver orçamento), um termo, com as categorias espalhadas (dueTerms), ou uma ficha técnica do
 * catálogo (placa de vídeo, gabinete, cooler) ainda não lida, em rodízio (turn).
 * O modo é só da rotina. A busca do site é outra chave por loja (`live`): ligada, vai na hora.
 */

/** Páginas que um termo pode gastar (a S1 abre a página de um produto para ler o cupom). */
const PAGES_PER_TERM = 2;
/** De quanto em quanto tempo a agenda é conferida (curto: os modos são de segundos). */
const CHECK_MS = 2_000;
/** Primeira consulta depois de ligar. */
const FIRST_MS = 10_000;
/** Sem termo para coletar (ou loja em pausa), confere de novo depois disto. */
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

const validPerHour = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= SHEETS_PER_HOUR_MAX;

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
  sheets: {
    enabled: typeof s.sheets?.enabled === 'boolean' ? s.sheets.enabled : (base?.sheets.enabled ?? true),
    perHour: validPerHour(s.sheets?.perHour) ? s.sheets!.perHour! : (base?.sheets.perHour ?? Math.min(config.ROUTINE_SHEETS_PER_HOUR, SHEETS_PER_HOUR_MAX)),
  },
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
  sheets: { ...settings.sheets },
});

/** A loja é consultada na hora quando alguém pesquisa no site (admin, "Busca ao vivo"). */
export const isLive = (store: StoreId): boolean => settings.live[store] ?? true;

/**
 * Muda a rotina pelo admin e guarda. Ligar, desligar ou mudar as lojas reinicia na hora (desligar
 * interrompe as coletas em andamento); modo, segundos, busca ao vivo e fichas valem sem reiniciar (o
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
  ensureTerms(getDb(), allSearchTerms(), 'seed');
  const first = Date.now() + FIRST_MS;
  for (const s of STORES) nextAt.set(s, first);
  timer = setInterval(() => void tick(), CHECK_MS);
}

export function stopRoutine(): void {
  clearInterval(timer);
  lastJob.clear(); // ao religar, o rodízio recomeça pela varredura
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

/** Intervalo do modo: os segundos do modo mais até 20% aleatório (ms). */
export const modeDelay = (gapS: number, rand = Math.random()) => Math.round(gapS * 1000 * (1 + rand / 5));

/** Categorias que a rotina varre numa loja (adapter que sabe e caminhos de varredura na configuração). */
export const sweepCategories = (store: StoreId): CategoryId[] =>
  canSweep(store) ? ENABLED_CATEGORIES.filter((c) => storeConfig(store).sweep[c]) : [];

/**
 * O que a rotina faz em cada vez, em rodízio: uma página da varredura, um termo, uma ficha técnica.
 * Começa pelo seguinte ao da vez anterior e pula o que não tem nada a fazer (ou está sem orçamento
 * na hora). Assim cada um fica com no máximo um terço das vezes quando há de tudo, e os termos
 * nunca ficam parados atrás da varredura ou das fichas.
 */
type Job = 'sweep' | 'term' | 'sheet';
const JOBS: Job[] = ['sweep', 'term', 'sheet'];
const lastJob = new Map<StoreId, Job>();

/** Fichas lidas pela rotina por loja na última hora (orçamento próprio: as fichas por hora do admin). */
const sheetLog = new Map<StoreId, number[]>();
const sheetsLastHour = (store: StoreId) => {
  const log = (sheetLog.get(store) ?? []).filter((t) => Date.now() - t < 3_600_000);
  sheetLog.set(store, log);
  return log.length;
};

/**
 * Uma ficha técnica do catálogo (placa de vídeo, gabinete, cooler) que ainda não foi lida, se a
 * loja sabe ler e sobra orçamento na hora. Devolve se foi à loja.
 */
async function sheetOne(store: StoreId, signal: AbortSignal): Promise<boolean> {
  if (!settings.sheets.enabled || !canReadSheet(store) || sheetsLastHour(store) >= settings.sheets.perHour) return false;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const [next] = nextSheets(getDb(), store, iso(now - SHEET_SCOPE_DAYS * 86_400_000), iso(now - config.SHEET_MAX_AGE_DAYS * 86_400_000));
  if (!next) return false;
  sheetLog.get(store)!.push(now);
  try {
    const sheet = await sheetOf(store, next.sku, next.category, signal, { origin: 'routine' });
    registerSuccess(store);
    console.info(`[ficha ${store}] ${next.category} ${next.sku}: ${sheet && (Object.keys(sheet.specs).length || sheet.mpn) ? 'lida' : 'página sem ficha'}`);
  } catch (err) {
    if (!signal.aborted && !(err instanceof BlockedError) && !(err instanceof PageLimitError)) console.error(`[ficha ${store}] ${next.category} ${next.sku}:`, err);
  }
  return true;
}

/** Páginas de varredura por loja na última hora (orçamento próprio, dentro do da rotina). */
const sweepLog = new Map<StoreId, number[]>();
const sweepPagesLastHour = (store: StoreId) => {
  const log = (sweepLog.get(store) ?? []).filter((t) => Date.now() - t < 3_600_000);
  sweepLog.set(store, log);
  return log.length;
};

/**
 * Uma página da varredura, se a loja varre, há categoria na hora e sobra orçamento na hora
 * (ROUTINE_SWEEP_PAGES_PER_HOUR). Retoma de onde parou. Devolve se foi à loja.
 */
async function sweepOne(store: StoreId, signal: AbortSignal): Promise<boolean> {
  const cats = sweepCategories(store);
  if (!cats.length || sweepPagesLastHour(store) >= config.ROUTINE_SWEEP_PAGES_PER_HOUR) return false;
  const next = nextSweep(getDb(), store, cats, Date.now(), config.ROUTINE_SWEEP_REFRESH_H * 3_600_000, config.ROUTINE_RETRY_MIN * 60_000);
  if (!next) return false;
  sweepLog.get(store)!.push(Date.now());
  try {
    const n = await collectSweepPage(store, next.category, next.page, signal);
    registerSuccess(store);
    console.info(`[varredura ${store}] ${next.category} pág ${next.page}: ${n} ofertas`);
  } catch (err) {
    if (!signal.aborted && !(err instanceof BlockedError) && !(err instanceof PageLimitError)) console.error(`[varredura ${store}] ${next.category} pág ${next.page}:`, err);
  }
  return true;
}

/** Um termo devido da loja (o mais atrasado, com as categorias espalhadas). Devolve se foi à loja. */
async function termOne(store: StoreId, signal: AbortSignal): Promise<boolean> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const due = dueTerms(
    getDb(),
    store,
    iso(now - config.ROUTINE_REFRESH_H * 3_600_000),
    iso(now - config.ROUTINE_RETRY_MIN * 60_000),
    1,
    iso(now - config.ROUTINE_TEXT_DAYS * 86_400_000),
  );
  if (!due.length) return false;
  await collectOne(store, due[0]!, signal);
  return true;
}

/**
 * A vez de uma loja: uma coisa só (página da varredura, termo ou ficha técnica, em rodízio) e marca
 * a próxima vez para o intervalo do modo depois que ela terminar. Varredura e fichas só no modo
 * normal: no reduzido e no lento, cada vez vai para um termo.
 */
async function turn(store: StoreId, signal: AbortSignal): Promise<void> {
  const gap = modeDelay(settings.seconds[settings.modes[store]]);
  if (backoffInfo(store) || pageLimitUntil(store) || !hasBudget(store)) {
    nextAt.set(store, Date.now() + IDLE_MS);
    return;
  }
  const jobs: Job[] = settings.modes[store] === 'normal' ? JOBS : ['term'];
  const start = (jobs.indexOf(lastJob.get(store) ?? 'sheet') + 1) % jobs.length;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[(start + i) % jobs.length]!;
    const did = job === 'sweep' ? await sweepOne(store, signal) : job === 'term' ? await termOne(store, signal) : await sheetOne(store, signal);
    if (did) {
      lastJob.set(store, job);
      nextAt.set(store, Date.now() + gap);
      return;
    }
  }
  nextAt.set(store, Date.now() + IDLE_MS); // nada a fazer: confere de novo depois
}

async function collectOne(store: StoreId, t: ReturnType<typeof dueTerms>[number], signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try {
    const offers = await collectTerm(store, t, signal, { origin: 'routine' });
    registerSuccess(store);
    console.info(`[rotina ${store}] ${t.category} "${t.term}": ${offers.length} ofertas`);
  } catch (err) {
    if (signal.aborted || err instanceof BlockedError || err instanceof PageLimitError) return; // a loja descansa; volta depois da pausa
    if (err instanceof SearchRedirectError) {
      console.info(`[rotina ${store}] ${t.category} "${t.term}": a busca redireciona para ${err.to}; na próxima vez vai direto lá`);
      return;
    }
    console.error(`[rotina ${store}] ${t.category} "${t.term}":`, err);
  }
}
