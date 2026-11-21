import { parseSpecSheet, type AttemptKind, type AttemptOrigin, type CategoryId, type Offer, type SpecSheet, type StoreId } from '@upgradezin/shared';
import { s1 } from '../adapters/s1.ts';
import { s2 } from '../adapters/s2.ts';
import { s3 } from '../adapters/s3.ts';
import type { SearchContext, StoreAdapter } from '../adapters/types.ts';
import { closeBrowser } from '../browser.ts';
import { config } from '../config.ts';
import { getDb } from '../db/instance.ts';
import { BlockedError, PageLimitError, registerBlock, SearchRedirectError, withStore } from '../pace.ts';
import { storeConfig } from '../stores.ts';
import { recordAttempt, type NewAttempt } from './attempts.ts';
import { markFailedRun, redirectPathOf, saveCollection, type DueTerm } from './prices.ts';
import { getSheet, saveSheet } from './sheets.ts';
import { recordSweepFailure, recordSweepPage } from './sweep.ts';

const ADAPTERS: Record<StoreId, StoreAdapter> = { s1, s2, s3 };

/** Coletas em andamento por (loja, termo): a busca do site e a rotina não repetem a mesma. */
const inflight = new Map<string, Promise<Offer[]>>();

export interface CollectHooks {
  onPage?: SearchContext['onPage'];
  onNeedsHuman?: () => void;
  /** De onde veio a consulta (vai para o registro de consultas do admin). Padrão: busca do site. */
  origin?: AttemptOrigin;
}

/**
 * Registra a consulta que foi à loja (não as que nem saíram: loja em pausa, cancelada).
 * Falha ao gravar o registro nunca derruba a coleta.
 */
function logAttempt(base: { store: StoreId; kind: AttemptKind; origin: AttemptOrigin; category?: CategoryId; term?: string; page?: number }, t0: number, outcome: { count: number; err?: unknown }) {
  try {
    recordAttempt(getDb(), { ...base, at: new Date().toISOString(), count: outcome.count, ms: Date.now() - t0, ...attemptOutcome(outcome.err, outcome.count) });
  } catch (e) {
    console.error('registro de consulta:', e);
  }
}

/**
 * Como a consulta terminou: sem erro, ok; bloqueio ou limite depois de ler algo, parcial;
 * senão o tipo do erro, com o motivo do bloqueio e a mensagem.
 */
export function attemptOutcome(err: unknown, count: number): Pick<NewAttempt, 'status' | 'reason' | 'detail'> {
  if (!err) return { status: 'ok' };
  const kind = err instanceof BlockedError ? 'blocked' : err instanceof PageLimitError ? 'limit' : 'error';
  return {
    status: count && kind !== 'error' ? 'partial' : kind,
    ...(err instanceof BlockedError ? { reason: err.reason } : {}),
    detail: err instanceof Error ? err.message : String(err),
  };
}

/** A consulta nem foi à loja (pausa, cancelada): não entra no registro. */
const didNotRun = (err: unknown, signal: AbortSignal) => signal.aborted || (err instanceof BlockedError && err.paused);

/**
 * Consulta um termo numa loja e grava no banco. Bloqueio ou limite no meio: grava o que
 * leu (incompleto), registra o bloqueio e repassa o erro para quem chamou.
 */
