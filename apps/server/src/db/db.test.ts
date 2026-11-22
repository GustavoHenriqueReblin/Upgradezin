import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DROP_CATALOG, migrate, openDb } from './db.ts';

describe('migrações', () => {
  it('banco novo chega na última versão', () => {
    const db = openDb(':memory:');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['meta', 'listings', 'price_points', 'product_sheets', 'store_configs', 'store_attempts', 'shared_builds']));
    for (const t of ['parts', 'search_terms', 'term_runs', 'listing_terms']) expect(tables).not.toContain(t);
    expect(tables).not.toContain('parts');
    expect(tables).not.toContain('part_codes');
  });

  it('tirar o catálogo importado não apaga anúncios, histórico nem termos', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, DROP_CATALOG - 1);
    db.exec(`
      INSERT INTO meta VALUES ('opendb_imported_at', 'x'), ('backoff:s2', '{}');
      INSERT INTO parts (id, source, source_id, category, name, model_key, specs, raw, imported_at) VALUES ('p:1', 'p', '1', 'psu', 'P', 'k', '{}', '{}', '');
      INSERT INTO part_codes VALUES ('p:1', 'mpn', 'X');
      INSERT INTO search_terms (id, category, term, origin, created_at) VALUES (1, 'psu', '750W', 'seed', '');
      INSERT INTO listings (id, store, store_sku, category, title, url, model_key, ean, mpn, part_id, offer, first_seen_at, last_seen_at)
        VALUES (7, 's1', 'a', 'psu', 'Fonte', 'u', 'k', '7890000000000', 'X', 'p:1', '{}', 't', 't');
      INSERT INTO listing_terms VALUES (7, 1, 't');
      INSERT INTO price_points (listing_id, at, price_cash, effective_cash, in_stock) VALUES (7, 't1', 400, 400, 1), (7, 't2', 380, 380, 1);
    `);
    expect(migrate(db, DROP_CATALOG)).toContain(DROP_CATALOG);
    expect(db.prepare('SELECT id, ean, mpn FROM listings').all()).toEqual([{ id: 7, ean: '7890000000000', mpn: 'X' }]);
    expect(db.prepare('SELECT count(*) n FROM price_points WHERE listing_id = 7').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT count(*) n FROM listing_terms WHERE listing_id = 7').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT key FROM meta').all()).toEqual([{ key: 'backoff:s2' }]);
    expect(db.prepare("SELECT name FROM pragma_table_info('listings') WHERE name = 'part_id'").all()).toEqual([]);
    // as chaves estrangeiras voltaram a valer: apagar o anúncio leva o histórico junto
    db.exec('DELETE FROM listings WHERE id = 7');
    expect(db.prepare('SELECT count(*) n FROM price_points').get()).toEqual({ n: 0 });
  });

  it('12: saem os termos; anúncios e histórico ficam', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, 11);
    db.exec(`
      INSERT INTO search_terms (id, category, term, origin, created_at) VALUES (1, 'psu', '750W', 'seed', '');
      INSERT INTO listings (id, store, store_sku, category, title, url, model_key, offer, first_seen_at, last_seen_at) VALUES (7, 's1', 'a', 'psu', 'Fonte', 'u', 'k', '{}', 't', 't');
      INSERT INTO listing_terms VALUES (7, 1, 't');
      INSERT INTO term_runs (term_id, store, last_try_at, status) VALUES (1, 's1', 't', 'ok');
      INSERT INTO price_points (listing_id, at, price_cash, effective_cash, in_stock) VALUES (7, 't1', 400, 400, 1);
    `);
    expect(migrate(db)).toEqual([12]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['search_terms', 'term_runs', 'listing_terms']) expect(tables).not.toContain(t);
    expect(db.prepare('SELECT count(*) n FROM listings').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) n FROM price_points').get()).toEqual({ n: 1 });
  });
});
