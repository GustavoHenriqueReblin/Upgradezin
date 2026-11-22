import { sheetText, type AttemptKind, type AttemptOrigin, type CategoryId, type Offer, type SheetValues, type StoreId } from '@upgradezin/shared';
import { s1 } from '../adapters/s1.ts';
import { s2 } from '../adapters/s2.ts';
import { s3 } from '../adapters/s3.ts';
import type { SearchContext, StoreAdapter } from '../adapters/types.ts';
import { lastPageHtml, saveDebugHtml } from '../browser.ts';
import { config } from '../config.ts';
import { getDb } from '../db/instance.ts';
import { BlockedError, PageLimitError, registerBlock, withStore } from '../pace.ts';
import { storeConfig, sweepPaths } from '../stores.ts';
import { recordAttempt, type NewAttempt } from './attempts.ts';
import { saveCollection } from './prices.ts';
import { savePage } from './sheets.ts';
import { recordSweepFailure, recordSweepPage } from './sweep.ts';

const ADAPTERS: Record<StoreId, StoreAdapter> = { s1, s2, s3 };

/** Buscas por texto em andamento por (loja, categoria, texto): duas pessoas buscando o mesmo não repetem a consulta. */
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
 * Busca um texto numa loja ("Não achou? Buscar nas lojas") e grava no banco o que vier. Na fila da
 * loja, na frente da rotina. Bloqueio ou limite no meio: grava o que leu, registra o bloqueio e
 * repassa o erro (com as ofertas lidas em `partial`). Texto que a loja redireciona para a página de
 * uma categoria: SearchRedirectError (o que essa página tem, a rotina já lê).
 */
