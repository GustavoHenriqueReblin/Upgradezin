import type { FastifyInstance } from 'fastify';
import { sessionAccount } from './account.ts';
import { personOf } from './admin/activity.ts';
import { browserEvent, purgeUsage, saveUsage } from './admin/usage.ts';
import type { Db } from './db/db.ts';
import { clientIp } from './security.ts';

export function registerBrowserActivity(app: FastifyInstance, getDb: () => Db, loginEnabled: boolean): void {
  app.post('/api/activity', { bodyLimit: 1024 }, async (req, reply) => {
    if (req.headers['x-usage'] !== '1') return reply.code(403).send();
    const event = browserEvent.safeParse(req.body);
    if (!event.success) return reply.code(400).send();
    const db = getDb();
    const account = loginEnabled && sessionAccount(db, req.headers.cookie);
    saveUsage(db, account ? account.id : personOf(clientIp(req)), event.data);
    return reply.code(204).send();
  });

  let cleanup: NodeJS.Timeout | undefined;
  const purge = () => {
    try {
      purgeUsage(getDb());
    } catch {
      app.log.warn('Não foi possível limpar o histórico de atividade.');
    }
  };
  app.addHook('onReady', async () => {
    purge();
    cleanup = setInterval(purge, 86_400_000).unref();
  });
  app.addHook('onClose', async () => { clearInterval(cleanup); });
}
