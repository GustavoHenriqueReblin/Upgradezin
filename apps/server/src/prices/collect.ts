import { parseSpecSheet, type AttemptKind, type AttemptOrigin, type CategoryId, type Offer, type SpecSheet, type StoreId } from '@upgradezin/shared';
import { s1 } from '../adapters/s1.ts';
import { s2 } from '../adapters/s2.ts';
import { s3 } from '../adapters/s3.ts';
import type { SearchContext, StoreAdapter } from '../adapters/types.ts';
import { lastPageHtml, saveDebugHtml } from '../browser.ts';
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
  // Busca do site (e admin) passa na frente da rotina na fila da loja. Quem busca só reaproveita
  // uma consulta igual se ela também for prioritária (a da rotina pode estar no fim da fila).
  const priority = hooks.origin !== 'routine';
  const key = `${store}|${t.id}|${priority ? 'p' : 'r'}`;
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
        // Busca do site: só as primeiras páginas (a pessoa não espera o intervalo entre páginas);
        // as seguintes ficam para a rotina e a varredura, e a busca mostra o que o banco já tem.
        maxPages: base.origin === 'search' ? config.SEARCH_MAX_PAGES : undefined,
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
  }, { priority });
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
 * Ficha técnica de um produto: do banco, se já lida (vazia: só se lida há menos de
 * SHEET_MAX_AGE_DAYS); senão abre a página (na fila da loja, com o intervalo de sempre) e guarda,
 * inclusive quando não há ficha. A montagem pede com prioridade; a rotina, na vez dela.
 */
export async function sheetOf(
  store: StoreId,
  sku: string,
  category: CategoryId,
  signal: AbortSignal,
  opts: { origin?: 'search' | 'routine' | 'admin'; force?: boolean } = {},
): Promise<SpecSheet | null> {
  const db = getDb();
  // force (admin, "Ler ficha"): abre a página mesmo com ficha guardada.
  const cached = opts.force ? undefined : getSheet(db, store, sku, new Date(Date.now() - config.SHEET_MAX_AGE_DAYS * 86_400_000).toISOString());
  if (cached) return cached;
  const adapter = ADAPTERS[store];
  if (!adapter.productSheet) return null;
  const origin = opts.origin ?? 'search';
  // Endereço do anúncio (a S2 abre a página pelo nome do produto, não pelo código).
  const url = (db.prepare('SELECT url FROM listings WHERE store = ? AND store_sku = ?').get(store, sku) as { url: string } | undefined)?.url;
  return withStore(store, signal, async () => {
    const t0 = Date.now();
    const base = { store, kind: 'sheet' as const, origin, category, term: sku };
    try {
      const html = await adapter.productSheet!({ sku, ...(url && { url }) }, signal);
      const sheet = html ? parseSpecSheet(category, html) : { specs: {} };
      saveSheet(db, store, sku, sheet);
      // Ficha sem nenhuma medida: guarda a página inteira para conferir se faltou no anúncio ou no leitor (só com DEBUG_DUMPS).
      if (!Object.keys(sheet.specs).length) await saveDebugHtml(store, lastPageHtml(store) ?? html ?? '', `ficha-${category}-${sku}`);
      logAttempt(base, t0, { count: html ? 1 : 0 });
      return sheet;
    } catch (err) {
      if (!didNotRun(err, signal)) logAttempt(base, t0, { count: 0, err });
      if (err instanceof BlockedError && !err.paused && !signal.aborted) registerBlock(store, err.reason);
      throw err;
    }
  }, { priority: origin !== 'routine' });
}

/** Primeira página da varredura, sem gravar (conferir o caminho: pnpm scan --sweep). */
export function previewSweep(store: StoreId, category: CategoryId, signal: AbortSignal) {
  const path = storeConfig(store).sweep[category];
  if (!ADAPTERS[store].sweepPage || !path) return Promise.resolve(null);
  return withStore(store, signal, () => ADAPTERS[store].sweepPage!({ category, url: storeConfig(store).url + path, page: 1, signal }), { priority: true });
}

/** Ofertas lidas antes de um bloqueio no meio da coleta. */
export const partialOf = (err: unknown): Offer[] => ((err as { partial?: Offer[] })?.partial ?? []);

/**
 * Quem está usando as lojas agora (buscas do site e rotina), para o status do admin.
 * O Chrome de cada loja fica aberto entre as consultas (fecha só quando o servidor para).
 */
let active = 0;
export const activeSessions = () => active;

export async function withBrowserSession<T>(fn: () => Promise<T>): Promise<T> {
  active++;
  try {
    return await fn();
  } finally {
    active--;
  }
}
