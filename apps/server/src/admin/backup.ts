import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import type { BackupFile, MergeReport } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { rereadSheets } from '../prices/sheets.ts';

/** Nome de arquivo de backup aceito (sem caminho: nada fora da pasta). */
const NAME = /^[\w.-]{1,100}\.db(\.gz)?$/;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');

/** Backups em data/backups: listar, criar (cópia consistente, comprimida), baixar, apagar. */
export class Backups {
  constructor(private dir: string) {}

  list(): BackupFile[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((n) => NAME.test(n))
      .map((name) => {
        const st = statSync(join(this.dir, name));
        return { name, sizeMb: Math.round((st.size / 1_048_576) * 10) / 10, at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Cópia consistente do banco (VACUUM INTO), comprimida: <rótulo>-AAAA-MM-DD-HHMMSS.db.gz. */
  async create(db: Db, label = 'manual'): Promise<BackupFile> {
    mkdirSync(this.dir, { recursive: true });
    const base = `${label.replace(/[^\w-]/g, '') || 'backup'}-${stamp()}`;
    const tmp = join(this.dir, `${base}.tmp`);
    try {
      db.prepare('VACUUM INTO ?').run(tmp);
      await pipeline(createReadStream(tmp), createGzip(), createWriteStream(join(this.dir, `${base}.db.gz`)));
    } finally {
      rmSync(tmp, { force: true });
    }
    return this.list().find((b) => b.name === `${base}.db.gz`)!;
  }

  /** Caminho de um backup pelo nome, ou null se o nome não vale ou não existe. */
  path(name: string): string | null {
    if (!NAME.test(name)) return null;
    const p = join(this.dir, name);
    return existsSync(p) ? p : null;
  }

  remove(name: string): boolean {
    const p = this.path(name);
    if (!p) return false;
    rmSync(p);
    return true;
  }
}

/**
 * Banco enviado para merge: descomprime se vier em .gz, confere que é SQLite e guarda num arquivo
 * temporário (apagado depois de aplicar ou de 30 min). Devolve o id para aplicar depois.
 */
export class MergeUploads {
  private files = new Map<string, { path: string; at: number }>();
  constructor(
    private dir: string,
    private ttlMs = 30 * 60_000,
  ) {}

  add(body: Buffer, now = Date.now()): { id: string } | { error: string } {
    this.expire(now);
    let data = body;
    if (body[0] === 0x1f && body[1] === 0x8b) {
      try {
        data = gunzipSync(body);
      } catch {
        return { error: 'Arquivo .gz corrompido.' };
      }
    }
    if (!data.subarray(0, 16).equals(SQLITE_HEADER)) return { error: 'Não é um banco SQLite (.db ou .db.gz).' };
    mkdirSync(this.dir, { recursive: true });
    const id = randomBytes(12).toString('base64url');
    const path = join(this.dir, `merge-${id}.db`);
    writeFileSync(path, data);
    this.files.set(id, { path, at: now });
    return { id };
  }

  get(id: string, now = Date.now()): string | null {
    this.expire(now);
    return this.files.get(id)?.path ?? null;
  }

  drop(id: string): void {
    const f = this.files.get(id);
    if (f) rmSync(f.path, { force: true });
    this.files.delete(id);
  }

  private expire(now: number) {
    for (const [id, f] of this.files) if (now - f.at > this.ttlMs) this.drop(id);
  }
}

const count = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n;

function report(db: Db): MergeReport {
  return {
    newListings: count(db, `SELECT count(*) n FROM src.listings x WHERE NOT EXISTS (SELECT 1 FROM main.listings y WHERE y.store = x.store AND y.store_sku = x.store_sku)`),
    newerListings: count(db, `SELECT count(*) n FROM src.listings x JOIN main.listings y ON y.store = x.store AND y.store_sku = x.store_sku WHERE x.last_seen_at > y.last_seen_at`),
    newPricePoints: count(
      db,
      `SELECT count(*) n FROM src.price_points p JOIN src.listings x ON x.id = p.listing_id
       WHERE NOT EXISTS (SELECT 1 FROM main.listings y JOIN main.price_points q ON q.listing_id = y.id WHERE y.store = x.store AND y.store_sku = x.store_sku AND q.at = p.at)`,
    ),
    newerSheets: count(
      db,
      `SELECT count(*) n FROM src.sheet_pages x LEFT JOIN main.sheet_pages y ON y.store = x.store AND y.store_sku = x.store_sku WHERE y.store IS NULL OR x.fetched_at > y.fetched_at`,
    ),
  };
}

/** Abre a fonte ao lado do banco (ATTACH), roda e fecha. Fonte em outra versão de banco: recusa. */
function withSource<T>(db: Db, source: string, fn: () => T): T {
  db.prepare('ATTACH ? AS src').run(source);
  try {
    const main = (db.prepare('PRAGMA main.user_version').get() as { user_version: number }).user_version;
    const src = (db.prepare('PRAGMA src.user_version').get() as { user_version: number }).user_version;
    if (main !== src) throw new Error(`O banco enviado está na migração ${src} e o do servidor na ${main}: atualize o mais antigo antes.`);
    return fn();
  } finally {
    db.exec('DETACH src');
  }
}

/** O que o merge traria, sem gravar nada. */
export const previewMerge = (db: Db, source: string): MergeReport => withSource(db, source, () => report(db));

/**
 * Junta no banco o que só a fonte tem: anúncios (a oferta vista por último vale), histórico de
 * preço nos instantes que faltam e fichas técnicas. Não mexe em meta (pausas, varredura), lojas, consultas nem
 * montagens. Uma transação só. Devolve o que entrou.
 */
export function applyMerge(db: Db, source: string): MergeReport {
  return withSource(db, source, () => {
    const before = report(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`INSERT INTO main.listings (store, store_sku, category, title, url, model_key, ean, mpn, offer, first_seen_at, last_seen_at)
        SELECT store, store_sku, category, title, url, model_key, ean, mpn, offer, first_seen_at, last_seen_at FROM src.listings x
        WHERE NOT EXISTS (SELECT 1 FROM main.listings y WHERE y.store = x.store AND y.store_sku = x.store_sku)`);
      db.exec(`UPDATE main.listings AS y SET title = x.title, url = x.url, model_key = x.model_key, ean = coalesce(x.ean, y.ean), mpn = coalesce(x.mpn, y.mpn),
          offer = x.offer, last_seen_at = x.last_seen_at
        FROM src.listings x WHERE y.store = x.store AND y.store_sku = x.store_sku AND x.last_seen_at > y.last_seen_at`);
      db.exec(`UPDATE main.listings AS y SET first_seen_at = x.first_seen_at
        FROM src.listings x WHERE y.store = x.store AND y.store_sku = x.store_sku AND x.first_seen_at < y.first_seen_at`);
      db.exec(`INSERT OR IGNORE INTO main.price_points (listing_id, at, price_cash, price_card, effective_cash, coupon, promo, in_stock)
        SELECT y.id, p.at, p.price_cash, p.price_card, p.effective_cash, p.coupon, p.promo, p.in_stock
        FROM src.price_points p JOIN src.listings x ON x.id = p.listing_id JOIN main.listings y ON y.store = x.store AND y.store_sku = x.store_sku`);
      // Páginas de ficha: o texto entra; os campos são relidos depois (rereadSheets), com o leitor deste servidor.
      db.exec(`INSERT INTO main.sheet_pages (store, store_sku, category, text, fetched_at) SELECT store, store_sku, category, text, fetched_at FROM src.sheet_pages WHERE true
        ON CONFLICT (store, store_sku) DO UPDATE SET category = excluded.category, text = excluded.text, fetched_at = excluded.fetched_at WHERE excluded.fetched_at > fetched_at`);
      if (db.prepare('PRAGMA main.foreign_key_check').all().length) throw new Error('Referência quebrada depois do merge.');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (before.newerSheets) rereadSheets(db, true);
    return before;
  });
}
