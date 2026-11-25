import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ALERT_LIMIT, type Offer, type StoreId } from '@upgradezin/shared';
import { checkPriceAlerts, NOTIFICATION_KEEP, registerAlertRoutes } from './alerts.ts';
import { openDb, type Db } from './db/db.ts';
import { saveCollection } from './prices/prices.ts';

const STORES: StoreId[] = ['s1', 's2'];
const KEY = 'gpu:rtx5060';
const offer = (store: StoreId, sku: string, priceCash: number, inStock = true): Offer =>
  ({ store, storeSku: sku, title: `Placa RTX 5060 ${store}`, url: `https://${store}.example/${sku}`, priceCash, inStock, specs: {}, modelKey: `m${sku}`, collectedAt: '' }) as Offer;

let clock = Date.parse('2026-11-25T12:00:00.000Z');
/** Grava os preços de agora das duas lojas para o mesmo produto. */
function prices(db: Db, s1: number | undefined, s2?: number) {
  clock += 60_000;
  const at = new Date(clock).toISOString();
  saveCollection(db, { store: 's1', category: 'gpu', offers: [offer('s1', 'a', s1 ?? 9999, s1 !== undefined)], at });
  saveCollection(db, { store: 's2', category: 'gpu', offers: [offer('s2', 'b', s2 ?? 9999, s2 !== undefined)], at });
  db.prepare("UPDATE listings SET product_key = ? WHERE store_sku IN ('a', 'b')").run(KEY);
}

const TOKEN = 'a'.repeat(43);
const OTHER = 'b'.repeat(43);
const digest = (v: string) => createHash('sha256').update(v).digest('base64url');
function setup() {
  const db = openDb(':memory:');
  for (const [i, token] of [TOKEN, OTHER].entries()) {
    db.prepare('INSERT INTO accounts (id, google_sub, email, name) VALUES (?, ?, ?, ?)').run(i + 1, `sub${i}`, `p${i}@example.com`, `P${i}`);
    db.prepare('INSERT INTO account_sessions VALUES (?, ?, ?)').run(digest(token), i + 1, Date.now() + 3_600_000);
  }
  prices(db, 2000, 2100);
  const app = Fastify();
  registerAlertRoutes(app, () => db, STORES, true);
  const as = (token: string, i: number) => ({ cookie: `__Host-upgradezin_account=${token}`, 'x-account': '1', 'x-account-id': digest(`sub${i}`) });
  return { db, app, me: as(TOKEN, 0), other: as(OTHER, 1) };
}

