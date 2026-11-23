import { effectiveCash, stripAccents, termMatches, type CategoryId, type ListingHistory, type Offer, type PricePoint, type StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { emitCollected } from './events.ts';
import { NOT_BROKEN } from './page-errors.ts';

/**
 * Preços no banco (docs/ARCHITECTURE.md §8.3): a rotina grava aqui cada página de categoria lida
 * nas lojas, e a busca por texto o que trouxer; o site lê daqui.
 */

interface LastPoint {
  price_cash: number;
  price_card: number | null;
  coupon: string | null;
  promo: string | null;
  in_stock: number;
}

/**
 * Grava ofertas lidas numa loja: o anúncio (a última oferta vista) e um ponto de histórico quando
 * preço, cupom, oferta ou estoque mudam.
 */
export function saveCollection(db: Db, run: { store: StoreId; category: CategoryId; offers: Offer[]; at: string }): void {
  const { store, category, offers, at } = run;
  const findListing = db.prepare('SELECT id FROM listings WHERE store = ? AND store_sku = ?');
  const insListing = db.prepare(`
    INSERT INTO listings (store, store_sku, category, title, url, model_key, ean, mpn, offer, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updListing = db.prepare(`
    UPDATE listings SET category = ?, title = ?, url = ?, model_key = ?, ean = ?, mpn = ?, offer = ?, last_seen_at = ?
    WHERE id = ?`);
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
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // Telas abertas com essa categoria recebem a lista nova da loja (GET /api/watch).
  if (offers.length) emitCollected({ store, category, at });
}

/** O anúncio já está no banco (a rotina só cria anúncio novo para o que está em estoque). */
export function hasListing(db: Db, store: StoreId, sku: string): boolean {
  return !!db.prepare('SELECT 1 FROM listings WHERE store = ? AND store_sku = ?').get(store, sku);
}

/**
 * Fim de uma volta completa pela categoria (até acabar o que está em estoque): o que estava em
 * estoque e não apareceu desde `seenBefore` saiu de estoque (ou da loja). A oferta guardada passa a
 * dizer "sem estoque", com um ponto de histórico. Se voltar, a próxima volta o encontra entre os em
 * estoque e grava de novo. Devolve quantos mudaram.
 */
export function markOutOfStock(db: Db, store: StoreId, category: CategoryId, seenBefore: string, at: string): number {
  const rows = db
    .prepare(`SELECT id, offer FROM listings WHERE store = ? AND category = ? AND last_seen_at < ? AND json_extract(offer, '$.inStock') = 1`)
    .all(store, category, seenBefore) as { id: number; offer: string }[];
  if (!rows.length) return 0;
  const upd = db.prepare('UPDATE listings SET offer = ? WHERE id = ?');
  const insPoint = db.prepare(`
    INSERT OR REPLACE INTO price_points (listing_id, at, price_cash, price_card, effective_cash, coupon, promo, in_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const o = { ...(JSON.parse(r.offer) as Offer), inStock: false };
      upd.run(JSON.stringify(o), r.id);
      insPoint.run(r.id, at, o.priceCash, o.priceCard ?? null, effectiveCash(o), o.coupon ? JSON.stringify(o.coupon) : null, o.promo ? JSON.stringify(o.promo) : null);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  emitCollected({ store, category, at });
  return rows.length;
}

/**
 * Anúncios da loja na categoria, vistos desde `seenSince`, que batem com algum dos termos do
 * formulário pelas specs (termMatches). É o resultado da busca do site.
 */
export function matchingListings(db: Db, store: StoreId, category: CategoryId, terms: string[], seenSince: string): Offer[] {
  const rows = db
    .prepare(`SELECT offer FROM listings WHERE store = ? AND category = ? AND last_seen_at >= ? AND ${NOT_BROKEN}`)
    .all(store, category, seenSince) as { offer: string }[];
  const out: Offer[] = [];
  for (const r of rows) {
    const o = JSON.parse(r.offer) as Offer;
    if (terms.some((t) => termMatches(category, t, o.specs))) out.push(o);
  }
  return out;
}

const fold = (s: string) => stripAccents(s).toLowerCase();

/**
 * Anúncios da loja na categoria, vistos desde `seenSince`, com todas as palavras do texto no título
 * (sem acento nem maiúsculas): o texto livre da busca, no que o banco já tem.
 */
export function titleMatches(db: Db, store: StoreId, category: CategoryId, text: string, seenSince: string): Offer[] {
  const words = fold(text).split(/[\s,]+/).filter(Boolean);
  if (!words.length) return [];
  const rows = db
    .prepare(`SELECT title, offer FROM listings WHERE store = ? AND category = ? AND last_seen_at >= ? AND ${NOT_BROKEN}`)
    .all(store, category, seenSince) as { title: string; offer: string }[];
  return rows.filter((r) => words.every((w) => fold(r.title).includes(w))).map((r) => JSON.parse(r.offer) as Offer);
}

/**
 * Ofertas da categoria em todas as lojas, vistas desde `seenSince` (a última oferta de cada anúncio).
 * Como na busca, sem os anúncios com a página quebrada (prices/page-errors.ts).
 */
export function recentOffers(db: Db, category: CategoryId, seenSince: string): Offer[] {
  const rows = db.prepare(`SELECT offer FROM listings WHERE category = ? AND last_seen_at >= ? AND ${NOT_BROKEN}`).all(category, seenSince) as { offer: string }[];
  return rows.map((r) => JSON.parse(r.offer) as Offer);
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
