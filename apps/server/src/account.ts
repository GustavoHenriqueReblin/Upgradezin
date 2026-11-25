import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { CATEGORIES } from '@upgradezin/shared';
import { readCookie } from './admin/auth.ts';
import type { Db } from './db/db.ts';

const CALLBACK = '/api/account/google/callback';
const SESSION = '__Host-upgradezin_account';
const LOGIN = '__Host-upgradezin_google';
const LOGIN_SECONDS = 600;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const random = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const cookie = (key: string, value: string, seconds: number, sameSite: 'Lax' | 'Strict') =>
  `${key}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${seconds}`;

function tokenFrom(header: string | undefined, name: string): string | undefined {
  try {
    const value = readCookie(header, name);
    return value && /^[\w-]{43}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

type GoogleProfile = { sub: string; email: string; name: string };
type GoogleLogin = { clientId: string; redirectUri: string; exchange: (code: string, verifier: string, nonce: string) => Promise<GoogleProfile> };
type Account = { id: number; google_sub: string; name: string; email: string; cep: string | null };

export function configureGoogleLogin(clientId?: string, secret?: string, redirectUri?: string): GoogleLogin | undefined {
  if (!clientId || !secret || !redirectUri) return;
  const uri = URL.parse(redirectUri);
  if (!uri || uri.pathname !== CALLBACK || uri.search || uri.hash || uri.username || uri.password ||
    (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(uri.hostname)))) return;
  const client = new OAuth2Client(clientId, secret, redirectUri);
  return {
    clientId, redirectUri,
    async exchange(code, codeVerifier, nonce) {
      const { tokens } = await client.getToken({ code, codeVerifier });
      if (!tokens.id_token) throw new Error('O Google não retornou a identidade.');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || !profile.email_verified || profile.nonce !== nonce) throw new Error('Identidade inválida.');
      return { sub: profile.sub, email: profile.email, name: profile.given_name || profile.name || 'Minha Conta' };
    },
  };
}

const dataKeys = new Set([
  'upgradezin.build.v1', 'upgradezin.pc.v1', 'upgradezin.ui.v1', 'upgradezin.budget.v1',
  ...CATEGORIES.map((category) => `upgradezin.compare.${category}`),
]);
const callbackQuery = z.object({ code: z.string().min(1).max(2000).optional(), state: z.string().regex(/^[\w-]{43}$/) });
const dataBody = z.object({ key: z.string().refine((key) => dataKeys.has(key)), value: z.string().max(512_000).nullable() }).strict();
const cepBody = z.object({ cep: z.string().trim().regex(/^\d{5}-?\d{3}$/).transform((value) => value.replace('-', '')).nullable() }).strict();