describe('alertas de preço no servidor', () => {
  it('a rotina confere depois da coleta e grava a notificação; o site só lê', async () => {
    const { db, app, me, other } = setup();
    try {
      const put = (payload: object, headers = me) => app.inject({ method: 'PUT', url: '/api/account/alerts', headers, payload });
      const read = async (headers = me) => (await app.inject({ url: '/api/account/alerts', headers })).json();
      expect((await app.inject({ url: '/api/account/alerts' })).statusCode).toBe(401);
      expect((await put({ key: KEY, kind: 'target' })).statusCode).toBe(400); // sem valor
      expect((await put({ key: 'gpu:nada', kind: 'stock' })).statusCode).toBe(404);
      expect((await put({ key: KEY, kind: 'target', target: 1800 }, { ...me, 'x-account': '' })).statusCode).toBe(403);
      expect((await put({ key: KEY, kind: 'target', target: 1800 }, { ...me, 'x-account-id': 'x' })).statusCode).toBe(409);

      // Título, categoria e preço vêm do banco; a queda parte do preço de agora.
      expect((await put({ key: KEY, kind: 'target', target: 1800 })).json().alert).toMatchObject({ title: 'Placa RTX 5060 s1', category: 'gpu', price: 2000, armed: true });
      expect((await put({ key: KEY, kind: 'drop' }, other)).json().alert).toMatchObject({ base: 2000 });

      expect(checkPriceAlerts(db, STORES)).toBe(0);
      prices(db, 1900, 2100); // caiu, mas não chegou no alvo
      expect(checkPriceAlerts(db, STORES, { now: 1000 })).toBe(1); // só a queda
      prices(db, 2050, 1750); // a outra loja ficou mais barata
      expect(checkPriceAlerts(db, STORES, { now: 2000 })).toBe(2);
      expect(checkPriceAlerts(db, STORES, { now: 3000 })).toBe(0); // mesmo preço: não repete

      const mine = await read();
      expect(mine.alerts).toEqual([expect.objectContaining({ key: KEY, kind: 'target', price: 1750, armed: false, checkedAt: 3000 })]);
      expect(mine.notifications).toEqual([{ id: expect.any(Number), key: KEY, category: 'gpu', title: 'Placa RTX 5060 s1', kind: 'target', price: 1750, reference: 1800, at: 2000, read: false }]);
      expect((await read(other)).notifications.map((n: { price: number; reference: number }) => [n.price, n.reference])).toEqual([[1750, 1900], [1900, 2000]]);

      // Abrir o sino marca como lidas só as da própria conta.
      expect((await app.inject({ method: 'POST', url: '/api/account/notifications/read', headers: me })).statusCode).toBe(204);
      expect((await read()).notifications[0].read).toBe(true);
      expect((await read(other)).notifications.every((n: { read: boolean }) => !n.read)).toBe(true);

      // Produto sumiu do banco: o alerta fica como estava.
      db.exec('DELETE FROM listings');
      expect(checkPriceAlerts(db, STORES, { now: 4000 })).toBe(0);
      expect((await read()).alerts[0].checkedAt).toBe(3000);

      expect((await app.inject({ method: 'DELETE', url: `/api/account/alerts/${encodeURIComponent(KEY)}`, headers: me })).statusCode).toBe(204);
      expect((await read()).alerts).toEqual([]);
      expect((await read(other)).alerts).toHaveLength(1);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('preço já no alvo ao criar não avisa; queda pede estoque; limite por conta e notificações antigas saem', async () => {
    const { db, app, me } = setup();
    try {
      const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/account/alerts', headers: me, payload });
      expect((await put({ key: KEY, kind: 'target', target: 2500 })).json().alert.armed).toBe(false);
      expect(checkPriceAlerts(db, STORES)).toBe(0);
      prices(db, undefined, undefined);
      expect((await put({ key: KEY, kind: 'drop' })).json()).toEqual({ error: 'no-stock' });

      for (let i = 1; i < ALERT_LIMIT; i++) {
        db.prepare("INSERT INTO price_alerts (account_id, product_key, category, title, kind, created_at) VALUES (1, ?, 'gpu', 'x', 'stock', 0)").run(`gpu:${i}`);
      }
      expect((await put({ key: KEY, kind: 'stock' })).statusCode).toBe(200); // trocar o do mesmo produto não conta
      saveCollection(db, { store: 's1', category: 'gpu', offers: [offer('s1', 'z', 500)], at: new Date(clock).toISOString() });
      db.exec("UPDATE listings SET product_key = 'gpu:novo' WHERE store_sku = 'z'");
      expect((await put({ key: 'gpu:novo', kind: 'stock' })).statusCode).toBe(409);

      const notify = db.prepare("INSERT INTO notifications (account_id, product_key, category, title, kind, created_at) VALUES (1, ?, 'gpu', 'x', 'stock', 0)");
      for (let i = 0; i < NOTIFICATION_KEEP + 5; i++) notify.run(`gpu:${i}`);
      prices(db, 2000);
      expect(checkPriceAlerts(db, STORES)).toBe(1); // o de estoque voltou
      expect((db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n).toBe(NOTIFICATION_KEEP);
    } finally {
      await app.close();
      db.close();
    }
  });
});
