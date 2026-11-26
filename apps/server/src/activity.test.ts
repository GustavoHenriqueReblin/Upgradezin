import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerBrowserActivity } from './activity.ts';
import { personOf } from './admin/activity.ts';
import { purgeUsage, saveUsage, usageQuery, usageReport, USAGE_RETENTION } from './admin/usage.ts';
import { migrate, openDb } from './db/db.ts';

it('acrescenta o histórico a uma base da versão anterior e preserva as contas', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, 19);
    db.prepare("INSERT INTO accounts (google_sub, email, name) VALUES ('google-1', 'teste@example.com', 'Teste')").run();
    expect(migrate(db)).toEqual([20, 21]);
    expect(migrate(db)).toEqual([]);
    saveUsage(db, 1, { screen: 'home', action: 'view' });
    expect(usageReport(db, usageQuery.parse({})).recent).toMatchObject([{ person: 'teste@example.com' }]);
  } finally {
    db.close();
  }
});

it('completa a migração 20 que não tinha a coluna de produto e mantém os eventos existentes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, 20);
    db.exec('ALTER TABLE usage_events DROP COLUMN product');
    const now = Date.now();
    db.prepare("INSERT INTO usage_events (at, visitor, screen, action) VALUES (?, 'visitante', 'home', 'view')").run(now);
    expect(migrate(db)).toEqual([21]);
    saveUsage(db, 'visitante', { screen: 'product', action: 'view' }, now);
    expect(usageReport(db, usageQuery.parse({}), now).recent).toMatchObject([{ screen: 'product' }, { screen: 'home' }]);
  } finally {
    db.close();
  }
});

it('identifica a conta pela sessão e mantém o ID atual para visitantes e sessões vencidas', async () => {
  const db = openDb(':memory:');
  const app = Fastify();
  try {
    const account = db.prepare("INSERT INTO accounts (google_sub, email, name) VALUES ('google-1', 'teste@example.com', 'Teste') RETURNING id").get() as { id: number };
    const token = 'a'.repeat(43);
    const cookie = `__Host-upgradezin_account=${token}`;
    db.prepare('INSERT INTO account_sessions VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('base64url'), account.id, Date.now() + 90_000);
    registerBrowserActivity(app, () => db, true);
    const send = (payload: object, headers = { 'x-usage': '1', cookie }) =>
      app.inject({ method: 'POST', url: '/api/activity', remoteAddress: '192.0.2.1', headers, payload });
    const event = { screen: 'results', action: 'filter', category: 'gpu', product: 'chave-forjada' };
    expect((await send(event, { 'x-usage': '', cookie })).statusCode).toBe(403);
    expect((await send({ ...event, email: 'forjado@example.com' })).statusCode).toBe(400);
    expect((await send({ screen: 'account', action: 'login' })).statusCode).toBe(400);
    expect((await send(event)).statusCode).toBe(204);
    expect((await send(event, { 'x-usage': '1', cookie: '' })).statusCode).toBe(204);
    db.prepare('UPDATE account_sessions SET expires_at = 0').run();
    expect((await send(event)).statusCode).toBe(204);
    db.prepare('UPDATE accounts SET email = ?').run('novo@example.com');
    const visitor = personOf('192.0.2.1');
    const report = usageReport(db, usageQuery.parse({}));
    expect(report).toMatchObject({ total: 3, accounts: 1, visitors: 1, actions: [{ screen: 'results', action: 'filter', count: 3 }] });
    expect(report.recent.map((row) => [row.person, row.signedIn, row.product])).toEqual([
      [visitor, false, undefined], [visitor, false, undefined], ['novo@example.com', true, undefined],
    ]);
    expect(db.prepare('SELECT visitor FROM usage_events ORDER BY id LIMIT 1').get()).toEqual({ visitor: null });
    expect(usageReport(db, usageQuery.parse({ person: 'NOVO@example.com' })).total).toBe(1);
  } finally {
    await app.close();
    db.close();
  }
});

it('filtra o período, pagina por ordem estável, resolve produtos do catálogo e remove eventos antigos', () => {
  const db = openDb(':memory:');
  try {
    const now = Date.now();
    db.prepare(`INSERT INTO listings (store, store_sku, product_key, category, title, url, model_key, offer, first_seen_at, last_seen_at)
      VALUES ('s1', '1', 'gpu:teste', 'gpu', 'Placa de teste', 'https://s1.example/1', 'k', '{}', '', '')`).run();
    saveUsage(db, 'visitante', { screen: 'home', action: 'view' }, now - USAGE_RETENTION - 1);
    for (let i = 0; i < 51; i++) saveUsage(db, 'visitante', { screen: 'product', action: 'view', product: 'gpu:teste' }, now);
    saveUsage(db, 'visitante', { screen: 'results', action: 'filter' }, now - 2 * 86_400_000);
    const report = usageReport(db, usageQuery.parse({ screen: 'product', action: 'view', days: '1', page: '2' }), now);
    expect(report).toMatchObject({ total: 51, screens: [{ screen: 'product', count: 51 }], actions: [] });
    expect(report.recent).toMatchObject([{ id: 2, product: 'gpu:teste', productTitle: 'Placa de teste' }]);
    expect(usageReport(db, usageQuery.parse({ days: '1' }), now).total).toBe(51);
    purgeUsage(db, now);
    expect(db.prepare('SELECT COUNT(*) AS total FROM usage_events').get()).toEqual({ total: 52 });
  } finally {
    db.close();
  }
});
