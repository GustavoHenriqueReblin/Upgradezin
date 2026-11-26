import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.ts';

/**
 * Proteções do servidor quando ele fica acessível de fora (link do cloudflared, VPN):
 * limite de requisições por pessoa, limites específicos (atualizar preços, criar link de
 * montagem, buscas abertas ao mesmo tempo) e cabeçalhos de segurança. Tudo em memória:
 * reiniciar o servidor zera os contadores.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Quem está pedindo. Atrás do cloudflared a conexão vem da própria máquina e o IP real chega
 * no cabeçalho CF-Connecting-IP; só confia nele quando a conexão é local (de fora, qualquer um
 * poderia mandar o cabeçalho para se passar por outro).
 */
export function clientIp(req: Pick<FastifyRequest, 'ip' | 'headers'>): string {
  const cf = req.headers['cf-connecting-ip'];
  return LOOPBACK.has(req.ip) && typeof cf === 'string' && cf.length > 0 && cf.length < 64 ? cf : req.ip;
}

/** Janela deslizante: até `max` eventos por chave em `windowMs`. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Conta um evento; false se a chave já chegou ao limite (o evento não é contado). */
  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Não deixa o mapa crescer sem fim com chaves antigas.
    if (this.hits.size > 5000) for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }

  /** Quantas chaves estão no limite agora (para o admin). */
  atLimit(now = Date.now()): number {
    let n = 0;
    for (const ts of this.hits.values()) if (ts.filter((t) => now - t < this.windowMs).length >= this.max) n++;
    return n;
  }
}

/** Quantas coisas uma chave tem abertas ao mesmo tempo (ex. buscas em andamento). */
export class Concurrency {
  private open = new Map<string, number>();
  constructor(private max: number) {}
  acquire(key: string): boolean {
    const n = this.open.get(key) ?? 0;
    if (n >= this.max) return false;
    this.open.set(key, n + 1);
    return true;
  }
  /** Total aberto agora, de todas as chaves. */
  total(): number {
    let n = 0;
    for (const v of this.open.values()) n += v;
    return n;
  }
  release(key: string): void {
    const n = (this.open.get(key) ?? 1) - 1;
    if (n <= 0) this.open.delete(key);
    else this.open.set(key, n);
  }
}

/** "Atualizar" por pessoa: além disso, a busca só devolve o que está no banco. */
export const forceLimiter = new Limiter(config.FORCE_PER_HOUR, 3_600_000);
/** Links de montagem novos por pessoa (a mesma montagem reaproveita o link e não conta). */
export const shareLimiter = new Limiter(config.SHARE_PER_HOUR, 3_600_000);
/** Buscas com texto livre ("Buscar nas lojas" do filtro de texto) por pessoa por hora. */
export const textLimiter = new Limiter(config.TEXT_SEARCHES_PER_HOUR, 3_600_000);
/** Buscas abertas ao mesmo tempo por pessoa. */
export const searchStreams = new Concurrency(config.SEARCHES_PER_IP);
/** Telas de resultado abertas escutando novidades (GET /api/watch), por pessoa. */
export const watchStreams = new Concurrency(config.WATCHES_PER_IP);

/**
 * Página servida pelo próprio servidor: só scripts e estilos dele; imagens de qualquer https
 * (fotos dos produtos vêm dos sites das lojas); nada de ser aberta dentro de outro site.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function registerSecurity(app: FastifyInstance): void {
  const general = new Limiter(config.RATE_LIMIT_PER_MIN, 60_000);
  const usage = new Limiter(120, 60_000);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const limiter = req.method === 'POST' && req.url === '/api/activity' ? usage : general;
    if (!limiter.take(clientIp(req))) return reply.code(429).header('Retry-After', '60').send({ error: 'too-many-requests' });
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('X-Robots-Tag', 'noindex');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) reply.header('Content-Security-Policy', CSP);
    return payload;
  });
}
