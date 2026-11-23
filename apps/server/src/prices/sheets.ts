import {
  CATEGORY_DEFS,
  ENABLED_CATEGORIES,
  fieldColumn,
  missingMain,
  READER_VERSION,
  readSheet,
  sheetFields,
  SHEET_FIELDS,
  type CategoryId,
  type SheetField,
  type SheetValue,
  type SheetCoverageRow,
  type SheetProduct,
  type SheetValues,
  type StoreId,
} from '@upgradezin/shared';
import { getMeta, setMeta, type Db } from '../db/db.ts';

/**
 * Fichas técnicas no banco (docs/ARCHITECTURE.md §8.3).
 *
 * - sheet_pages: cada página de produto lida (loja + código), com o texto da ficha (null: a página
 *   não tinha ficha). O texto fica guardado para reler tudo quando o leitor muda, sem abrir as
 *   páginas de novo.
 * - sheet_<categoria>: os campos lidos de cada página, uma coluna por campo (lista em
 *   packages/shared/src/sheet/fields.ts). As colunas seguem a lista: ao subir, o servidor cria as
 *   que faltam e apaga as que saíram (syncSheetTables), e relê as páginas se o leitor ou a lista
 *   mudou (rereadSheets).
 *
 * A ficha de um produto junta as páginas de todos os anúncios dele (listings.product_key: o mesmo
 * produto nas várias lojas), campo a campo: a página da própria loja primeiro, depois as outras, da
 * lida há menos tempo. Nenhuma loja tem preferência.
 */

/** A rotina lê a ficha dos produtos vistos nas lojas nos últimos dias (os que saíram do catálogo ficam de fora). */
export const SHEET_SCOPE_DAYS = 14;

const table = (category: CategoryId) => `sheet_${category}`;
const SQL_TYPE: Record<SheetField['type'], string> = { int: 'INTEGER', bool: 'INTEGER', real: 'REAL', text: 'TEXT', list: 'TEXT' };

const synced = new WeakSet<Db>();

/** Tabelas por categoria prontas nesta conexão (uma vez por conexão). */
function ready(db: Db): Db {
  if (!synced.has(db)) syncSheetTables(db);
  return db;
}

/** Cria as tabelas por categoria e acerta as colunas com a lista de campos. Devolve as colunas criadas e apagadas. */
export function syncSheetTables(db: Db): { added: string[]; dropped: string[] } {
  synced.add(db);
  const added: string[] = [];
  const dropped: string[] = [];
  for (const category of Object.keys(SHEET_FIELDS) as CategoryId[]) {
    const t = table(category);
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
      store     TEXT NOT NULL,
      store_sku TEXT NOT NULL,
      PRIMARY KEY (store, store_sku),
      FOREIGN KEY (store, store_sku) REFERENCES sheet_pages (store, store_sku) ON DELETE CASCADE
    )`);
    const have = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
    const want = new Map(sheetFields(category).map((f) => [fieldColumn(f.key), f]));
    for (const [col, f] of want) {
      if (have.has(col)) continue;
      db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${SQL_TYPE[f.type]}`);
      added.push(`${t}.${col}`);
    }
    for (const col of have) {
      if (col === 'store' || col === 'store_sku' || want.has(col)) continue;
      db.exec(`ALTER TABLE ${t} DROP COLUMN ${col}`);
      dropped.push(`${t}.${col}`);
    }
  }
  return { added, dropped };
}

/** Valor do campo para a coluna (bool vira 0/1). */
const toColumn = (v: SheetValue | undefined) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

function fromRow(category: CategoryId, row: Record<string, unknown>): SheetValues {
  const out: SheetValues = {};
  for (const f of sheetFields(category)) {
    const v = row[fieldColumn(f.key)];
    if (v === null || v === undefined) continue;
    out[f.key] = f.type === 'bool' ? v === 1 : (v as SheetValue);
  }
  return out;
}

/** Grava os campos lidos de uma página (troca os que havia). */
function writeValues(db: Db, category: CategoryId, store: StoreId, sku: string, values: SheetValues): void {
  const fields = sheetFields(category);
  const cols = fields.map((f) => fieldColumn(f.key));
  db.prepare(`INSERT OR REPLACE INTO ${table(category)} (store, store_sku, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`).run(
    store,
    sku,
    ...fields.map((f) => toColumn(values[f.key])),
  );
}

/**
 * Guarda a página lida: o texto da ficha (null: a página não tinha) e os campos que o leitor tirou
 * dele. Devolve os campos.
 */