export function collectText(store: StoreId, category: CategoryId, text: string, signal: AbortSignal, hooks: CollectHooks = {}): Promise<Offer[]> {
  const key = `${store}|${category}|${text.toLowerCase()}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = withStore(store, signal, async () => {
    const pages: Offer[] = [];
    const t0 = Date.now();
    const base = { store, kind: 'term' as const, origin: hooks.origin ?? 'search', category, term: text };
    try {
      const offers = await ADAPTERS[store].search({
        category,
        q: text,
        signal,
        // Quem busca não espera o intervalo entre páginas: só as primeiras.
        maxPages: config.SEARCH_MAX_PAGES,
        onPage: (info) => {
          pages.push(...info.offers);
          hooks.onPage?.(info);
        },
        onNeedsHuman: hooks.onNeedsHuman,
      });
      saveCollection(getDb(), { store, category, offers, at: new Date().toISOString() });
      logAttempt(base, t0, { count: offers.length });
      return offers;
    } catch (err) {
      if (!didNotRun(err, signal)) logAttempt(base, t0, { count: pages.length, err });
      // Loja já em pausa: a consulta nem saiu (nada a gravar, nenhum bloqueio novo).
      if (signal.aborted || (err instanceof BlockedError && err.paused)) throw err;
      if (pages.length) saveCollection(getDb(), { store, category, offers: pages, at: new Date().toISOString() });
      if (err instanceof BlockedError) {
        console.warn(`[${store}] bloqueio (${err.reason}): ${err.message}`);
        registerBlock(store, err.reason);
      }
      throw Object.assign(err as object, { partial: pages });
    }
  }, { priority: true });
  inflight.set(key, job);
  job.finally(() => inflight.delete(key)).catch(() => {});
  return job;
}

/** A loja sabe ler a página de uma categoria (rotina de preços). */
export const canSweep = (store: StoreId) => !!ADAPTERS[store].sweepPage;

export interface SweepPageResult {
  /** Ofertas lidas e gravadas (as esgotadas só entram se o anúncio já existia). */
  read: number;
  saved: number;
  listEnded: boolean;
  roundDone: boolean;
  outOfStock: number;
}

/**
 * Lê uma página de categoria e grava, na mesma fila da loja (uma consulta por vez, com intervalo).
 * `path`: qual dos caminhos da categoria na loja. Bloqueio pausa a loja; outro erro faz a categoria
 * esperar e retomar da mesma página. `origin` "admin" ("varrer agora") passa na frente da rotina.
 */
export function collectSweepPage(
  store: StoreId,
  category: CategoryId,
  path: number,
  page: number,
  signal: AbortSignal,
  opts: { origin?: 'routine' | 'admin'; maxPages?: number; delayMs?: [number, number] } = {},
): Promise<SweepPageResult> {
  const adapter = ADAPTERS[store];
  const paths = sweepPaths(store, category);
  const origin = opts.origin ?? 'routine';
  if (!adapter.sweepPage || !paths[path]) return Promise.reject(new Error(`${store}: sem página de ${category}`));
  return withStore(store, signal, async () => {
    const t0 = Date.now();
    const base = { store, kind: 'sweep' as const, origin, category, page, term: paths.length > 1 ? paths[path] : undefined };
    try {
      const r = await adapter.sweepPage!({ category, url: storeConfig(store).url + paths[path], page, signal });
      const done = recordSweepPage(getDb(), {
        store,
        category,
        path,
        paths: paths.length,
        page,
        totalPages: r.totalPages,
        maxPages: opts.maxPages ?? config.ROUTINE_SWEEP_MAX_PAGES,
        inStock: r.inStock,
        offers: r.offers,
        at: new Date().toISOString(),
      });
      logAttempt(base, t0, { count: r.offers.length });
      return { read: r.offers.length, ...done };
    } catch (err) {
      if (!didNotRun(err, signal)) logAttempt(base, t0, { count: 0, err });
      if (signal.aborted || err instanceof PageLimitError || (err instanceof BlockedError && err.paused)) throw err;
      if (err instanceof BlockedError) {
        console.warn(`[${store}] bloqueio (${err.reason}): ${err.message}`);
        registerBlock(store, err.reason);
      } else recordSweepFailure(getDb(), store, category, new Date().toISOString());
      throw err;
    }
  }, opts.delayMs ? { delayMs: opts.delayMs } : {});
}

/** A loja sabe ler a ficha técnica da página do produto. */
export const canReadSheet = (store: StoreId) => !!ADAPTERS[store].productSheet;

/**
 * Lê a ficha técnica de um anúncio: abre a página do produto (na fila da loja, com o intervalo de
 * sempre), guarda o texto da ficha e os campos lidos (prices/sheets.ts), inclusive quando a página
 * não tem ficha. Devolve os campos. A rotina pede na vez dela; o admin ("Ler ficha"), na frente.
 */
export async function sheetOf(
  store: StoreId,
  sku: string,
  category: CategoryId,
  signal: AbortSignal,
  opts: { origin?: 'routine' | 'admin' } = {},
): Promise<{ values: SheetValues; hasSheet: boolean } | null> {
  const adapter = ADAPTERS[store];
  if (!adapter.productSheet) return null;
  const db = getDb();
  const origin = opts.origin ?? 'routine';
  // Endereço do anúncio (a S2 abre a página pelo nome do produto, não pelo código).
  const url = (db.prepare('SELECT url FROM listings WHERE store = ? AND store_sku = ?').get(store, sku) as { url: string } | undefined)?.url;
  return withStore(store, signal, async () => {
    const t0 = Date.now();
    const base = { store, kind: 'sheet' as const, origin, category, term: sku };
    try {
      const html = await adapter.productSheet!({ sku, ...(url && { url }) }, signal);
      const text = html ? sheetText(html) : '';
      const values = savePage(db, { store, sku, category, text: text || null });
      // Página sem ficha: guarda a página inteira para conferir se faltou no anúncio ou no leitor (só com DEBUG_DUMPS).
      if (!text) await saveDebugHtml(store, lastPageHtml(store) ?? html ?? '', `ficha-${category}-${sku}`);
      logAttempt(base, t0, { count: text ? 1 : 0 });
      return { values, hasSheet: !!text };
    } catch (err) {
      if (!didNotRun(err, signal)) logAttempt(base, t0, { count: 0, err });
      if (err instanceof BlockedError && !err.paused && !signal.aborted) registerBlock(store, err.reason);
      throw err;
    }
  }, { priority: origin !== 'routine' });
}

/** Primeira página de categoria, sem gravar (conferir o caminho: pnpm scan --sweep). */
export function previewSweep(store: StoreId, category: CategoryId, signal: AbortSignal, path = 0) {
  const paths = sweepPaths(store, category);
  if (!ADAPTERS[store].sweepPage || !paths[path]) return Promise.resolve(null);
  return withStore(store, signal, () => ADAPTERS[store].sweepPage!({ category, url: storeConfig(store).url + paths[path], page: 1, signal }), { priority: true });
}

/** Ofertas lidas antes de um bloqueio no meio da coleta. */
export const partialOf = (err: unknown): Offer[] => ((err as { partial?: Offer[] })?.partial ?? []);

/**
 * Quem está usando as lojas agora (busca por texto, rotina, admin), para o status do admin.
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
