import { ACTIVITY_ACTIONS, ACTIVITY_SCREENS, CATEGORIES, STORES, type ActivityEvent, type ActivityScreen, type UsageReport } from '@upgradezin/shared';
import { z } from 'zod';
import type { Db } from '../db/db.ts';
import type { FastifyBaseLogger } from 'fastify';

const DAY = 86_400_000;
export const USAGE_RETENTION = 90 * DAY;
export const USAGE_PAGE_SIZE = 50;
export const usageScreen = z.enum(Object.keys(ACTIVITY_SCREENS) as ActivityScreen[]);
const usageAction = z.enum(Object.keys(ACTIVITY_ACTIONS) as ActivityEvent['action'][]);

export const browserEvent = z.strictObject({
  screen: usageScreen,
  action: usageAction.exclude(['login', 'logout', 'alertSave', 'alertRemove', 'budgetRun', 'budgetEmpty']),
  category: z.enum(CATEGORIES).optional(),
  mode: z.enum(['full', 'upgrade']).optional(),
  store: z.enum(STORES).optional(),
  product: z.string().min(1).max(256).optional(),
});

export const usageQuery = z.object({
  days: z.enum(['1', '7', '30', '90']).default('7'),
  person: z.string().trim().max(254).default(''),
  screen: usageScreen.optional(),
  action: usageAction.optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

export function saveUsage(db: Db, actor: number | string, event: ActivityEvent, now = Date.now()): void {
  const product = event.product && db.prepare('SELECT 1 FROM listings WHERE product_key = ? LIMIT 1').get(event.product) ? event.product : null;
  db.prepare('INSERT INTO usage_events (at, account_id, visitor, screen, action, category, mode, store, product) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(now, typeof actor === 'number' ? actor : null, typeof actor === 'string' ? actor : null,
      event.screen, event.action, event.category ?? null, event.mode ?? null, event.store ?? null, product);
}

export function purgeUsage(db: Db, now = Date.now()): void {
  db.prepare('DELETE FROM usage_events WHERE at < ?').run(now - USAGE_RETENTION);
}

export function recordUsage(db: Db, actor: number | string, event: ActivityEvent, log: FastifyBaseLogger): void {
  try {
    saveUsage(db, actor, event);
  } catch {
    log.warn('Não foi possível registrar uma atividade.');
  }
}

type UsageRow = {
  id: number; at: number; person: string; account_id: number | null;
  screen: ActivityScreen; action: ActivityEvent['action'];
  category: ActivityEvent['category'] | null; mode: ActivityEvent['mode'] | null; store: ActivityEvent['store'] | null;
  product: string | null; product_title: string | null;
};

export function usageReport(db: Db, query: z.infer<typeof usageQuery>, now = Date.now()): UsageReport {
  const { days, person, screen, action, page } = query;
  const from = `FROM usage_events e LEFT JOIN accounts a ON a.id = e.account_id
    WHERE e.at >= ?${person ? ' AND (e.visitor = ? OR a.email = ? COLLATE NOCASE)' : ''}
    ${screen ? ' AND e.screen = ?' : ''}${action ? ' AND e.action = ?' : ''}`;
  const args = [now - Number(days) * DAY, ...(person ? [person, person] : []), ...(screen ? [screen] : []), ...(action ? [action] : [])];
  const summary = db.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT e.account_id) AS accounts,
    COUNT(DISTINCT e.visitor) AS visitors ${from}`).get(...args) as Pick<UsageReport, 'total' | 'accounts' | 'visitors'>;
  const screens = db.prepare(`SELECT e.screen, COUNT(*) AS count ${from} AND e.action = 'view'
    GROUP BY e.screen ORDER BY count DESC, e.screen`).all(...args) as UsageReport['screens'];
  const actions = db.prepare(`SELECT e.screen, e.action, COUNT(*) AS count ${from} AND e.action <> 'view'
    GROUP BY e.screen, e.action ORDER BY count DESC, e.screen, e.action`).all(...args) as UsageReport['actions'];
  const rows = db.prepare(`SELECT e.*, COALESCE(a.email, e.visitor) AS person,
    (SELECT title FROM listings WHERE product_key = e.product ORDER BY id LIMIT 1) AS product_title ${from}
    ORDER BY e.at DESC, e.id DESC LIMIT ? OFFSET ?`).all(...args, USAGE_PAGE_SIZE, (page - 1) * USAGE_PAGE_SIZE) as UsageRow[];
  return {
    ...summary, screens, actions, pageSize: USAGE_PAGE_SIZE,
    recent: rows.map((r) => ({
      id: r.id, at: new Date(r.at).toISOString(), person: r.person, signedIn: r.account_id !== null,
      screen: r.screen, action: r.action, category: r.category ?? undefined, mode: r.mode ?? undefined, store: r.store ?? undefined,
      product: r.product ?? undefined, productTitle: r.product_title ?? undefined,
    })),
  };
}
