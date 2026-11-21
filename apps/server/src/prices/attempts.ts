import { EventEmitter } from 'node:events';
import type { AttemptKind, AttemptOrigin, AttemptStatus, StoreAttempt, StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';

/**
 * Cada consulta a uma loja (termo, página de varredura, ficha técnica): quando, de onde veio,
 * como terminou. Base do painel das lojas, do histórico de bloqueios e dos logs ao vivo do admin.
 * Guardadas por KEEP_DAYS.
 */

export const KEEP_DAYS = 90;
/** A cada tantas gravações, apaga as mais velhas que KEEP_DAYS. */
const PRUNE_EVERY = 200;

export type NewAttempt = Omit<StoreAttempt, 'id'>;

const bus = new EventEmitter();
bus.setMaxListeners(0);
/** Avisa quem escuta (logs ao vivo do admin) a cada consulta gravada. */
export function onAttempt(fn: (a: StoreAttempt) => void): () => void {
  bus.on('attempt', fn);
  return () => bus.off('attempt', fn);
}

let sincePrune = 0;

export function recordAttempt(db: Db, a: NewAttempt): StoreAttempt {
  const r = db
    .prepare(
      `INSERT INTO store_attempts (store, at, kind, origin, category, term, page, status, count, reason, detail, ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.store, a.at, a.kind, a.origin, a.category ?? null, a.term ?? null, a.page ?? null, a.status, a.count, a.reason ?? null, a.detail?.slice(0, 200) ?? null, Math.round(a.ms));
  if (++sincePrune >= PRUNE_EVERY) {
    sincePrune = 0;
    db.prepare('DELETE FROM store_attempts WHERE at < ?').run(new Date(Date.parse(a.at) - KEEP_DAYS * 86_400_000).toISOString());
  }
  const saved: StoreAttempt = { id: Number(r.lastInsertRowid), ...a };
  bus.emit('attempt', saved);
  return saved;
}

interface Row {
  id: number;
  store: string;
  at: string;
  kind: string;
  origin: string;
  category: string | null;
  term: string | null;
  page: number | null;
  status: string;
  count: number;
  reason: string | null;
  detail: string | null;
  ms: number;
}

const fromRow = (r: Row): StoreAttempt => ({
  id: r.id,
  store: r.store as StoreId,
  at: r.at,
  kind: r.kind as AttemptKind,
  origin: r.origin as AttemptOrigin,
  status: r.status as AttemptStatus,
  count: r.count,
  ms: r.ms,
  ...(r.category ? { category: r.category as StoreAttempt['category'] } : {}),
  ...(r.term ? { term: r.term } : {}),
  ...(r.page != null ? { page: r.page } : {}),
  ...(r.reason ? { reason: r.reason as StoreAttempt['reason'] } : {}),
  ...(r.detail ? { detail: r.detail } : {}),
});

/** Consultas mais recentes primeiro, com filtros. `before`: id, para paginar. */
export function listAttempts(
  db: Db,
  f: { store?: StoreId; status?: AttemptStatus; origin?: AttemptOrigin; since?: string; before?: number; limit?: number } = {},
): StoreAttempt[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.store) where.push('store = ?'), args.push(f.store);
  if (f.status) where.push('status = ?'), args.push(f.status);
  if (f.origin) where.push('origin = ?'), args.push(f.origin);
  if (f.since) where.push('at >= ?'), args.push(f.since);
  if (f.before) where.push('id < ?'), args.push(f.before);
  const rows = db
    .prepare(`SELECT * FROM store_attempts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
    .all(...args, Math.min(Math.max(f.limit ?? 100, 1), 500)) as unknown as Row[];
  return rows.map(fromRow);
}

/** Última consulta da loja com um dos status (ex. última coleta boa, último bloqueio). */
export function lastAttempt(db: Db, store: StoreId, statuses: AttemptStatus[]): StoreAttempt | null {
  const row = db
    .prepare(`SELECT * FROM store_attempts WHERE store = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`)
    .get(store, ...statuses) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Contagem por status da loja desde `since`. */
export function attemptCounts(db: Db, store: StoreId, since: string): Partial<Record<AttemptStatus, number>> {
  const rows = db.prepare('SELECT status, count(*) AS n FROM store_attempts WHERE store = ? AND at >= ? GROUP BY status').all(store, since) as {
    status: AttemptStatus;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
