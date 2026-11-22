import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { closeServer } from './shutdown.ts';

/** Servidor com uma rota ao vivo (SSE) que nunca termina sozinha, como o canal do admin. */
async function withOpenStream() {
  const app = Fastify();
  app.get('/live', async (_req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
    reply.raw.write(': conectado\n\n');
  });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  const res = await fetch(`${url}/live`);
  void res.body!.getReader().read(); // fica conectado, como uma aba do admin aberta
  return app;
}

describe('parar o servidor', () => {
  it('conexão ao vivo aberta não segura a parada: derruba depois da folga', async () => {
    const app = await withOpenStream();
    const t0 = Date.now();
    await closeServer(app, 200);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(150); // deu a folga para o que estava em andamento
    expect(took).toBeLessThan(2_000); // antes: ficava esperando até o systemd matar (90 s)
  });

  it('sem conexão aberta: fecha na hora', async () => {
    const app = Fastify();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const t0 = Date.now();
    await closeServer(app, 5_000);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});
