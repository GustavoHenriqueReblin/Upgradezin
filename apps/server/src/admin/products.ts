import { cpuPerf, effectiveCash, gpuPerf, type AdminProduct, type AdminProductFilter, type AdminProductPage, type Offer, type StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { pageOf } from './paging.ts';

/**
 * Catálogo para a aba Produtos do admin: cada anúncio guardado (loja + código), com a última
 * oferta, as specs do título, o índice de desempenho e os outros anúncios do mesmo produto.
 * Paginado no banco. A ficha técnica fica na aba Fichas (admin/sheets.ts).
 */

export function listProducts(db: Db, f: AdminProductFilter = {}): AdminProductPage {
  const { page, pageSize, offset } = pageOf(f);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.store) where.push('l.store = ?'), args.push(f.store);
  if (f.category) where.push('l.category = ?'), args.push(f.category);
  if (f.inStock !== undefined) where.push(`json_extract(l.offer, '$.inStock') = ?`), args.push(f.inStock ? 1 : 0);
  // Texto: no título ou no código; % e _ são literais (escapados com !), não curingas.
  if (f.q?.trim()) {
    const like = `%${f.q.trim().toLowerCase().replace(/[!%_]/g, (c) => `!${c}`)}%`;
    where.push(`(lower(l.title) LIKE ? ESCAPE '!' OR lower(l.store_sku) LIKE ? ESCAPE '!')`);
    args.push(like, like);
  }
  const from = `FROM listings l ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const total = (db.prepare(`SELECT count(*) AS n ${from}`).get(...args) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT l.id, l.store, l.store_sku, l.category, l.title, l.url, l.offer, l.first_seen_at, l.last_seen_at, l.product_key
       ${from} ORDER BY l.last_seen_at DESC, l.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, offset) as {
    id: number;
    store: StoreId;
    store_sku: string;
    category: AdminProduct['category'];
    title: string;
    url: string;
    offer: string;
    first_seen_at: string;
    last_seen_at: string;
    product_key: string | null;
  }[];
  // Outros anúncios do mesmo produto (nesta e nas outras lojas), dos itens desta página.
  const keys = [...new Set(rows.map((r) => r.product_key).filter((k): k is string => !!k))];
  const siblings = keys.length
    ? (db.prepare(`SELECT id, store, store_sku, title, url, product_key FROM listings WHERE product_key IN (${keys.map(() => '?').join(', ')})`).all(...keys) as {
        id: number;
        store: StoreId;
        store_sku: string;
        title: string;
        url: string;
        product_key: string;
      }[])
    : [];
  const items = rows.map((r): AdminProduct => {
    const o = JSON.parse(r.offer) as Offer;
    const specs = o.specs ?? {};
    const perf = r.category === 'gpu' ? gpuPerf(specs) : r.category === 'cpu' ? cpuPerf(specs) : undefined;
    return {
      store: r.store,
      sku: r.store_sku,
      category: r.category,
      title: r.title,
      url: r.url,
      price: effectiveCash(o),
      inStock: o.inStock,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      specs,
      ...(perf !== undefined && { perf }),
      ...(r.product_key && {
        productKey: r.product_key,
        siblings: siblings.filter((x) => x.product_key === r.product_key && x.id !== r.id).map((x) => ({ store: x.store, sku: x.store_sku, title: x.title, url: x.url })),
      }),
    };
  });
  return { items, total, page, pageSize };
}