export function collectTerm(store: StoreId, t: DueTerm, signal: AbortSignal, hooks: CollectHooks = {}): Promise<Offer[]> {
  const key = `${store}|${t.id}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = withStore(store, signal, async () => {
    const pages: Offer[] = [];
    const t0 = Date.now();
    const base = { store, kind: 'term' as const, origin: hooks.origin ?? 'search', category: t.category, term: t.term };
    try {
      const offers = await ADAPTERS[store].search({
        category: t.category,
        q: t.term,
        // Termo que a busca dessa loja já redirecionou: vai direto ao destino.
        path: redirectPathOf(getDb(), store, t.id) ?? undefined,
        signal,
        onPage: (info) => {
          pages.push(...info.offers);
          hooks.onPage?.(info);
        },
        onNeedsHuman: hooks.onNeedsHuman,
      });
      saveCollection(getDb(), { store, category: t.category, termId: t.id, offers, at: new Date().toISOString(), complete: true });
      logAttempt(base, t0, { count: offers.length });
      return offers;
    } catch (err) {
      if (!didNotRun(err, signal)) logAttempt(base, t0, { count: pages.length, err });
      // Loja já em pausa: a consulta nem saiu (nada a gravar, nenhum bloqueio novo).
      if (signal.aborted || (err instanceof BlockedError && err.paused)) throw err;
      const at = new Date().toISOString();
      const blocked = err instanceof BlockedError || err instanceof PageLimitError;
      if (pages.length) saveCollection(getDb(), { store, category: t.category, termId: t.id, offers: pages, at, complete: false });
      else if (err instanceof SearchRedirectError) markFailedRun(getDb(), store, t.id, at, 'redirect', err.to);
      else markFailedRun(getDb(), store, t.id, at, blocked ? 'blocked' : 'error');
      if (err instanceof BlockedError) {
        console.warn(`[${store}] bloqueio (${err.reason}): ${err.message}`);
        registerBlock(store, err.reason);
      }
      throw Object.assign(err as object, { partial: pages });
    }
  });
  inflight.set(key, job);
  job.finally(() => inflight.delete(key)).catch(() => {});
  return job;
}

/** A loja sabe ler a página de uma categoria inteira (varredura da rotina). */
export const canSweep = (store: StoreId) => !!ADAPTERS[store].sweepPage;

/**
 * Lê uma página da varredura de uma categoria e grava, na mesma fila da loja (uma consulta por
 * vez, com intervalo). Bloqueio pausa a loja; outro erro faz a categoria esperar e retomar
 * da mesma página. Devolve quantas ofertas leu.
 */
export function collectSweepPage(
  store: StoreId,
  category: CategoryId,
  page: number,
  signal: AbortSignal,
  maxPages = config.ROUTINE_SWEEP_MAX_PAGES,
): Promise<number> {
  const adapter = ADAPTERS[store];
  const path = storeConfig(store).sweep[category];
  if (!adapter.sweepPage || !path) return Promise.reject(new Error(`${store}: sem varredura de ${category}`));
  return withStore(store, signal, async () => {
    const t0 = Date.now();
    const base = { store, kind: 'sweep' as const, origin: 'routine' as const, category, page };
    try {
      const r = await adapter.sweepPage!({ category, url: storeConfig(store).url + path, page, signal });
      recordSweepPage(getDb(), { store, category, page, totalPages: r.totalPages, maxPages, offers: r.offers, at: new Date().toISOString() });
      logAttempt(base, t0, { count: r.offers.length });
      return r.offers.length;
    } catch (err) {
      if (!didNotRun(err, signal)) logAttempt(base, t0, { count: 0, err });
      if (signal.aborted || err instanceof PageLimitError || (err instanceof BlockedError && err.paused)) throw err;
      if (err instanceof BlockedError) {
        console.warn(`[${store}] bloqueio (${err.reason}): ${err.message}`);
        registerBlock(store, err.reason);
      } else recordSweepFailure(getDb(), store, category, new Date().toISOString());
      throw err;
    }
  });
}

/** A loja sabe ler a ficha técnica da página do produto. */
export const canReadSheet = (store: StoreId) => !!ADAPTERS[store].productSheet;

/**
 * Ficha técnica de um produto: do banco, se lida há menos de SHEET_MAX_AGE_DAYS; senão abre a
 * página (na fila da loja, com o intervalo de sempre) e guarda, inclusive quando não há ficha.
 */
export async function sheetOf(store: StoreId, sku: string, category: CategoryId, signal: AbortSignal): Promise<SpecSheet | null> {
  const db = getDb();
  const cached = getSheet(db, store, sku, new Date(Date.now() - config.SHEET_MAX_AGE_DAYS * 86_400_000).toISOString());
  if (cached) return cached;
  const adapter = ADAPTERS[store];
  if (!adapter.productSheet) return null;
  return withStore(store, signal, async () => {
    const t0 = Date.now();
    const base = { store, kind: 'sheet' as const, origin: 'search' as const, category, term: sku };
    try {
      const html = await adapter.productSheet!(sku, signal);
      const sheet = html ? parseSpecSheet(category, html) : { specs: {} };
      saveSheet(db, store, sku, sheet);
      logAttempt(base, t0, { count: html ? 1 : 0 });
      return sheet;
    } catch (err) {
      if (!didNotRun(err, signal)) logAttempt(base, t0, { count: 0, err });
      if (err instanceof BlockedError && !err.paused && !signal.aborted) registerBlock(store, err.reason);
      throw err;
    }
  });
}

/** Primeira página da varredura, sem gravar (conferir o caminho: pnpm scan --sweep). */
export function previewSweep(store: StoreId, category: CategoryId, signal: AbortSignal) {
  const path = storeConfig(store).sweep[category];
  if (!ADAPTERS[store].sweepPage || !path) return Promise.resolve(null);
  return withStore(store, signal, () => ADAPTERS[store].sweepPage!({ category, url: storeConfig(store).url + path, page: 1, signal }));
}

/** Ofertas lidas antes de um bloqueio no meio da coleta. */
export const partialOf = (err: unknown): Offer[] => ((err as { partial?: Offer[] })?.partial ?? []);

/** Quem está usando as lojas agora (buscas do site e rotina); o Chrome fecha quando o último sai. */
let active = 0;
export const activeSessions = () => active;

export async function withBrowserSession<T>(fn: () => Promise<T>): Promise<T> {
  active++;
  try {
    return await fn();
  } finally {
    // Sessão anônima: fechar descarta abas, cookies e cache.
    if (--active === 0) await closeBrowser();
  }
}
