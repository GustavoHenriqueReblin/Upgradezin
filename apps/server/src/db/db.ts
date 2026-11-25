import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from './sqlite.ts';

/**
 * Banco local (SQLite embutido no Node, sem dependência nativa): anúncios das lojas,
 * histórico de preço, termos da rotina e montagens compartilhadas (docs/ARCHITECTURE.md §8).
 */

/**
 * Migração que recria uma tabela referenciada por outras: roda com as chaves estrangeiras
 * desligadas (senão apagar a tabela antiga apagaria em cascata o que aponta para ela) e
 * confere a integridade no fim (procedimento da documentação do SQLite).
 */
interface Rebuild {
  rebuild: string;
}

/** Cada posição é uma versão (PRAGMA user_version). Só acrescentar no fim; nunca editar uma que já rodou. */
const MIGRATIONS: (string | Rebuild)[] = [
  // 1: tabela meta (e um catálogo de peças importado, removido na 5)
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Uma peça (produto) do catálogo, já com as specs no formato do app.
  CREATE TABLE parts (
    id           TEXT PRIMARY KEY,          -- "<fonte>:<id na fonte>"
    source       TEXT NOT NULL,             -- "opendb"
    source_id    TEXT NOT NULL,
    category     TEXT NOT NULL,             -- CategoryId
    name         TEXT NOT NULL,
    manufacturer TEXT,
    series       TEXT,
    variant      TEXT,
    release_year INTEGER,
    model_key    TEXT NOT NULL,             -- agrupa versões do mesmo modelo
    specs        TEXT NOT NULL,             -- JSON (Specs)
    raw          TEXT NOT NULL,             -- registro original, para reprocessar sem baixar de novo
    imported_at  TEXT NOT NULL
  );
  CREATE INDEX parts_category ON parts (category, model_key);

  -- Códigos para casar anúncio de loja com peça: EAN (13 dígitos) e part number normalizado.
  CREATE TABLE part_codes (
    part_id TEXT NOT NULL REFERENCES parts (id) ON DELETE CASCADE,
    type    TEXT NOT NULL,                  -- "ean" | "mpn"
    code    TEXT NOT NULL,
    PRIMARY KEY (part_id, type, code)
  );
  CREATE INDEX part_codes_code ON part_codes (type, code);
  `,
  // 2: preços coletados pela rotina (e pela busca, quando o termo ainda não tem coleta)
  `
  -- Termos que a rotina mantém (os do formulário de busca + os que alguém pesquisou).
  CREATE TABLE search_terms (
    id                INTEGER PRIMARY KEY,
    category          TEXT NOT NULL,
    term              TEXT NOT NULL,        -- como vai para a loja (ex. "750W", "B550")
    origin            TEXT NOT NULL,        -- "seed" | "user"
    created_at        TEXT NOT NULL,
    last_requested_at TEXT                  -- última busca de alguém no site
  );
  CREATE UNIQUE INDEX search_terms_key ON search_terms (category, lower(term));

  -- Última coleta de cada termo em cada loja.
  CREATE TABLE term_runs (
    term_id     INTEGER NOT NULL REFERENCES search_terms (id) ON DELETE CASCADE,
    store       TEXT NOT NULL,
    last_try_at TEXT NOT NULL,              -- última tentativa (com ou sem sucesso)
    last_ok_at  TEXT,                       -- última coleta completa: o resultado do termo é o desta coleta
    status      TEXT NOT NULL,              -- "ok" | "partial" | "blocked" | "error" | "redirect" (ver redirect_path)
    count       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (term_id, store)
  );

  -- Um anúncio de uma loja (produto na loja), com a última oferta vista.
  CREATE TABLE listings (
    id            INTEGER PRIMARY KEY,
    store         TEXT NOT NULL,
    store_sku     TEXT NOT NULL,
    category      TEXT NOT NULL,
    title         TEXT NOT NULL,
    url           TEXT NOT NULL,
    model_key     TEXT NOT NULL,
    ean           TEXT,
    mpn           TEXT,
    part_id       TEXT REFERENCES parts (id) ON DELETE SET NULL,  -- peça do catálogo, casada por EAN/part number
    offer         TEXT NOT NULL,            -- JSON (Offer) da última coleta
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX listings_key ON listings (store, store_sku);
  CREATE INDEX listings_model ON listings (category, model_key);

  -- Em quais termos o anúncio apareceu, e quando por último.
  CREATE TABLE listing_terms (
    listing_id   INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    term_id      INTEGER NOT NULL REFERENCES search_terms (id) ON DELETE CASCADE,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (term_id, listing_id)
  );

  -- Histórico: um ponto quando preço, cupom, oferta ou estoque mudam (não a cada coleta).
  CREATE TABLE price_points (
    listing_id     INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    at             TEXT NOT NULL,
    price_cash     REAL NOT NULL,
    price_card     REAL,
    effective_cash REAL NOT NULL,           -- à vista com cupom
    coupon         TEXT,                    -- JSON (Coupon)
    promo          TEXT,                    -- JSON (oferta temporária)
    in_stock       INTEGER NOT NULL,
    PRIMARY KEY (listing_id, at)
  );
  `,
  // 3: montagens compartilhadas por link
  `
  CREATE TABLE shared_builds (
    id         TEXT PRIMARY KEY,            -- código curto do link (/m/<id>)
    data       TEXT NOT NULL,               -- JSON da montagem (peças, ofertas, quantidade)
    created_at TEXT NOT NULL
  );
  `,
  // 4: a mesma montagem compartilhada de novo reaproveita o link
  `
  ALTER TABLE shared_builds ADD COLUMN hash TEXT;
  CREATE INDEX shared_builds_hash ON shared_builds (hash);
  `,
  // 5: sai o catálogo de peças importado (o app usa só o que as lojas mostram): tabelas,
  // ligação dos anúncios com ele e as marcas da importação
  {
    rebuild: `
  CREATE TABLE listings_new (
    id            INTEGER PRIMARY KEY,
    store         TEXT NOT NULL,
    store_sku     TEXT NOT NULL,
    category      TEXT NOT NULL,
    title         TEXT NOT NULL,
    url           TEXT NOT NULL,
    model_key     TEXT NOT NULL,
    ean           TEXT,                     -- código de barras que a loja mostra
    mpn           TEXT,                     -- part number que a loja mostra
    offer         TEXT NOT NULL,            -- JSON (Offer) da última coleta
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  );
  INSERT INTO listings_new (id, store, store_sku, category, title, url, model_key, ean, mpn, offer, first_seen_at, last_seen_at)
    SELECT id, store, store_sku, category, title, url, model_key, ean, mpn, offer, first_seen_at, last_seen_at FROM listings;
  DROP TABLE listings;
  ALTER TABLE listings_new RENAME TO listings;
  CREATE UNIQUE INDEX listings_key ON listings (store, store_sku);
  CREATE INDEX listings_model ON listings (category, model_key);
  DROP TABLE part_codes;
  DROP TABLE parts;
  DELETE FROM meta WHERE substr(key, 1, 7) = 'opendb_';
  `,
  },
  // 6: ficha técnica da página do produto (medidas físicas e part number), lida sob demanda
  `
  CREATE TABLE product_sheets (
    store      TEXT NOT NULL,
    store_sku  TEXT NOT NULL,
    data       TEXT NOT NULL,               -- JSON (SpecSheet); {"specs":{}} quando a página não tem ficha
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (store, store_sku)
  );
  `,
  // 7: configuração das lojas (antes STORE_* no .env), editada no admin
  `
  CREATE TABLE store_configs (
    id         TEXT PRIMARY KEY,               -- s1, s2, s3
    enabled    INTEGER NOT NULL,               -- 0 = desligada (fora das buscas e da rotina)
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,                  -- origem do site
    search     TEXT NOT NULL,                  -- caminho da busca com marcador
    categories TEXT NOT NULL,                  -- JSON { categoria: caminho na loja }
    sweep      TEXT NOT NULL,                  -- JSON { categoria: /caminho da página }
    colors     TEXT NOT NULL,                  -- JSON ["#rrggbb", …]
    updated_at TEXT NOT NULL
  );
  `,
  // 8: cada consulta a uma loja (termo, página de varredura, ficha técnica), para o admin
  // (painel das lojas, histórico de bloqueios, logs ao vivo); guardadas por 90 dias
  `
  CREATE TABLE store_attempts (
    id       INTEGER PRIMARY KEY,
    store    TEXT NOT NULL,
    at       TEXT NOT NULL,                 -- fim da consulta
    kind     TEXT NOT NULL,                 -- "term" | "sweep" | "sheet"
    origin   TEXT NOT NULL,                 -- "search" | "routine" | "admin"
    category TEXT,
    term     TEXT,                          -- termo, ou código do produto na ficha técnica
    page     INTEGER,                       -- página da varredura
    status   TEXT NOT NULL,                 -- "ok" | "partial" | "blocked" | "limit" | "error"
    count    INTEGER NOT NULL DEFAULT 0,    -- ofertas lidas
    reason   TEXT,                          -- motivo do bloqueio (BlockReason)
    detail   TEXT,                          -- mensagem curta (bloqueio, erro)
    ms       INTEGER NOT NULL               -- duração
  );
  CREATE INDEX store_attempts_store_at ON store_attempts (store, at);
  CREATE INDEX store_attempts_at ON store_attempts (at);
  `,
  // 9: termo que a busca da loja redireciona para outra página (ex. a da categoria): o endereço
  // de destino, aberto direto nas próximas coletas desse termo nessa loja
  `
  ALTER TABLE term_runs ADD COLUMN redirect_path TEXT;
  `,
  // 10: lista de produtos do admin (paginada, do visto há menos tempo) e cobertura por frescor
  `
  CREATE INDEX listings_seen ON listings (last_seen_at, id);
  `,
  // 11: mesmo produto em lojas diferentes (prices/identity.ts): exato (mesmo part number: a ficha vale
  // para os dois) e grupo (para mostrar junto). Recalculado depois das coletas.
  `
  ALTER TABLE listings ADD COLUMN product_key TEXT;
  ALTER TABLE listings ADD COLUMN group_key TEXT;
  CREATE INDEX listings_product ON listings (product_key);
  `,
  // 12: saem os termos (a rotina lê as páginas de categoria das lojas; a busca do formulário responde
  // pelo banco e só o texto livre vai às lojas, sem nada guardado por termo)
  `
  DROP TABLE listing_terms;
  DROP TABLE term_runs;
  DROP TABLE search_terms;
  `,
  // 13: fichas técnicas refeitas: a página lida guarda o texto da ficha; os campos de cada categoria
  // ficam em sheet_<categoria>, uma coluna por campo (criadas por syncSheetTables, prices/sheets.ts)
  `
  DROP TABLE product_sheets;
  CREATE TABLE sheet_pages (
    store      TEXT NOT NULL,
    store_sku  TEXT NOT NULL,
    category   TEXT NOT NULL,
    text       TEXT,                        -- texto da ficha (sheetText); null: a página não tinha ficha
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (store, store_sku)
  );
  DELETE FROM meta WHERE key = 'sheet-reader';
  `,
  // 14: página de produto que dá erro sem ser bloqueio (prices/page-errors.ts): fora da fila de fichas
  // por um tempo e, com falhas seguidas, a oferta sai do app até a página abrir de novo
  `
  CREATE TABLE page_errors (
    store     TEXT NOT NULL,
    store_sku TEXT NOT NULL,
    fails     INTEGER NOT NULL,             -- falhas seguidas
    last_at   TEXT NOT NULL,                -- última falha
    detail    TEXT,                         -- mensagem do erro
    PRIMARY KEY (store, store_sku)
  );
  `,
  // 15: conclusão manual de uma ficha, sem preencher os campos que faltam.
  `
  CREATE TABLE sheet_completion (
    category    TEXT NOT NULL,
    product_key TEXT NOT NULL,
    PRIMARY KEY (category, product_key)
  );
  `,
  // 16: estado da ficha no momento de cada resposta da web.
  `
  CREATE TABLE sheet_web_transition (
    product_key TEXT NOT NULL,
    asked_at TEXT NOT NULL,
    before_state TEXT NOT NULL,
    after_state TEXT NOT NULL,
    PRIMARY KEY (product_key, asked_at)
  );
  `,
  // 17: contas, sessões e dados privados do app.
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE account_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE account_login_attempts (
    state_hash TEXT PRIMARY KEY,
    verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE account_data (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (account_id, key)
  );
  `,
  // 18: CEP opcional para consultas de entrega vinculadas à conta.
  `
  ALTER TABLE accounts ADD COLUMN cep TEXT;
  `,
];

export type Db = DatabaseSync;

/** Migra até a versão `to` (padrão: a última). Devolve as versões que rodaram agora. */
export function migrate(db: Db, to = MIGRATIONS.length): number[] {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const ran: number[] = [];
  for (let v = current; v < to; v++) {
    const m = MIGRATIONS[v]!;
    const rebuild = typeof m !== 'string';
    if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(rebuild ? m.rebuild : m);
      if (rebuild && db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migração ${v + 1}: referência quebrada`);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (rebuild) db.exec('PRAGMA foreign_keys = ON');
    }
    ran.push(v + 1);
  }
  return ran;
}

/** Versão em que o catálogo importado saiu: depois dela, o banco é compactado uma vez. */
export const DROP_CATALOG = 5;

/** Abre (e cria, se preciso) o banco já migrado. ":memory:" nos testes. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // Compactar depois de apagar o catálogo: devolve o espaço e não deixa sobra dele no arquivo.
  if (migrate(db).includes(DROP_CATALOG)) db.exec('VACUUM');
  return db;
}

export function getMeta(db: Db, key: string): string | undefined {
  return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

export function deleteMeta(db: Db, key: string): void {
  db.prepare('DELETE FROM meta WHERE key = ?').run(key);
}

/** Todas as chaves que começam com o prefixo. */
export function metaByPrefix(db: Db, prefix: string): [string, string][] {
  const rows = db.prepare('SELECT key, value FROM meta WHERE substr(key, 1, length(?)) = ?').all(prefix, prefix) as { key: string; value: string }[];
  return rows.map((r) => [r.key, r.value]);
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}
