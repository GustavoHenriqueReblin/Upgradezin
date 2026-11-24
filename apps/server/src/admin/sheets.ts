import { ENABLED_CATEGORIES } from '@upgradezin/shared';
import type { SheetPageText, SheetProduct, SheetProductFilter, SheetProductPage, SheetStoreStatus, StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { catalogProducts, pageText, SHEET_SCOPE_DAYS, sheetQueueSizes } from '../prices/sheets.ts';
import { pageOf } from './paging.ts';

/** Admin, aba Fichas: andamento da rotina por loja, lista de produtos com a ficha e o texto guardado de uma página. */

const since = (now: number) => new Date(now - SHEET_SCOPE_DAYS * 86_400_000).toISOString();

/** Por loja: páginas lidas, fila, fichas da última hora (pelo registro de consultas). */
export function sheetStoreStatus(db: Db, stores: { id: StoreId; name: string; canRead: boolean }[], now = Date.now()): Omit<SheetStoreStatus, 'nextAt' | 'interval'>[] {
  const read = new Map(
    (db.prepare('SELECT store, count(*) AS n FROM sheet_pages GROUP BY store').all() as { store: StoreId; n: number }[]).map((r) => [r.store, r.n]),
  );
  const queue = sheetQueueSizes(db, since(now));
  const hour = db
    .prepare(`SELECT store, sum(at >= ?) AS last_hour, max(at) AS last_at FROM store_attempts WHERE kind = 'sheet' AND status = 'ok' GROUP BY store`)
    .all(new Date(now - 3_600_000).toISOString()) as { store: string; last_hour: number | null; last_at: string | null }[];
  return stores.map((s) => {
    const h = hour.find((x) => x.store === s.id);
    return { store: s.id, name: s.name, canRead: s.canRead, read: read.get(s.id) ?? 0, queue: queue.get(s.id) ?? 0, lastHour: h?.last_hour ?? 0, lastAt: h?.last_at ?? null };
  });
}

/** Produtos de uma categoria com a ficha juntada, filtrados e paginados. */
export function listSheetProducts(db: Db, f: SheetProductFilter, now = Date.now()): SheetProductPage {
  const { page, pageSize, offset } = pageOf(f);
  const q = f.q?.trim().toLowerCase();
  // "Só a web completa": incompleta com a página de todas as lojas já lida (como na cobertura); "precisa de você": e a web já perguntada.
  const inState = (p: SheetProduct) =>
    !f.state || (f.state === 'exhausted' ? p.state === 'incomplete' && p.listings.every((l) => l.read) : f.state === 'manual' ? p.needsHuman : p.state === f.state);
  // Sem categoria: todas (as ligadas), uma depois da outra.
  const all = (f.category ? [f.category] : ENABLED_CATEGORIES).flatMap((c) => catalogProducts(db, c, since(now))).filter(
    (p) => inState(p) && (!q || p.listings.some((l) => l.title.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q))),
  );
  return { items: all.slice(offset, offset + pageSize), total: all.length, page, pageSize };
}

export function sheetPageText(db: Db, store: StoreId, sku: string): SheetPageText | undefined {
  const t = pageText(db, store, sku);
  return t ? { store, sku, ...t } : undefined;
}
