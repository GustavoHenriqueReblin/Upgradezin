import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ALERT_KINDS, ALERT_LIMIT, alertMet, alertPrice, evaluateAlert, type AlertKind, type AlertNotification, type CategoryId, type PriceAlert, type StoreId,
} from '@upgradezin/shared';
import { requestAccount } from './account.ts';
import type { Db } from './db/db.ts';
import { onCollected } from './prices/events.ts';
import { REBUILD_DELAY_MS } from './prices/identity.ts';
import { productPage } from './prices/product-page.ts';

/**
 * Alertas de preço da conta. A rotina confere o preço dos produtos acompanhados depois das coletas (o preço só muda
 * quando uma coleta grava) e, quando a condição vale, grava uma notificação. O site só lê as notificações.
 */

/** Notificações guardadas por conta (as mais antigas saem). */
export const NOTIFICATION_KEEP = 50;

type AlertRow = {
  account_id: number; product_key: string; category: CategoryId; title: string; kind: AlertKind;
  target: number | null; base: number | null; price: number | null; checked_at: number | null; armed: number; created_at: number;
};
type NotificationRow = {
  id: number; product_key: string; category: CategoryId; title: string; kind: AlertKind; price: number | null; reference: number | null; created_at: number; read_at: number | null;
};

const fromRow = (r: AlertRow): PriceAlert => ({
  key: r.product_key, category: r.category, title: r.title, kind: r.kind, armed: !!r.armed, createdAt: r.created_at,
  ...(r.target !== null && { target: r.target }), ...(r.base !== null && { base: r.base }), ...(r.price !== null && { price: r.price }),
  ...(r.checked_at !== null && { checkedAt: r.checked_at }),
});
const notificationFromRow = (r: NotificationRow): AlertNotification => ({
  id: r.id, key: r.product_key, category: r.category, title: r.title, kind: r.kind, at: r.created_at, read: r.read_at !== null,
  ...(r.price !== null && { price: r.price }), ...(r.reference !== null && { reference: r.reference }),
});

function saveRow(db: Db, accountId: number, a: PriceAlert) {
  db.prepare(`INSERT INTO price_alerts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (account_id, product_key) DO UPDATE SET category = excluded.category, title = excluded.title, kind = excluded.kind, target = excluded.target,
      base = excluded.base, price = excluded.price, checked_at = excluded.checked_at, armed = excluded.armed`)
    .run(accountId, a.key, a.category, a.title, a.kind, a.target ?? null, a.base ?? null, a.price ?? null, a.checkedAt ?? null, a.armed ? 1 : 0, a.createdAt);
}

/**
 * Confere os alertas (todos ou só os da categoria) com os preços do banco, das lojas dadas. Grava o preço visto e, para
 * cada condição que passou a valer, uma notificação. Produto que sumiu do banco fica como estava. Devolve quantas gravou.
 */