export function registerAccountRoutes(app: FastifyInstance, getDb: () => Db, google?: GoogleLogin): void {
  const accountFor = (db: Db, token: string | undefined): Account | undefined => token
    ? db.prepare(`SELECT a.id, a.google_sub, a.name, a.email, a.cep FROM accounts a JOIN account_sessions s ON s.account_id = a.id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), Date.now()) as Account | undefined
    : undefined;

  app.get('/api/account', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = tokenFrom(req.headers.cookie, SESSION);
    if (!google || !token) return { enabled: !!google, user: null };
    const db = getDb();
    const user = accountFor(db, token);
    if (!user) return { enabled: true, user: null };
    const rows = db.prepare('SELECT key, value FROM account_data WHERE account_id = ?').all(user.id) as { key: string; value: string }[];
    return {
      enabled: true, user: { id: digest(user.google_sub), name: user.name, email: user.email, cep: user.cep },
      data: Object.fromEntries(rows.map(({ key, value }) => [key, value])),
    };
  });

  app.put('/api/account/cep', { bodyLimit: 1024 }, async (req, reply) => {
    if (req.headers['x-account'] !== '1') return reply.code(403).send({ error: 'forbidden' });
    const input = cepBody.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid-cep' });
    const db = getDb();
    const user = google && accountFor(db, tokenFrom(req.headers.cookie, SESSION));
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (req.headers['x-account-id'] !== digest(user.google_sub)) return reply.code(409).send({ error: 'account-changed' });
    const { cep } = input.data;
    db.prepare('UPDATE accounts SET cep = ? WHERE id = ?').run(cep, user.id);
    return reply.header('Cache-Control', 'no-store').send({ cep });
  });

  app.get('/api/account/google', async (req, reply) => {
    if (!google) return reply.code(404).send({ error: 'disabled' });
    const db = getDb();
    const now = Date.now();
    db.prepare('DELETE FROM account_login_attempts WHERE expires_at <= ?').run(now);
    const previous = tokenFrom(req.headers.cookie, LOGIN);
    if (previous) db.prepare('DELETE FROM account_login_attempts WHERE state_hash = ?').run(digest(previous));
    const state = random(), verifier = random(), nonce = random();
    db.prepare('INSERT INTO account_login_attempts VALUES (?, ?, ?, ?)').run(digest(state), verifier, nonce, now + 1000 * LOGIN_SECONDS);
    const params = new URLSearchParams({
      client_id: google.clientId, redirect_uri: google.redirectUri, response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: digest(verifier), code_challenge_method: 'S256', prompt: 'select_account',
    });
    return reply.header('Cache-Control', 'no-store').header('Set-Cookie', cookie(LOGIN, state, LOGIN_SECONDS, 'Lax'))
      .redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get(CALLBACK, async (req, reply) => {
    if (!google) return reply.code(404).send({ error: 'disabled' });
    const clearLogin = cookie(LOGIN, '', 0, 'Lax');
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const fail = () => reply.header('Set-Cookie', clearLogin).redirect('/?conta=erro');
    const query = callbackQuery.safeParse(req.query);
    if (!query.success || tokenFrom(req.headers.cookie, LOGIN) !== query.data.state) return fail();
    const db = getDb();
    const attempt = db.prepare('DELETE FROM account_login_attempts WHERE state_hash = ? AND expires_at > ? RETURNING verifier, nonce')
      .get(digest(query.data.state), Date.now()) as { verifier: string; nonce: string } | undefined;
    if (!attempt || !query.data.code) return fail();
    let profile: GoogleProfile;
    try {
      profile = await google.exchange(query.data.code, attempt.verifier, attempt.nonce);
    } catch {
      return fail();
    }
    const account = db.prepare(`INSERT INTO accounts (google_sub, email, name) VALUES (?, ?, ?)
      ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name RETURNING id`)
      .get(profile.sub, profile.email, profile.name) as { id: number };
    const now = Date.now();
    db.prepare('DELETE FROM account_sessions WHERE expires_at <= ?').run(now);
    const old = tokenFrom(req.headers.cookie, SESSION);
    if (old) db.prepare('DELETE FROM account_sessions WHERE token_hash = ?').run(digest(old));
    const token = random();
    db.prepare('INSERT INTO account_sessions VALUES (?, ?, ?)').run(digest(token), account.id, now + SESSION_SECONDS * 1000);
    return reply.header('Set-Cookie', [clearLogin, cookie(SESSION, token, SESSION_SECONDS, 'Lax')]).redirect('/');
  });

  app.put('/api/account/data', { bodyLimit: 1_048_576 }, async (req, reply) => {
    if (req.headers['x-account'] !== '1') return reply.code(403).send({ error: 'forbidden' });
    const input = dataBody.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid' });
    const db = getDb();
    const user = google && accountFor(db, tokenFrom(req.headers.cookie, SESSION));
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const { key, value } = input.data;
    // O id não vem da sessão enviada pelo cliente. A pré-condição impede uma guia antiga de gravar na conta nova.
    if (req.headers['x-account-id'] !== digest(user.google_sub)) return reply.code(409).send({ error: 'account-changed' });
    if (value === null) db.prepare('DELETE FROM account_data WHERE account_id = ? AND key = ?').run(user.id, key);
    else db.prepare(`INSERT INTO account_data VALUES (?, ?, ?)
      ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value`).run(user.id, key, value);
    return reply.code(204).send();
  });

  app.post('/api/account/logout', async (req, reply) => {
    if (req.headers['x-account'] !== '1') return reply.code(403).send({ error: 'forbidden' });
    const token = tokenFrom(req.headers.cookie, SESSION);
    if (token) {
      const db = getDb();
      const user = accountFor(db, token);
      if (user && req.headers['x-account-id'] !== digest(user.google_sub)) return reply.code(409).send({ error: 'account-changed' });
      db.prepare('DELETE FROM account_sessions WHERE token_hash = ?').run(digest(token));
    }
    return reply.header('Set-Cookie', cookie(SESSION, '', 0, 'Lax')).code(204).send();
  });
}
