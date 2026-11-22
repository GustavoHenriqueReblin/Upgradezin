import type { CategoryId, SpecSheet, StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';

/**
 * Fichas técnicas guardadas (docs/ARCHITECTURE.md §8.2): medidas físicas e part number lidos da
 * página do produto. A rotina lê aos poucos as de todo o catálogo (nextSheets); a montagem lê na
 * hora a de uma peça escolhida que ainda não foi lida. A ficha de um produto não muda: com dados,
 * vale para sempre. Página sem ficha também fica guardada, para não ser aberta a cada vez, mas é
 * lida de novo depois de SHEET_MAX_AGE_DAYS (a loja pode ter completado a página).
 */

/** A rotina lê a ficha dos produtos vistos nas lojas nos últimos dias (os que saíram do catálogo ficam de fora). */
export const SHEET_SCOPE_DAYS = 14;

/** Categorias com ficha física (comprimento, altura, folgas): as que a montagem confere. */
export const SHEET_CATEGORIES: CategoryId[] = ['gpu', 'case', 'cooler'];

/** Ficha guardada vazia: a página não tinha ficha nem part number. */
const EMPTY = "json_extract(data, '$.specs') = '{}' AND json_extract(data, '$.mpn') IS NULL";

/** Ficha guardada do produto: com dados, sempre; vazia, só se lida desde `emptySince`. */
export function getSheet(db: Db, store: StoreId, sku: string, emptySince: string): SpecSheet | undefined {
  const row = db.prepare(`SELECT data FROM product_sheets WHERE store = ? AND store_sku = ? AND (NOT (${EMPTY}) OR fetched_at >= ?)`).get(store, sku, emptySince) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as SpecSheet) : undefined;
}

/** Ficha com alguma medida (não só o part number). */
export const HAS_SPECS = (col: string) => `json_extract(${col}, '$.specs') != '{}'`;

/**
 * Outro anúncio do mesmo produto (listings.product_key, prices/identity.ts) com ficha com medidas: a
 * ficha de um vale para o outro (mesmo part number). Em SQL, sobre o anúncio `l`.
 */
export const SHARED_SHEET = `l.product_key IS NOT NULL AND EXISTS (
  SELECT 1 FROM listings o JOIN product_sheets p2 ON p2.store = o.store AND p2.store_sku = o.store_sku
  WHERE o.product_key = l.product_key AND o.id != l.id AND ${HAS_SPECS('p2.data')})`;

/**
 * Ficha do produto: a do próprio anúncio, se tem medidas; senão a de outro anúncio do mesmo produto
 * (outra loja, ou outro anúncio da mesma) que tenha, com a origem; senão a própria (vazia ou só com o
 * part number, se ainda vale).
 */
export function productSheet(
  db: Db,
  store: StoreId,
  sku: string,
  emptySince: string,
): { sheet: SpecSheet; at?: string; from?: { store: StoreId; sku: string } } | undefined {
  const own = getSheet(db, store, sku, emptySince);
  if (own && Object.keys(own.specs).length) return { sheet: own };
  const other = db
    .prepare(
      `SELECT o.store, o.store_sku, p2.data, p2.fetched_at FROM listings l
       JOIN listings o ON o.product_key = l.product_key AND o.id != l.id
       JOIN product_sheets p2 ON p2.store = o.store AND p2.store_sku = o.store_sku
       WHERE l.store = ? AND l.store_sku = ? AND l.product_key IS NOT NULL AND ${HAS_SPECS('p2.data')}
       ORDER BY p2.fetched_at DESC LIMIT 1`,
    )
    .get(store, sku) as { store: StoreId; store_sku: string; data: string; fetched_at: string } | undefined;
  if (other) return { sheet: JSON.parse(other.data) as SpecSheet, at: other.fetched_at, from: { store: other.store, sku: other.store_sku } };
  return own ? { sheet: own } : undefined;
}

export function saveSheet(db: Db, store: StoreId, sku: string, sheet: SpecSheet, at = new Date().toISOString()): void {
  db.prepare(`
    INSERT INTO product_sheets (store, store_sku, data, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (store, store_sku) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`).run(store, sku, JSON.stringify(sheet), at);
}

/**
 * Próximos produtos da loja sem ficha guardada (ou com ficha vazia lida antes de `emptyBefore`),
 * vistos desde `seenSince`, para a rotina ler. Ordem: placa de vídeo, gabinete, cooler (o
 * comprimento da placa é o que mais reprova peça); dentro de cada uma, em estoque e vistos há
 * menos tempo primeiro. Pula o produto que já tem ficha com medidas em outro anúncio (outra loja):
 * a ficha vale para os dois, não precisa abrir a página.
 */
export function nextSheets(db: Db, store: StoreId, seenSince: string, emptyBefore: string, limit = 1): { sku: string; category: CategoryId }[] {
  const order = SHEET_CATEGORIES.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ');
  return db
    .prepare(
      `SELECT l.store_sku AS sku, l.category FROM listings l
       LEFT JOIN product_sheets ps ON ps.store = l.store AND ps.store_sku = l.store_sku
       WHERE l.store = ? AND l.category IN (${SHEET_CATEGORIES.map(() => '?').join(', ')}) AND l.last_seen_at >= ?
         AND (ps.store_sku IS NULL OR (${EMPTY.replaceAll('data', 'ps.data')} AND ps.fetched_at < ?))
         AND NOT (${SHARED_SHEET})
       ORDER BY CASE l.category ${order} END, json_extract(l.offer, '$.inStock') DESC, l.last_seen_at DESC
       LIMIT ?`,
    )
    .all(store, ...SHEET_CATEGORIES, seenSince, emptyBefore, limit) as { sku: string; category: CategoryId }[];
}

/** Anúncios com ficha guardada, por loja e categoria (para a cobertura do admin). */
export function sheetCounts(db: Db): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT l.store, l.category, count(*) AS n FROM listings l
       JOIN product_sheets ps ON ps.store = l.store AND ps.store_sku = l.store_sku
       GROUP BY l.store, l.category`,
    )
    .all() as { store: string; category: string; n: number }[];
  return new Map(rows.map((r) => [`${r.store}|${r.category}`, r.n]));
}
