import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Login do admin: um usuário e uma senha fixos (ADMIN_USER / ADMIN_PASSWORD no .env).
 * A sessão é um token aleatório guardado em memória (reiniciar o servidor desloga) e
 * entregue num cookie HttpOnly. Tentativas erradas por IP têm limite (força bruta).
 */

export const ADMIN_COOKIE = 'uz_admin';
/** Senha mais curta que isto deixa o admin desligado (o link do túnel é público). */
export const MIN_PASSWORD = 10;

export interface AdminAuthOptions {
  user: string;
  password: string;
  /** Duração da sessão (horas). */
  sessionHours: number;
  /** Tentativas erradas por IP dentro de `failWindowMs` antes de recusar sem conferir. */
  maxFails?: number;
  failWindowMs?: number;
}

export type LoginResult = { ok: true; token: string; expiresAt: number } | { ok: false; reason: 'invalid' | 'too-many-attempts'; retryAt?: number };

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
/** Compara em tempo constante (o tempo da resposta não revela quantos caracteres batem). */
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export class AdminAuth {
  private sessions = new Map<string, number>();
  private fails = new Map<string, number[]>();
  private maxFails: number;
  private failWindowMs: number;

  constructor(private opts: AdminAuthOptions) {
    this.maxFails = opts.maxFails ?? 5;
    this.failWindowMs = opts.failWindowMs ?? 15 * 60_000;
  }

  /** Configurado com usuário e senha forte o bastante. */
  static isConfigured(user: string | undefined, password: string | undefined): boolean {
    return !!user && !!password && password.length >= MIN_PASSWORD;
  }

  login(user: string, password: string, ip: string, now = Date.now()): LoginResult {
    const recent = (this.fails.get(ip) ?? []).filter((t) => now - t < this.failWindowMs);
    if (recent.length >= this.maxFails) {
      this.fails.set(ip, recent);
      return { ok: false, reason: 'too-many-attempts', retryAt: recent[0]! + this.failWindowMs };
    }
    // Confere os dois sempre (sem curto-circuito): usuário errado e senha errada levam o mesmo tempo.
    const userOk = same(user, this.opts.user);
    const passOk = same(password, this.opts.password);
    if (!(userOk && passOk)) {
      recent.push(now);
      this.fails.set(ip, recent);
      return { ok: false, reason: 'invalid' };
    }
    this.fails.delete(ip);
    this.prune(now);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + this.opts.sessionHours * 3_600_000;
    this.sessions.set(token, expiresAt);
    return { ok: true, token, expiresAt };
  }

  /** O token é de uma sessão válida. */
  check(token: string | undefined, now = Date.now()): boolean {
    if (!token) return false;
    const exp = this.sessions.get(token);
    if (exp === undefined) return false;
    if (exp <= now) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  get user(): string {
    return this.opts.user;
  }

  private prune(now: number) {
    for (const [t, exp] of this.sessions) if (exp <= now) this.sessions.delete(t);
  }
}

/** Valor de um cookie no cabeçalho Cookie. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Cookie da sessão: só para /api/admin, invisível ao JavaScript, só em HTTPS (o navegador
 * aceita Secure também em localhost) e nunca enviado a partir de outro site.
 */
export function sessionCookie(token: string, maxAgeS: number): string {
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeS))}`;
}
