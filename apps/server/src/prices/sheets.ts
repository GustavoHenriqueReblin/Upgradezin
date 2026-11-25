import {
  CATEGORY_DEFS,
  ENABLED_CATEGORIES,
  fieldColumn,
  isOwnRetailOffer,
  missingMain,
  missingOptional,
  READER_VERSION,
  readSheet,
  acceptSheetValue,
  estimateSheet,
  readTitle,
  SHEET_DEFAULTS,
  titleBlocksDefault,
  sheetFields,
  SHEET_FIELDS,
  type CategoryId,
  type SheetField,
  type SheetValue,
  type SheetValueFrom,
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
 * lida há menos tempo. Nenhuma loja tem preferência. O que nenhuma página trouxe vem do título dos
 * anúncios (readTitle), depois da busca na web (sheet_web: a resposta de cada pergunta feita, por
 * produto e campo; prices/web-fill.ts), da estimativa (estimateSheet, só do campo que a web já foi
 * perguntada e não respondeu) e, por fim, do valor padrão da categoria (SHEET_DEFAULTS, só com página
 * lida). Título, estimativa e padrão entram na hora de juntar, sem gravar: mudou o leitor, vale na hora.
 */

/** A rotina lê a ficha dos produtos vistos nas lojas nos últimos dias (os que saíram do catálogo ficam de fora). */
export const SHEET_SCOPE_DAYS = 14;

const table = (category: CategoryId) => `sheet_${category}`;
const SQL_TYPE: Record<SheetField['type'], string> = { int: 'INTEGER', bool: 'INTEGER', real: 'REAL', text: 'TEXT', list: 'TEXT' };

const synced = new WeakSet<Db>();

/** Tabelas por categoria prontas nesta conexão (uma vez por conexão). */
export function ready(db: Db): Db {
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
  // Preenchido à mão no admin (produto "precisa de você"): vale mais que tudo.
  db.exec(`CREATE TABLE IF NOT EXISTS sheet_manual (
    product_key TEXT NOT NULL,
    field       TEXT NOT NULL,
    category    TEXT NOT NULL,
    value       TEXT NOT NULL,
    set_at      TEXT NOT NULL,
    PRIMARY KEY (product_key, field)
  )`);
  // Busca na web: uma linha por campo perguntado (produto + campo), com a resposta, o valor lido (JSON), a confiança e as fontes.
  db.exec(`CREATE TABLE IF NOT EXISTS sheet_web (
    product_key TEXT NOT NULL,
    field       TEXT NOT NULL,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL DEFAULT '',
    value       TEXT,
    status      TEXT NOT NULL,
    store       TEXT NOT NULL,
    asked_at    TEXT NOT NULL,
    confidence  TEXT,
    sources     TEXT,
    PRIMARY KEY (product_key, field)
  )`);
  // Colunas que vieram depois (a confiança e as fontes da resposta em JSON).
  const webCols = new Set((db.prepare('PRAGMA table_info(sheet_web)').all() as { name: string }[]).map((c) => c.name));
  for (const col of ['confidence', 'sources']) if (!webCols.has(col)) db.exec(`ALTER TABLE sheet_web ADD COLUMN ${col} TEXT`);
  // As tabelas por campo podem guardar valores da versão antiga do leitor.
  db.exec("DELETE FROM sheet_manual WHERE category = 'cpu' AND field = 'maxPowerW'; DELETE FROM sheet_web WHERE category = 'cpu' AND field = 'maxPowerW'");
  return { added, dropped };
}

/** Registra a decisão sobre um produto existente, independente dos valores da ficha. */
export function setSheetCompletion(db: Db, key: string, category: CategoryId, complete: boolean): boolean {
  const exists = key.startsWith('id:')
    ? db.prepare('SELECT 1 FROM listings WHERE category = ? AND id = ? AND product_key IS NULL').get(category, key.slice(3))
    : db.prepare('SELECT 1 FROM listings WHERE category = ? AND product_key = ?').get(category, key);
  if (!exists) return false;
  if (complete) db.prepare('INSERT OR IGNORE INTO sheet_completion (category, product_key) VALUES (?, ?)').run(category, key);
  else db.prepare('DELETE FROM sheet_completion WHERE category = ? AND product_key = ?').run(category, key);
  return true;
}

/** Campos preenchidos à mão, por produto, de uma categoria (ou só dos produtos dados). */
export function manualSheets(db: Db, category: CategoryId, keys?: string[]): Map<string, SheetValues> {
  ready(db);
  const rows = (
    keys
      ? keys.length
        ? db.prepare(`SELECT product_key, field, value FROM sheet_manual WHERE category = ? AND product_key IN (${keys.map(() => '?').join(', ')})`).all(category, ...keys)
        : []
      : db.prepare('SELECT product_key, field, value FROM sheet_manual WHERE category = ?').all(category)
  ) as { product_key: string; field: string; value: string }[];
  const out = new Map<string, SheetValues>();
  for (const r of rows) {
    const v = out.get(r.product_key) ?? {};
    v[r.field] = JSON.parse(r.value) as SheetValue;
    out.set(r.product_key, v);
  }
  return out;
}

/**
 * Preenche à mão campos de um produto (admin): cada valor validado como no JSON da web (tipo, opções,
 * faixa); null ou vazio apaga o campo. Devolve os campos recusados.
 */
export function setManualSheet(db: Db, key: string, category: CategoryId, values: Record<string, unknown>, now = new Date().toISOString()): { errors: string[] } {
  ready(db);
  const errors: string[] = [];
  const known = new Set(SHEET_FIELDS[category].map((f) => f.key));
  db.exec('BEGIN');
  try {
    for (const [field, raw] of Object.entries(values)) {
      if (!known.has(field)) {
        errors.push(field);
        continue;
      }
      if (raw === null || raw === '') {
        db.prepare('DELETE FROM sheet_manual WHERE product_key = ? AND field = ?').run(key, field);
        continue;
      }
      const v = acceptSheetValue(category, field, raw);
      if (v === undefined) {
        errors.push(field);
        continue;
      }
      db.prepare('INSERT OR REPLACE INTO sheet_manual (product_key, field, category, value, set_at) VALUES (?, ?, ?, ?, ?)').run(key, field, category, JSON.stringify(v), now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { errors };
}

/** Respostas da busca na web de um produto: os valores lidos e os campos já perguntados (com ou sem resposta). */
export interface WebSheet {
  values: SheetValues;
  asked: Set<string>;
}

/** Respostas da busca na web por produto, de uma categoria (ou só dos produtos dados). */
export function webSheets(db: Db, category: CategoryId, keys?: string[]): Map<string, WebSheet> {
  ready(db);
  const rows = (
    keys
      ? keys.length
        ? db.prepare(`SELECT product_key, field, value FROM sheet_web WHERE category = ? AND product_key IN (${keys.map(() => '?').join(', ')})`).all(category, ...keys)
        : []
      : db.prepare('SELECT product_key, field, value FROM sheet_web WHERE category = ?').all(category)
  ) as { product_key: string; field: string; value: string | null }[];
  const out = new Map<string, WebSheet>();
  for (const r of rows) {
    let w = out.get(r.product_key);
    if (!w) out.set(r.product_key, (w = { values: {}, asked: new Set() }));
    w.asked.add(r.field);
    if (r.value !== null) w.values[r.field] = JSON.parse(r.value) as SheetValue;
  }
  return out;
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

/** Título de um anúncio do produto. */
export interface SheetTitle {
  store: StoreId;
  sku: string;
  title: string;
}

export interface ProductSheet {
  values: SheetValues;
  /** De qual página veio cada campo (from: do título do anúncio, da busca na web, estimado ou o valor padrão). */
  origin: Record<string, { store: StoreId; sku: string; from?: SheetValueFrom }>;
  missing: string[];
  sources: SheetSource[];
}

/** Campos do título, guardados por título (a lista de produtos junta tudo a cada consulta). */
const titleCache = new Map<string, SheetValues>();
/** O valor de "não tem" de cada campo da categoria que pode não ter o recurso. */
const noneOf = (category: CategoryId): Record<string, SheetValue> =>
  Object.fromEntries(SHEET_FIELDS[category].filter((f) => f.none !== undefined).map((f) => [f.key, f.none!]));
function titleValues(category: CategoryId, title: string): SheetValues {
  const key = `${category}|${title}`;
  let v = titleCache.get(key);
  if (!v) {
    if (titleCache.size > 50_000) titleCache.clear();
    v = readTitle(category, title);
    titleCache.set(key, v);
  }
  return v;
}

/**
 * Junta, campo a campo: o preenchido à mão no admin; as páginas, na ordem dada (a primeira com o campo vale); depois o que os
 * títulos dos anúncios dizem; depois a busca na web; depois a estimativa do campo que a web não
 * respondeu; depois o padrão da categoria, se alguma página com ficha foi lida.
 *
 * "Não tem" (o `none` do campo) que não veio da mão de uma pessoa cede para um valor de verdade de outra
 * fonte: a página que não fala de Wi-Fi diz "Não", mas o título "… Wifi7" ou a outra loja ganham.
 */
export function mergeSources(category: CategoryId, sources: SheetSource[], titles: SheetTitle[] = [], web?: WebSheet, manual?: SheetValues): Omit<ProductSheet, 'sources'> {
  const values: SheetValues = {};
  const origin: ProductSheet['origin'] = {};
  const none = noneOf(category);
  /** O campo já tem valor que fica: qualquer um, menos o "não tem" automático contra um valor de verdade. */
  const taken = (k: string, v: SheetValue) => values[k] !== undefined && !(k in none && values[k] === none[k] && v !== none[k] && origin[k]?.from !== 'manual');
  // Preenchido à mão no admin: vale mais que tudo (conferido por uma pessoa).
  const owner = sources[0] ?? titles[0];
  if (manual && owner)
    for (const [k, v] of Object.entries(manual)) {
      values[k] = v;
      origin[k] = { store: owner.store, sku: owner.sku, from: 'manual' };
    }
  for (const s of sources) {
    for (const [k, v] of Object.entries(s.values)) {
      const existing = values[k];
      // Duas fichas divergentes não comprovam capacidade extra de expansão.
      const smallerBoardCount = category === 'motherboard' && (k === 'ramSlots' || k === 'm2Slots') &&
        origin[k]?.from !== 'manual' && typeof existing === 'number' && typeof v === 'number' && v < existing;
      if (taken(k, v) && !smallerBoardCount) continue;
      values[k] = v;
      origin[k] = { store: s.store, sku: s.sku };
    }
  }
  for (const t of titles) {
    for (const [k, v] of Object.entries(titleValues(category, t.title))) {
      if (taken(k, v)) continue;
      values[k] = v;
      origin[k] = { store: t.store, sku: t.sku, from: 'title' };
    }
  }
  // A web e a estimativa: em nome do primeiro anúncio do produto.
  const first = sources[0] ?? titles[0];
  if (web && first) {
    for (const [k, v] of Object.entries(web.values)) {
      if (taken(k, v)) continue;
      values[k] = v;
      origin[k] = { store: first.store, sku: first.sku, from: 'web' };
    }
    for (const [k, v] of Object.entries(estimateSheet(category, values))) {
      if (values[k] !== undefined || !web.asked.has(k)) continue;
      values[k] = v;
      origin[k] = { store: first.store, sku: first.sku, from: 'estimate' };
    }
  }
  const read = sources.find((s) => s.hasSheet);
  // O título que diz que tem ("Com Fans", sem o número) segura o padrão: o campo fica "não sei".
  const blocked = new Set(titles.flatMap((t) => titleBlocksDefault(category, t.title)));
  if (read)
    for (const [k, v] of Object.entries(SHEET_DEFAULTS[category] ?? {})) {
      if (values[k] !== undefined || blocked.has(k)) continue;
      values[k] = v;
      origin[k] = { store: read.store, sku: read.sku, from: 'default' };
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
 * (a dele primeiro, depois a lida há menos tempo), e os títulos. undefined: nenhuma página lida e
 * nada no título.
 */
export function productSheet(db: Db, store: StoreId, sku: string): (ProductSheet & { category: CategoryId }) | undefined {
  const l = db.prepare('SELECT id, category, product_key FROM listings WHERE store = ? AND store_sku = ?').get(store, sku) as
    | { id: number; category: CategoryId; product_key: string | null }
    | undefined;
  if (!l) return undefined;
  const rows = l.product_key
    ? (db.prepare('SELECT store, store_sku, title FROM listings WHERE product_key = ?').all(l.product_key) as { store: StoreId; store_sku: string; title: string }[])
    : (db.prepare('SELECT store, store_sku, title FROM listings WHERE id = ?').all(l.id) as { store: StoreId; store_sku: string; title: string }[]);
  const own = (a: { store: StoreId; sku: string }) => Number(a.store === store && a.sku === sku);
  const sources = sourcesOf(db, l.category, rows).sort((a, b) => own(b) - own(a) || b.at.localeCompare(a.at));
  const titles = rows.map((r) => ({ store: r.store, sku: r.store_sku, title: r.title })).sort((a, b) => own(b) - own(a));
  const key = l.product_key ?? `id:${l.id}`;
  const merged = mergeSources(l.category, sources, titles, webSheets(db, l.category, [key]).get(key), manualSheets(db, l.category, [key]).get(key));
  // Sem página lida: o que o título diz, se diz algo.
  if (!sources.length && !Object.keys(merged.values).length) return undefined;
  return { category: l.category, ...merged, sources };
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
              json_extract(l.offer, '$.marketplace') AS marketplace, json_extract(l.offer, '$.openbox') AS openbox,
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
    marketplace: number | null;
    openbox: number | null;
    fetched_at: string | null;
    has_sheet: number | null;
    page: string | null;
  })[];
  const web = webSheets(db, category);
  const manual = manualSheets(db, category);
  const completed = new Set((db.prepare('SELECT product_key FROM sheet_completion WHERE category = ?').all(category) as { product_key: string }[]).map((r) => r.product_key));
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
    const merged = mergeSources(
      category,
      sources,
      g.map((r) => ({ store: r.store, sku: r.store_sku, title: r.title })),
      web.get(key),
      manual.get(key),
    );
    // Opcionais vazios ("não sei"): só depois de ler alguma página (antes, tudo falta).
    const gaps = sources.length ? missingOptional(category, merged.values) : [];
    const empty = [...merged.missing, ...gaps];
    const completedManually = completed.has(key);
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
        ownRetail: isOwnRetailOffer({ marketplace: !!r.marketplace, openbox: !!r.openbox }),
        firstSeenAt: r.first_seen_at,
        read: r.page !== null,
        ...(r.page !== null && { at: r.fetched_at!, hasSheet: !!r.has_sheet }),
      })),
      completedManually,
      state: completedManually ? 'complete' : !sources.length ? 'unread' : merged.missing.length ? 'incomplete' : 'complete',
      ...merged,
      gaps,
      // Algum campo vazio (principal ou opcional), as páginas todas lidas e a web já perguntada de todos: só uma pessoa completa.
      needsHuman: !completedManually && !!sources.length && empty.length > 0 && g.every((r) => r.page !== null) && empty.every((f) => web.get(key)?.asked.has(f)),
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
      needsHuman: ps.filter((p) => p.needsHuman).length,
      gaps: ps.filter((p) => p.state === 'complete' && p.gaps.length > 0).length,
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
