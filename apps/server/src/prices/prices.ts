import { effectiveCash, termMatches, type CategoryId, type ListingHistory, type Offer, type PricePoint, type SearchTerm, type StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { emitCollected } from './events.ts';

/**
 * Preços no banco (docs/ARCHITECTURE.md §8.3): a rotina e a busca gravam aqui o
 * resultado de cada termo em cada loja; o site lê daqui.
 */

const termKey = (t: SearchTerm) => `${t.category}|${t.term.toLowerCase()}`;

/**
 * Garante os termos no banco e devolve o id de cada um (chave "categoria|termo").
 * origin "user": alguém pesquisou agora (o termo passa a ter prioridade na rotina).
 * origin "text": texto livre pesquisado (ex. "Zotac RTX 3050 Twin Edge OC"); conta como pedido, mas um
 * termo que já existia não muda de origem, e a rotina só mantém um termo "text" enquanto alguém
 * pesquisa (ROUTINE_TEXT_DAYS), para a lista dela não crescer sem fim.
 */
export function ensureTerms(db: Db, terms: SearchTerm[], origin: 'seed' | 'user' | 'text', now = new Date().toISOString()): Map<string, number> {
  const ins = db.prepare(
    'INSERT INTO search_terms (category, term, origin, created_at, last_requested_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
  );
  const sel = db.prepare('SELECT id FROM search_terms WHERE category = ? AND lower(term) = lower(?)');
  const touch = db.prepare("UPDATE search_terms SET origin = 'user', last_requested_at = ? WHERE id = ?");
  const requested = db.prepare('UPDATE search_terms SET last_requested_at = ? WHERE id = ?');
  const ids = new Map<string, number>();
  db.exec('BEGIN');
  try {
    for (const t of terms) {
      ins.run(t.category, t.term, origin, now, origin === 'seed' ? null : now);
      const id = (sel.get(t.category, t.term) as { id: number }).id;
      if (origin === 'user') touch.run(now, id);
      else if (origin === 'text') requested.run(now, id);
      ids.set(termKey(t), id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ids;
}

export const idOf = (ids: Map<string, number>, t: SearchTerm) => ids.get(termKey(t))!;

interface LastPoint {
  price_cash: number;
  price_card: number | null;
  coupon: string | null;
  promo: string | null;
  in_stock: number;
}

/**
 * Grava a coleta de um termo numa loja. complete=false: a loja parou no meio (bloqueio,
 * limite); as ofertas lidas entram, mas o termo continua precisando de uma coleta completa.
 */
export function saveCollection(
  db: Db,
  run: { store: StoreId; category: CategoryId; termId: number; offers: Offer[]; at: string; complete: boolean },
): void {
  const { store, category, termId, offers, at, complete } = run;
  const findListing = db.prepare('SELECT id FROM listings WHERE store = ? AND store_sku = ?');
  const insListing = db.prepare(`
    INSERT INTO listings (store, store_sku, category, title, url, model_key, ean, mpn, offer, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updListing = db.prepare(`
    UPDATE listings SET category = ?, title = ?, url = ?, model_key = ?, ean = ?, mpn = ?, offer = ?, last_seen_at = ?
    WHERE id = ?`);
  const linkTerm = db.prepare(`
    INSERT INTO listing_terms (listing_id, term_id, last_seen_at) VALUES (?, ?, ?)
    ON CONFLICT (term_id, listing_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`);
  const lastPoint = db.prepare(
    'SELECT price_cash, price_card, coupon, promo, in_stock FROM price_points WHERE listing_id = ? ORDER BY at DESC LIMIT 1',
  );
  const insPoint = db.prepare(`
    INSERT OR REPLACE INTO price_points (listing_id, at, price_cash, price_card, effective_cash, coupon, promo, in_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  db.exec('BEGIN');
  try {
    for (const o of offers) {
      const json = JSON.stringify(o);
      let id = (findListing.get(store, o.storeSku) as { id: number } | undefined)?.id;
      if (id === undefined) {
        const r = insListing.run(store, o.storeSku, category, o.title, o.url, o.modelKey, o.ean ?? null, o.mpn ?? null, json, at, at);
        id = Number(r.lastInsertRowid);
      } else {
        updListing.run(category, o.title, o.url, o.modelKey, o.ean ?? null, o.mpn ?? null, json, at, id);
      }
      linkTerm.run(id, termId, at);

      const point: LastPoint = {
        price_cash: o.priceCash,
        price_card: o.priceCard ?? null,
        coupon: o.coupon ? JSON.stringify(o.coupon) : null,
        promo: o.promo ? JSON.stringify(o.promo) : null,
        in_stock: o.inStock ? 1 : 0,
      };
      const prev = lastPoint.get(id) as LastPoint | undefined;
      const changed =
        !prev ||
        prev.price_cash !== point.price_cash ||
        prev.price_card !== point.price_card ||
        prev.coupon !== point.coupon ||
        prev.promo !== point.promo ||
        prev.in_stock !== point.in_stock;
      if (changed) insPoint.run(id, at, point.price_cash, point.price_card, effectiveCash(o), point.coupon, point.promo, point.in_stock);
    }
    db.prepare(`
      INSERT INTO term_runs (term_id, store, last_try_at, last_ok_at, status, count) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (term_id, store) DO UPDATE SET
        last_try_at = excluded.last_try_at,
        last_ok_at = coalesce(excluded.last_ok_at, term_runs.last_ok_at),
        status = excluded.status,
        count = CASE WHEN excluded.last_ok_at IS NULL THEN term_runs.count ELSE excluded.count END`).run(
      termId, store, at, complete ? at : null, complete ? 'ok' : 'partial', offers.length,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // Telas abertas com essa categoria recebem a lista nova da loja (GET /api/watch).
  if (offers.length) emitCollected({ store, category, at });
}

/**
 * Tentativa sem resultado: registra para a rotina não insistir logo em seguida. "redirect": a busca
 * da loja leva o termo para outra página (ex. a da categoria), sem lista de produtos; guarda o
 * destino (`redirectPath`), que as próximas coletas desse termo nessa loja abrem direto.
 */
export function markFailedRun(db: Db, store: StoreId, termId: number, at: string, status: 'blocked' | 'error' | 'redirect', redirectPath?: string): void {
  db.prepare(`
    INSERT INTO term_runs (term_id, store, last_try_at, status, redirect_path) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (term_id, store) DO UPDATE SET last_try_at = excluded.last_try_at, status = excluded.status,
      redirect_path = coalesce(excluded.redirect_path, term_runs.redirect_path)`).run(termId, store, at, status, redirectPath ?? null);
}

/** Destino para onde a busca da loja já redirecionou o termo (abrir direto no lugar da busca). */
export function redirectPathOf(db: Db, store: StoreId, termId: number): string | null {
  const r = db.prepare('SELECT redirect_path FROM term_runs WHERE term_id = ? AND store = ?').get(termId, store) as { redirect_path: string | null } | undefined;
  return r?.redirect_path ?? null;
}

export interface StoredResult {
  /** Fim da última coleta completa; sem ela, o termo ainda não tem resultado nesta loja. */
  at?: string;
  offers: Offer[];
}

/** Resultado de um termo numa loja: os anúncios vistos desde a última coleta completa. */
export function readResult(db: Db, store: StoreId, termId: number): StoredResult {
  const run = db.prepare('SELECT last_ok_at FROM term_runs WHERE term_id = ? AND store = ?').get(termId, store) as
    | { last_ok_at: string | null }
    | undefined;
  if (!run?.last_ok_at) return { offers: [] };
  const rows = db
    .prepare(`
      SELECT l.offer FROM listing_terms lt JOIN listings l ON l.id = lt.listing_id
      WHERE lt.term_id = ? AND l.store = ? AND lt.last_seen_at >= ?`)
    .all(termId, store, run.last_ok_at) as { offer: string }[];
  return { at: run.last_ok_at, offers: rows.map((r) => JSON.parse(r.offer) as Offer) };
}

/**
 * Anúncios da loja na categoria, vistos desde `seenSince`, que batem com algum dos termos pelas
 * specs (termMatches), venham da coleta que vierem. Completa o resultado de um termo com o que
 * outras coletas já trouxeram.
 */
export function matchingListings(db: Db, store: StoreId, category: CategoryId, terms: string[], seenSince: string): Offer[] {
  const rows = db
    .prepare('SELECT offer FROM listings WHERE store = ? AND category = ? AND last_seen_at >= ?')
    .all(store, category, seenSince) as { offer: string }[];
  const out: Offer[] = [];
  for (const r of rows) {
    const o = JSON.parse(r.offer) as Offer;
    if (terms.some((t) => termMatches(category, t, o.specs))) out.push(o);
  }
  return out;
}

/** Marcas (já normalizadas na coleta) dos anúncios da categoria vistos desde `seenSince`, sem "Outros"/"Genérica". */
export function listingBrands(db: Db, category: CategoryId, seenSince: string): string[] {
  const rows = db
    .prepare(`
      SELECT json_extract(offer, '$.brand') AS brand FROM listings
      WHERE category = ? AND last_seen_at >= ? AND json_extract(offer, '$.brand') IS NOT NULL
      GROUP BY brand`)
    .all(category, seenSince) as { brand: string }[];
  return rows
    .map((r) => r.brand)
    .filter((b) => b && !['Outros', 'Genérica'].includes(b))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

export interface DueTerm extends SearchTerm {
  id: number;
}

/**
 * Termos que a rotina deve coletar numa loja, espalhando a coleta pelas categorias em vez de ir
 * termo a termo. Primeiro o que alguém pesquisou e não foi coletado depois disso, o pedido mais
 * recente antes; depois a categoria há mais tempo sem coleta nessa loja (nunca coletada antes);
 * dentro dela, o termo nunca coletado, depois o mais antigo. Como a busca junta os anúncios
 * pelas specs, uma coleta já serve a todos os termos da categoria que batem com ela.
 * Fica de fora o que foi coletado depois de `okBefore` ou tentado (e falhou) depois de
 * `tryBefore` e o texto livre que ninguém pesquisa desde `textSince`. Termo que a loja acabou de
 * redirecionar não espera `tryBefore`: a próxima vez já abre o destino direto.
 */
export function dueTerms(db: Db, store: StoreId, okBefore: string, tryBefore: string, limit: number, textSince = ''): DueTerm[] {
  return db
    .prepare(`
      WITH cat AS (
        SELECT st.category, max(tr.last_ok_at) AS last FROM search_terms st
        LEFT JOIN term_runs tr ON tr.term_id = st.id AND tr.store = ?
        WHERE st.origin != 'sweep' GROUP BY st.category
      )
      SELECT st.id, st.category, st.term FROM search_terms st
      JOIN cat ON cat.category = st.category
      LEFT JOIN term_runs tr ON tr.term_id = st.id AND tr.store = ?
      WHERE st.origin != 'sweep' AND (st.origin != 'text' OR st.last_requested_at >= ?)
        AND (tr.last_ok_at IS NULL OR tr.last_ok_at < ?) AND (tr.last_try_at IS NULL OR tr.last_try_at < ? OR tr.status = 'redirect')
      ORDER BY (st.last_requested_at IS NOT NULL AND (tr.last_ok_at IS NULL OR st.last_requested_at > tr.last_ok_at)) DESC,
        -- Entre os pesquisados, o pedido mais recente primeiro: é quem está com a tela aberta esperando
        -- (nos logs, 44 pedidos acumulados no dia deixavam o de agora horas atrás de um cooler pedido de manhã).
        CASE WHEN tr.last_ok_at IS NULL OR st.last_requested_at > tr.last_ok_at THEN st.last_requested_at END DESC,
        cat.last IS NOT NULL, cat.last, tr.last_ok_at IS NOT NULL, tr.last_ok_at, st.id
      LIMIT ?`)
    .all(store, store, textSince, okBefore, tryBefore, limit) as unknown as DueTerm[];
}

/** Histórico de preço de um anúncio (um ponto a cada mudança). */
export function priceHistory(db: Db, store: StoreId, sku: string): PricePoint[] {
  const rows = db
    .prepare(`
      SELECT p.at, p.price_cash, p.price_card, p.effective_cash, p.in_stock FROM price_points p
      JOIN listings l ON l.id = p.listing_id WHERE l.store = ? AND l.store_sku = ? ORDER BY p.at`)
    .all(store, sku) as { at: string; price_cash: number; price_card: number | null; effective_cash: number; in_stock: number }[];
  return rows.map((r) => ({
    at: r.at,
    priceCash: r.price_cash,
    ...(r.price_card !== null ? { priceCard: r.price_card } : {}),
    effectiveCash: r.effective_cash,
    inStock: !!r.in_stock,
  }));
}

/** Histórico de vários anúncios (as ofertas de um produto nas lojas), com a última vez que cada um apareceu. */
export function listingsHistory(db: Db, items: { store: StoreId; sku: string }[]): ListingHistory[] {
  const seen = db.prepare('SELECT last_seen_at FROM listings WHERE store = ? AND store_sku = ?');
  return items.map(({ store, sku }) => ({
    store,
    sku,
    points: priceHistory(db, store, sku),
    lastSeenAt: (seen.get(store, sku) as { last_seen_at: string } | undefined)?.last_seen_at,
  }));
}

const DAY = 86_400_000;

/**
 * Acrescenta a cada oferta o resumo do histórico (`history`): menor preço à vista com cupom,
 * com estoque, nos últimos 30 dias (inclui o preço que já valia quando a janela começou e o
 * atual), e desde quando o anúncio é acompanhado. Sem histórico, a oferta fica como está.
 */
export function withHistoryStats(db: Db, offers: Offer[], now = Date.now()): Offer[] {
  const from = new Date(now - 30 * DAY).toISOString();
  const listing = db.prepare('SELECT id FROM listings WHERE store = ? AND store_sku = ?');
  const since = db.prepare('SELECT min(at) AS v FROM price_points WHERE listing_id = ?');
  const minIn = db.prepare('SELECT min(effective_cash) AS v FROM price_points WHERE listing_id = ? AND at >= ? AND in_stock = 1');
  const carried = db.prepare('SELECT effective_cash AS v, in_stock FROM price_points WHERE listing_id = ? AND at < ? ORDER BY at DESC LIMIT 1');
  return offers.map((o) => {
    const id = (listing.get(o.store, o.storeSku) as { id: number } | undefined)?.id;
    if (id === undefined) return o;
    const first = (since.get(id) as { v: string | null }).v;
    if (!first) return o;
    const before = carried.get(id, from) as { v: number; in_stock: number } | undefined;
    const values = [(minIn.get(id, from) as { v: number | null }).v, before?.in_stock ? before.v : null, o.inStock ? effectiveCash(o) : null];
    const nums = values.filter((v): v is number => typeof v === 'number');
    return nums.length ? { ...o, history: { min30: Math.min(...nums), since: first } } : o;
  });
}
