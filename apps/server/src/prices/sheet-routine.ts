import { SHEET_SECONDS_MAX, SHEET_SECONDS_MIN, STORES, type SheetRoutineInput, type SheetRoutineSettings, type StoreId } from '@upgradezin/shared';
import { config } from '../config.ts';
import { getDb } from '../db/instance.ts';
import { backoffInfo, BlockedError, PageLimitError, pageLimitUntil, pagesUsed, registerSuccess } from '../pace.ts';
import { ACTIVE_STORES } from '../stores.ts';
import { canReadSheet, sheetOf, withBrowserSession } from './collect.ts';
import { nextSheets, SHEET_SCOPE_DAYS } from './sheets.ts';

/**
 * Rotina de fichas técnicas, separada da rotina de coleta: chave, lojas e intervalo próprios (admin,
 * aba Fichas). Em cada loja, abre a página de um produto do catálogo (todas as categorias) cuja
 * ficha ainda não está completa a cada `seconds` segundos (+ até 20% aleatório), contados do fim da
 * anterior. Cada página é lida uma vez: o texto fica guardado e é relido quando o leitor muda
 * (prices/sheets.ts). Ordem: o produto que a coleta achou há menos tempo, em estoque antes.
 *
 * Divide com o resto só o que é da loja: a fila (uma página por vez; o "Ler ficha" do admin passa
 * na frente), o intervalo entre páginas, o limite de páginas por hora e a pausa por bloqueio.
 */

/** De quanto em quanto tempo a agenda é conferida. */
const CHECK_MS = 2_000;
/** Primeira ficha depois de ligar. */
const FIRST_MS = 10_000;
/** Sem ficha para ler, loja em pausa ou sem páginas na hora: confere de novo depois disto. */
const IDLE_MS = 60_000;

let timer: NodeJS.Timeout | undefined;
let ac = new AbortController();
const nextAt = new Map<StoreId, number>();
const busy = new Set<StoreId>();

const validSeconds = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= SHEET_SECONDS_MIN && n <= SHEET_SECONDS_MAX;

/** Junta o enviado com o que já valia; o que falta ou é inválido fica como estava (ou o padrão). */
const sanitize = (s: SheetRoutineInput, base: SheetRoutineSettings): SheetRoutineSettings => ({
  enabled: typeof s.enabled === 'boolean' ? s.enabled : base.enabled,
  stores: Array.isArray(s.stores) ? STORES.filter((id) => s.stores!.includes(id)) : [...base.stores],
  seconds: validSeconds(s.seconds) ? s.seconds : base.seconds,
});

/** Antes do admin mudar: do .env (desligada por padrão, todas as lojas). */
const fromEnv = (): SheetRoutineSettings =>
  sanitize({ enabled: config.SHEET_ROUTINE_ENABLED, stores: [...STORES], seconds: config.SHEET_ROUTINE_SECONDS }, { enabled: false, stores: [...STORES], seconds: 180 });

let settings = fromEnv();
let persist: ((s: SheetRoutineSettings) => void) | undefined;

/** Passa a guardar a configuração (meta "sheet-routine"); `saved` vale no lugar do .env. */
export function useSheetRoutineStorage(saved: SheetRoutineInput | null, save: (s: SheetRoutineSettings) => void): void {
  settings = saved ? sanitize(saved, fromEnv()) : fromEnv();
  persist = save;
}

export const sheetRoutineSettings = (): SheetRoutineSettings => ({ ...settings, stores: [...settings.stores] });

/** Muda pelo admin e guarda. Ligar, desligar ou mudar as lojas reinicia; o intervalo vale a partir da próxima ficha. */
export function setSheetRoutine(next: SheetRoutineInput): SheetRoutineSettings {
  const prev = settings;
  settings = sanitize(next, settings);
  persist?.(settings);
  if (prev.enabled !== settings.enabled || prev.stores.join() !== settings.stores.join() || !timer) {
    stopSheetRoutine();
    startSheetRoutine();
  }
  return sheetRoutineSettings();
}

/** Lojas ligadas, marcadas na rotina de fichas e que sabem ler a ficha. */
const routineStores = (): StoreId[] => (settings.enabled ? ACTIVE_STORES.filter((s) => settings.stores.includes(s) && canReadSheet(s)) : []);

/** Próxima ficha da rotina na loja (ms), ou null se a rotina não está rodando nela. */
export function sheetNextAt(store: StoreId): number | null {
  if (!timer || !routineStores().includes(store)) return null;
  return nextAt.get(store) ?? null;
}

export const sheetRoutineBusy = () => busy.size > 0;

export function startSheetRoutine(): void {
  if (timer || !routineStores().length) return;
  if (ac.signal.aborted) ac = new AbortController();
  const first = Date.now() + FIRST_MS;
  for (const s of STORES) nextAt.set(s, first);
  timer = setInterval(() => void sheetTick(), CHECK_MS);
}

export function stopSheetRoutine(): void {
  clearInterval(timer);
  timer = undefined;
  nextAt.clear();
  ac.abort();
}

/** Intervalo: os segundos do admin mais até 20% aleatório (ms). */
export const sheetDelay = (seconds: number, rand = Math.random()) => Math.round(seconds * 1000 * (1 + rand / 5));

/** Confere a agenda: cada loja que chegou na hora e não está lendo lê uma ficha. */
export async function sheetTick(now = Date.now()): Promise<void> {
  const signal = ac.signal;
  const due = routineStores().filter((s) => !busy.has(s) && now >= (nextAt.get(s) ?? 0));
  await Promise.all(
    due.map(async (store) => {
      busy.add(store);
      try {
        await withBrowserSession(() => readOne(store, signal));
      } finally {
        busy.delete(store);
      }
    }),
  );
}

/** Uma ficha da loja; marca a próxima vez. */
async function readOne(store: StoreId, signal: AbortSignal): Promise<void> {
  if (backoffInfo(store) || pageLimitUntil(store) || pagesUsed(store) + 1 > config.ROUTINE_PAGES_PER_HOUR) {
    nextAt.set(store, Date.now() + IDLE_MS);
    return;
  }
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const [next] = nextSheets(getDb(), store, iso(now - SHEET_SCOPE_DAYS * 86_400_000));
  if (!next) {
    nextAt.set(store, Date.now() + IDLE_MS); // nada a ler: confere de novo depois (produto novo no catálogo)
    return;
  }
  try {
    const r = await sheetOf(store, next.sku, next.category, signal, { origin: 'routine' });
    registerSuccess(store);
    console.info(`[ficha ${store}] ${next.category} ${next.sku}: ${!r?.hasSheet ? 'página sem ficha' : `${Object.keys(r.values).length} campos`}`);
  } catch (err) {
    if (!signal.aborted && !(err instanceof BlockedError) && !(err instanceof PageLimitError)) console.error(`[ficha ${store}] ${next.category} ${next.sku}:`, err);
  }
  nextAt.set(store, Date.now() + sheetDelay(settings.seconds));
}