export function savePage(db: Db, p: { store: StoreId; sku: string; category: CategoryId; text: string | null; at?: string }): SheetValues {
  const at = p.at ?? new Date().toISOString();
  const values = p.text ? readSheet(p.category, p.text) : {};
  ready(db);
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO sheet_pages (store, store_sku, category, text, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (store, store_sku) DO UPDATE SET category = excluded.category, text = excluded.text, fetched_at = excluded.fetched_at`,
    ).run(p.store, p.sku, p.category, p.text, at);
    // Mudou de categoria (anúncio reclassificado): sai da tabela da antiga.
    for (const c of Object.keys(SHEET_FIELDS) as CategoryId[]) if (c !== p.category) db.prepare(`DELETE FROM ${table(c)} WHERE store = ? AND store_sku = ?`).run(p.store, p.sku);
    writeValues(db, p.category, p.store, p.sku, values);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return values;
}

/** Versão do leitor e da lista de campos: mudou, as páginas guardadas são relidas. */
export const readerStamp = () => `${READER_VERSION}:${JSON.stringify(Object.fromEntries(Object.entries(SHEET_FIELDS).map(([c, fs]) => [c, fs.map((f) => f.key)])))}`;

/** Relê todas as páginas guardadas com o leitor atual, se ele ou os campos mudaram (ou `force`). Devolve quantas releu. */
export function rereadSheets(db: Db, force = false): number {
  const stamp = readerStamp();
  if (!force && getMeta(ready(db), 'sheet-reader') === stamp) return 0;
  const pages = db.prepare('SELECT store, store_sku, category, text FROM sheet_pages').all() as { store: StoreId; store_sku: string; category: CategoryId; text: string | null }[];
  db.exec('BEGIN');
  try {
    for (const p of pages) {
      if (!SHEET_FIELDS[p.category]) continue;
      writeValues(db, p.category, p.store, p.store_sku, p.text ? readSheet(p.category, p.text) : {});
    }
    setMeta(db, 'sheet-reader', stamp);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return pages.length;
}

// ---------- ficha do produto ----------

/** Página lida de um anúncio do produto. */
export interface SheetSource {
  store: StoreId;
  sku: string;
  at: string;
  /** A página tinha ficha. */
  hasSheet: boolean;
  values: SheetValues;
}

export interface ProductSheet {
  values: SheetValues;
  /** De qual página veio cada campo. */
  origin: Record<string, { store: StoreId; sku: string }>;
  missing: string[];
  sources: SheetSource[];
}

/** Junta as páginas, campo a campo, na ordem dada (a primeira com o campo vale). */
export function mergeSources(category: CategoryId, sources: SheetSource[]): Omit<ProductSheet, 'sources'> {
  const values: SheetValues = {};
  const origin: ProductSheet['origin'] = {};
  for (const s of sources) {
    for (const [k, v] of Object.entries(s.values)) {
      if (values[k] !== undefined) continue;
      values[k] = v;
      origin[k] = { store: s.store, sku: s.sku };
    }
  }
  return { values, origin, missing: missingMain(category, values) };
}

function sourcesOf(db: Db, category: CategoryId, rows: { store: StoreId; store_sku: string }[]): SheetSource[] {
  if (!rows.length) return [];
  ready(db);
  const keys = rows.map((r) => `${r.store}|${r.store_sku}`);
  const found = db
    .prepare(
      `SELECT s.*, p.store, p.store_sku, p.fetched_at, p.text IS NOT NULL AS has_sheet FROM sheet_pages p
       LEFT JOIN ${table(category)} s ON s.store = p.store AND s.store_sku = p.store_sku
       WHERE p.store || '|' || p.store_sku IN (${keys.map(() => '?').join(', ')})`,
    )
    .all(...keys) as (Record<string, unknown> & { store: StoreId; store_sku: string; fetched_at: string; has_sheet: number })[];
  return found.map((r) => ({ store: r.store, sku: r.store_sku, at: r.fetched_at, hasSheet: !!r.has_sheet, values: fromRow(category, r) }));
}

/**
 * Ficha do produto de um anúncio: a página dele e as dos outros anúncios do mesmo produto, juntas
 * (a dele primeiro, depois a lida há menos tempo). undefined: nenhuma página lida.
 */
export function productSheet(db: Db, store: StoreId, sku: string): (ProductSheet & { category: CategoryId }) | undefined {
  const l = db.prepare('SELECT id, category, product_key FROM listings WHERE store = ? AND store_sku = ?').get(store, sku) as
    | { id: number; category: CategoryId; product_key: string | null }
    | undefined;
  if (!l) return undefined;
  const rows = l.product_key
    ? (db.prepare('SELECT store, store_sku FROM listings WHERE product_key = ?').all(l.product_key) as { store: StoreId; store_sku: string }[])
    : [{ store, store_sku: sku }];
  const sources = sourcesOf(db, l.category, rows).sort((a, b) => Number(b.store === store && b.sku === sku) - Number(a.store === store && a.sku === sku) || b.at.localeCompare(a.at));
  if (!sources.length) return undefined;
  return { category: l.category, ...mergeSources(l.category, sources), sources };
}

// ---------- produtos por categoria (cobertura, fila, admin) ----------

/**
 * Produtos de uma categoria vistos desde `since`, com a ficha juntada. Um produto = os anúncios com o
 * mesmo product_key (ou um anúncio sozinho, sem chave).
 */
export function catalogProducts(db: Db, category: CategoryId, since: string): SheetProduct[] {
  const rows = ready(db)
    .prepare(
      `SELECT s.*, l.id, l.store, l.store_sku, l.title, l.url, l.product_key, l.first_seen_at, json_extract(l.offer, '$.inStock') AS in_stock,
              p.fetched_at, p.text IS NOT NULL AS has_sheet, p.store_sku AS page
       FROM listings l
       LEFT JOIN sheet_pages p ON p.store = l.store AND p.store_sku = l.store_sku
       LEFT JOIN ${table(category)} s ON s.store = l.store AND s.store_sku = l.store_sku
       WHERE l.category = ? AND l.last_seen_at >= ?
       ORDER BY l.last_seen_at DESC`,
    )
    .all(category, since) as (Record<string, unknown> & {
    id: number;
    store: StoreId;
    store_sku: string;
    title: string;
    url: string;
    product_key: string | null;
    first_seen_at: string;
    in_stock: number;
    fetched_at: string | null;
    has_sheet: number | null;
    page: string | null;
  })[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.product_key ?? `id:${r.id}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups].map(([key, g]) => {
    const sources: SheetSource[] = g
      .filter((r) => r.page !== null)
      .map((r) => ({ store: r.store, sku: r.store_sku, at: r.fetched_at!, hasSheet: !!r.has_sheet, values: fromRow(category, r) }))
      .sort((a, b) => b.at.localeCompare(a.at));
    const merged = mergeSources(category, sources);
    return {
      key,
      category,
      title: g[0]!.title,
      listings: g.map((r) => ({
        store: r.store,
        sku: r.store_sku,
        title: r.title,
        url: r.url,
        inStock: !!r.in_stock,
        firstSeenAt: r.first_seen_at,
        read: r.page !== null,
        ...(r.page !== null && { at: r.fetched_at!, hasSheet: !!r.has_sheet }),
      })),
      state: !sources.length ? 'unread' : merged.missing.length ? 'incomplete' : 'complete',
      ...merged,
    };
  });
}

