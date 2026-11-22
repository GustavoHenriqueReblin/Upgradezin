import { cpuPerf, effectiveCash, gpuPerf, type AdminProduct, type AdminProductFilter, type AdminProductPage, type Offer, type SheetStatus, type SheetStoreStatus, type SpecSheet, type StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { HAS_SPECS, productSheet, SHARED_SHEET, SHEET_CATEGORIES, SHEET_SCOPE_DAYS } from '../prices/sheets.ts';
import { pageOf } from './paging.ts';

/**
 * Catálogo para a aba Produtos do admin: cada anúncio guardado (loja + código), com a última
 * oferta, as specs do título, o índice de desempenho, a ficha técnica (a dele ou a de outro anúncio
 * do mesmo produto) e os outros anúncios do mesmo produto. Paginado no banco.
 */

const EMPTY = "json_extract(ps.data, '$.specs') = '{}' AND json_extract(ps.data, '$.mpn') IS NULL";
const SHEETABLE = `l.category IN (${SHEET_CATEGORIES.map((c) => `'${c}'`).join(', ')})`;
/**
 * Situação da ficha em SQL (mesma regra de SheetStatus): com medidas = lida; senão, com a de outro
 * anúncio do mesmo produto = de outra loja; senão não lida, vazia ou lida (só o part number).
 */
const STATUS_SQL = `CASE WHEN NOT (${SHEETABLE}) THEN 'na'
  WHEN ps.store_sku IS NOT NULL AND ${HAS_SPECS('ps.data')} THEN 'ok'
  WHEN ${SHARED_SHEET} THEN 'shared'
  WHEN ps.store_sku IS NULL THEN 'missing' WHEN ${EMPTY} THEN 'empty' ELSE 'ok' END`;

export function listProducts(db: Db, f: AdminProductFilter = {}): AdminProductPage {
  const { page, pageSize, offset } = pageOf(f);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.store) where.push('l.store = ?'), args.push(f.store);
  if (f.category) where.push('l.category = ?'), args.push(f.category);
  if (f.sheet) where.push(`${STATUS_SQL} = ?`), args.push(f.sheet);
  if (f.inStock !== undefined) where.push(`json_extract(l.offer, '$.inStock') = ?`), args.push(f.inStock ? 1 : 0);
  // Texto: no título ou no código; % e _ são literais (escapados com !), não curingas.
  if (f.q?.trim()) {
    const like = `%${f.q.trim().toLowerCase().replace(/[!%_]/g, (c) => `!${c}`)}%`;
    where.push(`(lower(l.title) LIKE ? ESCAPE '!' OR lower(l.store_sku) LIKE ? ESCAPE '!')`);
    args.push(like, like);
  }
  const from = `FROM listings l LEFT JOIN product_sheets ps ON ps.store = l.store AND ps.store_sku = l.store_sku ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const total = (db.prepare(`SELECT count(*) AS n ${from}`).get(...args) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT l.id, l.store, l.store_sku, l.category, l.title, l.url, l.offer, l.first_seen_at, l.last_seen_at, l.product_key, ps.data AS sheet, ps.fetched_at AS sheet_at, ${STATUS_SQL} AS status
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
    sheet: string | null;
    sheet_at: string | null;
    product_key: string | null;
    status: SheetStatus;
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
      sheetStatus: r.status,
      ...(r.sheet && { sheet: JSON.parse(r.sheet) as SpecSheet, sheetAt: r.sheet_at! }),
      ...(r.status === 'shared' && shared(db, r.store, r.store_sku)),
      ...(r.product_key && {
        productKey: r.product_key,
        siblings: siblings.filter((x) => x.product_key === r.product_key && x.id !== r.id).map((x) => ({ store: x.store, sku: x.store_sku, title: x.title, url: x.url })),
      }),
    };
  });
  return { items, total, page, pageSize };
}

/** Ficha de outro anúncio do mesmo produto, com a origem. */
function shared(db: Db, store: StoreId, sku: string): Partial<AdminProduct> {
  const p = productSheet(db, store, sku, new Date(0).toISOString());
  return p?.from ? { sheet: p.sheet, sheetAt: p.at!, sheetFrom: p.from } : {};
}

/**
 * Andamento das fichas por loja: dos produtos com ficha física (placa de vídeo, gabinete, cooler)
 * vistos nos últimos SHEET_SCOPE_DAYS dias, quantos têm ficha, quantos usam a de outro anúncio do
 * mesmo produto, quantos a página não tinha e quantos faltam; e as fichas lidas na última hora (rotina, montagem e admin), pelo registro de consultas.
 */
export function sheetStoreStatus(db: Db, stores: { id: StoreId; name: string; canRead: boolean }[], now = Date.now()): Omit<SheetStoreStatus, 'nextAt'>[] {
  const since = new Date(now - SHEET_SCOPE_DAYS * 86_400_000).toISOString();
  const counts = db
    .prepare(
      `SELECT l.store, ${STATUS_SQL} AS status, count(*) AS n
       FROM listings l LEFT JOIN product_sheets ps ON ps.store = l.store AND ps.store_sku = l.store_sku
       WHERE ${SHEETABLE} AND l.last_seen_at >= ? GROUP BY l.store, status`,
    )
    .all(since) as { store: string; status: SheetStatus; n: number }[];
  const hour = db
    .prepare(`SELECT store, sum(at >= ?) AS last_hour, max(at) AS last_at FROM store_attempts WHERE kind = 'sheet' AND status = 'ok' GROUP BY store`)
    .all(new Date(now - 3_600_000).toISOString()) as { store: string; last_hour: number | null; last_at: string | null }[];
  return stores.map((s) => {
    const by = (status: SheetStatus) => counts.find((c) => c.store === s.id && c.status === status)?.n ?? 0;
    const h = hour.find((x) => x.store === s.id);
    const [ok, shared, empty, missing] = [by('ok'), by('shared'), by('empty'), by('missing')];
    return { store: s.id, name: s.name, canRead: s.canRead, total: ok + shared + empty + missing, ok, shared, empty, missing, lastHour: h?.last_hour ?? 0, lastAt: h?.last_at ?? null };
  });
}
