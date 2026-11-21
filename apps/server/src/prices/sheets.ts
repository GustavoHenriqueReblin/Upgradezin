import type { SpecSheet, StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';

/**
 * Fichas técnicas guardadas (docs/ARCHITECTURE.md §8.2): medidas físicas e part number lidos
 * da página do produto, sob demanda (só das peças que entram na montagem). Uma ficha vale
 * SHEET_MAX_AGE_DAYS; página sem ficha também fica guardada, para não ser aberta de novo.
 */
export function getSheet(db: Db, store: StoreId, sku: string, since: string): SpecSheet | undefined {
  const row = db.prepare('SELECT data FROM product_sheets WHERE store = ? AND store_sku = ? AND fetched_at >= ?').get(store, sku, since) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as SpecSheet) : undefined;
}

export function saveSheet(db: Db, store: StoreId, sku: string, sheet: SpecSheet, at = new Date().toISOString()): void {
  db.prepare(`
    INSERT INTO product_sheets (store, store_sku, data, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (store, store_sku) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`).run(store, sku, JSON.stringify(sheet), at);
}