export function checkPriceAlerts(db: Db, stores: readonly StoreId[], { category, now = Date.now() }: { category?: CategoryId; now?: number } = {}): number {
  const rows = (category
    ? db.prepare('SELECT * FROM price_alerts WHERE category = ?').all(category)
    : db.prepare('SELECT * FROM price_alerts').all()) as AlertRow[];
  if (!rows.length) return 0;
  const prices = new Map<string, number | undefined | null>();
  for (const key of new Set(rows.map((r) => r.product_key))) {
    const page = productPage(db, key, stores);
    prices.set(key, page ? alertPrice(page.offers) : null);
  }
  const notify = db.prepare('INSERT INTO notifications (account_id, product_key, category, title, kind, price, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const prune = db.prepare(`DELETE FROM notifications WHERE account_id = ? AND id NOT IN
    (SELECT id FROM notifications WHERE account_id = ? ORDER BY id DESC LIMIT ${NOTIFICATION_KEEP})`);
  const notified = new Set<number>();
  let count = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const price = prices.get(row.product_key);
      if (price === null) continue;
      const { alert, fired } = evaluateAlert(fromRow(row), price, now);
      saveRow(db, row.account_id, alert);
      if (!fired) continue;
      notify.run(row.account_id, row.product_key, row.category, row.title, row.kind, fired.price ?? null, fired.reference ?? null, now);
      notified.add(row.account_id);
      count++;
    }
    for (const id of notified) prune.run(id, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return count;
}

/**
 * Confere os alertas um pouco depois de subir e depois de cada coleta da categoria (com folga para as chaves de produto
 * serem recalculadas e para juntar as páginas seguidas da mesma coleta).
 */
export function startAlertChecks(db: () => Db, stores: readonly StoreId[], { firstMs = 20_000, delayMs = REBUILD_DELAY_MS + 15_000 } = {}): () => void {
  const pending = new Map<CategoryId, NodeJS.Timeout>();
  const run = (category?: CategoryId) => {
    try {
      const n = checkPriceAlerts(db(), stores, category ? { category } : {});
      if (n) console.info(`[alertas] ${category ?? 'todas as categorias'}: ${n} notificação(ões) nova(s)`);
    } catch (err) {
      console.error('[alertas]', err);
    }
  };
  const first = setTimeout(() => run(), firstMs);
  const off = onCollected(({ category }) => {
    if (pending.has(category)) return;
    pending.set(category, setTimeout(() => {
      pending.delete(category);
      run(category);
    }, delayMs));
  });
  return () => {
    clearTimeout(first);
    off();
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  };
}

const alertBody = z.object({
  key: z.string().min(1).max(200),
  kind: z.enum(ALERT_KINDS as [AlertKind, ...AlertKind[]]),
  target: z.number().positive().max(1_000_000).optional(),
}).strict();

export function registerAlertRoutes(app: FastifyInstance, getDb: () => Db, stores: readonly StoreId[], enabled: boolean): void {
  const account = (write: boolean) => async (req: Parameters<typeof requestAccount>[1], reply: Parameters<typeof requestAccount>[2]) =>
    enabled ? requestAccount(getDb(), req, reply, write) : void reply.code(404).send({ error: 'disabled' });

  /** Os alertas da conta e as últimas notificações (o sino do site lê daqui). */
  app.get('/api/account/alerts', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await account(false)(req, reply);
    if (!user) return reply;
    const db = getDb();
    const alerts = (db.prepare('SELECT * FROM price_alerts WHERE account_id = ? ORDER BY created_at DESC').all(user.id) as AlertRow[]).map(fromRow);
    const notifications = (db.prepare(`SELECT id, product_key, category, title, kind, price, reference, created_at, read_at FROM notifications
      WHERE account_id = ? ORDER BY id DESC LIMIT ${NOTIFICATION_KEEP}`).all(user.id) as NotificationRow[]).map(notificationFromRow);
    return { alerts, notifications };
  });

  /**
   * Cria ou troca o alerta do produto. Título, categoria e preço vêm do banco (não do pedido). Se a condição já vale ao
   * criar, não avisa (a pessoa está vendo o preço): o alerta fica esperando a condição deixar de valer e voltar.
   */
  app.put('/api/account/alerts', { bodyLimit: 4096 }, async (req, reply) => {
    const user = await account(true)(req, reply);
    if (!user) return reply;
    const input = alertBody.safeParse(req.body);
    if (!input.success || (input.data.kind === 'target' && !input.data.target)) return reply.code(400).send({ error: 'invalid' });
    const { key, kind, target } = input.data;
    const db = getDb();
    const page = productPage(db, key, stores);
    if (!page) return reply.code(404).send({ error: 'not-found' });
    const price = alertPrice(page.offers);
    if (kind === 'drop' && price === undefined) return reply.code(400).send({ error: 'no-stock' });
    const existing = db.prepare('SELECT created_at FROM price_alerts WHERE account_id = ? AND product_key = ?').get(user.id, key) as { created_at: number } | undefined;
    if (!existing && (db.prepare('SELECT COUNT(*) AS n FROM price_alerts WHERE account_id = ?').get(user.id) as { n: number }).n >= ALERT_LIMIT) {
      return reply.code(409).send({ error: 'limit' });
    }
    const now = Date.now();
    const rule = { kind, ...(kind === 'target' && { target }), ...(kind === 'drop' && { base: price }) };
    const alert: PriceAlert = {
      key, category: page.category, title: page.title.slice(0, 200), ...rule, ...(price !== undefined && { price }), checkedAt: now,
      armed: kind === 'drop' || !alertMet(rule, price), createdAt: existing?.created_at ?? now,
    };
    saveRow(db, user.id, alert);
    return { alert };
  });

  app.delete('/api/account/alerts/:key', async (req, reply) => {
    const user = await account(true)(req, reply);
    if (!user) return reply;
    getDb().prepare('DELETE FROM price_alerts WHERE account_id = ? AND product_key = ?').run(user.id, (req.params as { key: string }).key);
    return reply.code(204).send();
  });

  /** A pessoa abriu o sino: as notificações ficam lidas. */
  app.post('/api/account/notifications/read', async (req, reply) => {
    const user = await account(true)(req, reply);
    if (!user) return reply;
    getDb().prepare('UPDATE notifications SET read_at = ? WHERE account_id = ? AND read_at IS NULL').run(Date.now(), user.id);
    return reply.code(204).send();
  });
}
