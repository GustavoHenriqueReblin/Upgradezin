import type { FastifyInstance } from 'fastify';

/**
 * Fecha o servidor HTTP sem ficar preso. `app.close()` espera cada conexão aberta terminar, e as
 * conexões ao vivo (SSE: canal do admin, busca e telas de resultado abertas) não terminam
 * sozinhas: com uma aba do admin aberta, parar o serviço levava os 90 s do systemd até o SIGKILL.
 * Dá `graceMs` para o que está em andamento acabar e depois derruba as conexões que sobraram.
 */
export async function closeServer(app: FastifyInstance, graceMs = 1_000): Promise<void> {
  const force = setTimeout(() => app.server.closeAllConnections(), graceMs);
  try {
    await app.close();
  } finally {
    clearTimeout(force);
  }
}