/**
 * Próximos anúncios da loja para a rotina abrir a página e ler a ficha: vistos desde `since`, com
 * a página ainda não lida e de produto sem ficha completa (a ficha completa por outra loja não
 * precisa desta). Produto achado há menos tempo primeiro (o que a coleta acabou de encontrar), em
 * estoque antes. `skip`: códigos a deixar de fora (a página deu erro há pouco).
 */
export function nextSheets(db: Db, store: StoreId, since: string, limit = 1, skip: ReadonlySet<string> = new Set()): { sku: string; category: CategoryId }[] {
  const out: { sku: string; category: CategoryId; inStock: boolean; first: string }[] = [];
  for (const category of ENABLED_CATEGORIES) {
    for (const p of catalogProducts(db, category, since)) {
      if (p.state === 'complete') continue;
      for (const l of p.listings)
        if (l.store === store && !l.read && !skip.has(l.sku)) out.push({ sku: l.sku, category, inStock: l.inStock, first: l.firstSeenAt });
    }
  }
  out.sort((a, b) => Number(b.inStock) - Number(a.inStock) || b.first.localeCompare(a.first));
  return out.slice(0, limit).map(({ sku, category }) => ({ sku, category }));
}

/** Páginas na fila de cada loja (o que nextSheets ainda tem para ler). */
export function sheetQueueSizes(db: Db, since: string): Map<StoreId, number> {
  const out = new Map<StoreId, number>();
  for (const category of ENABLED_CATEGORIES)
    for (const p of catalogProducts(db, category, since)) {
      if (p.state === 'complete') continue;
      for (const l of p.listings) if (!l.read) out.set(l.store, (out.get(l.store) ?? 0) + 1);
    }
  return out;
}

/** Cobertura das fichas por categoria. */
export function sheetCoverage(db: Db, since: string): SheetCoverageRow[] {
  return ENABLED_CATEGORIES.map((category) => {
    const ps = catalogProducts(db, category, since);
    const missing: Record<string, number> = {};
    for (const p of ps) if (p.state === 'incomplete') for (const k of p.missing) missing[k] = (missing[k] ?? 0) + 1;
    return {
      category,
      name: CATEGORY_DEFS[category].name,
      products: ps.length,
      complete: ps.filter((p) => p.state === 'complete').length,
      incomplete: ps.filter((p) => p.state === 'incomplete').length,
      unread: ps.filter((p) => p.state === 'unread').length,
      exhausted: ps.filter((p) => p.state === 'incomplete' && p.listings.every((l) => l.read)).length,
      missing,
    };
  });
}

/** Páginas lidas por loja e categoria (cobertura do admin, aba Cobertura). */
export function sheetCounts(db: Db): Map<string, number> {
  const rows = db.prepare('SELECT store, category, count(*) AS n FROM sheet_pages GROUP BY store, category').all() as { store: string; category: string; n: number }[];
  return new Map(rows.map((r) => [`${r.store}|${r.category}`, r.n]));
}

/** Texto guardado da ficha de uma página (para conferir no admin). */
export function pageText(db: Db, store: StoreId, sku: string): { text: string | null; at: string } | undefined {
  const r = db.prepare('SELECT text, fetched_at FROM sheet_pages WHERE store = ? AND store_sku = ?').get(store, sku) as { text: string | null; fetched_at: string } | undefined;
  return r ? { text: r.text, at: r.fetched_at } : undefined;
}
