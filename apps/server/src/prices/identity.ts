import { identifyProducts, type CategoryId, type Offer, type StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { onCollected } from './events.ts';

/**
 * Chave de produto de cada anúncio (listings.product_key: mesmo part number, a ficha técnica vale para
 * todos) e de grupo (listings.group_key: mesmo modelo, para mostrar junto), pelo algoritmo de
 * identity.ts sobre todos os anúncios da categoria. Recalculada pouco depois de cada coleta da
 * categoria (juntando as que chegam seguidas) e ao subir o servidor.
 */

/** Recalcula as chaves dos anúncios de uma categoria. Devolve quantos anúncios mudaram de chave. */
export function rebuildProductKeys(db: Db, category: CategoryId): number {
  const rows = db
    .prepare('SELECT id, store, store_sku, title, url, offer, product_key, group_key FROM listings WHERE category = ?')
    .all(category) as { id: number; store: StoreId; store_sku: string; title: string; url: string; offer: string; product_key: string | null; group_key: string | null }[];
  const { exact, group } = identifyProducts(
    rows.map((r) => {
      const o = JSON.parse(r.offer) as Offer;
      return { id: String(r.id), store: r.store, title: r.title, url: r.url, mpn: o.mpn, ean: o.ean, brand: o.brand, modelKey: o.modelKey, specs: o.specs ?? {} };
    }),
  );
  const update = db.prepare('UPDATE listings SET product_key = ?, group_key = ? WHERE id = ?');
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const p = `${category}:${exact.get(String(r.id))}`;
      const g = `${category}:${group.get(String(r.id))}`;
      if (p !== r.product_key || g !== r.group_key) {
        update.run(p, g, r.id);
        changed++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return changed;
}

/** Todas as categorias com anúncio. */
export function rebuildAllProductKeys(db: Db): number {
  const cats = (db.prepare('SELECT DISTINCT category FROM listings').all() as { category: CategoryId }[]).map((r) => r.category);
  return cats.reduce((n, c) => n + rebuildProductKeys(db, c), 0);
}

/** Depois de uma coleta, espera isto (juntando as coletas seguidas da mesma categoria) para recalcular. */
export const REBUILD_DELAY_MS = 30_000;

/**
 * Recalcula ao subir (depois de `firstMs`) e após as coletas de cada categoria. Devolve a função que
 * para (desliga a escuta e os recálculos marcados).
 */
export function startProductKeys(db: () => Db, { firstMs = 5_000, delayMs = REBUILD_DELAY_MS } = {}): () => void {
  const pending = new Map<CategoryId, NodeJS.Timeout>();
  const run = (fn: () => number, what: string) => {
    try {
      const n = fn();
      if (n) console.info(`[produtos] ${what}: ${n} anúncio(s) com chave nova`);
    } catch (err) {
      console.error(`[produtos] ${what}:`, err);
    }
  };
  const first = setTimeout(() => run(() => rebuildAllProductKeys(db()), 'todas as categorias'), firstMs);
  const off = onCollected(({ category }) => {
    if (pending.has(category)) return;
    pending.set(
      category,
      setTimeout(() => {
        pending.delete(category);
        run(() => rebuildProductKeys(db(), category), category);
      }, delayMs),
    );
  });
  return () => {
    clearTimeout(first);
    off();
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  };
}
