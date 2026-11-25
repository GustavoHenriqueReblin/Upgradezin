import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { configureGoogleLogin, registerAccountRoutes } from './account.ts';
import { openDb } from './db/db.ts';

it('aceita somente a URL configurada do callback em HTTPS ou localhost', () => {
  const path = '/api/account/google/callback';
  expect(configureGoogleLogin('app', 'secret', `http://localhost:5173${path}`)).toBeDefined();
  expect(configureGoogleLogin('app', 'secret', `https://app.example${path}`)).toBeDefined();
  expect(configureGoogleLogin('app', 'secret', `http://app.example${path}`)).toBeUndefined();
  expect(configureGoogleLogin('app', 'secret', `https://app.example${path}?return=x`)).toBeUndefined();
});

it('usa state de uso único e PKCE, isola dados por conta e invalida a sessão ao sair', async () => {
  const db = openDb(':memory:');
  const redirectUri = 'https://app.example/api/account/google/callback';
  const exchange = vi.fn(async (code: string, _verifier: string, _nonce: string) => ({
    sub: code, email: `${code}@example.com`, name: code,
  }));
  const app = Fastify();
  registerAccountRoutes(app, () => db, { clientId: 'test', redirectUri, exchange });
  const login = async (code: string) => {
    const start = await app.inject('/api/account/google');
    const authUrl = new URL(start.headers.location!);
    const loginCookie = String(start.headers['set-cookie']).split(';', 1)[0]!;
    const callback = new URL(redirectUri);
    callback.search = new URLSearchParams({ code, state: authUrl.searchParams.get('state')! }).toString();
    const url = callback.pathname + callback.search;
    expect((await app.inject(url)).headers.location).toBe('/?conta=erro');
    const response = await app.inject({ url, headers: { cookie: loginCookie } });
    expect(response.headers.location).toBe('/');
    const [, verifier, nonce] = exchange.mock.calls.at(-1)!;
    expect(nonce).toBe(authUrl.searchParams.get('nonce'));
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authUrl.searchParams.get('code_challenge'));
    expect((await app.inject({ url, headers: { cookie: loginCookie } })).headers.location).toBe('/?conta=erro');
    const cookies = response.headers['set-cookie'] as string[];
    expect(cookies[1]).toContain('HttpOnly; Secure; SameSite=Lax');
    return cookies[1]!.split(';', 1)[0]!;
  };
  try {
    const first = await login('first');
    const second = await login('second');
    const account = (cookie: string) => app.inject({ url: '/api/account', headers: { cookie } });
    const user = (await account(first)).json().user;
    const body = { key: 'upgradezin.build.v1', value: '{"cpu":"novo"}' };
    const headers = { cookie: first, 'x-account': '1', 'x-account-id': user.id };
    const persist = (override: Record<string, string> = {}) => app.inject({ method: 'PUT', url: '/api/account/data', headers: { ...headers, ...override }, payload: body });
    expect((await persist({ 'x-account': '' })).statusCode).toBe(403);
    expect((await persist({ cookie: second })).statusCode).toBe(409);
    expect((await persist()).statusCode).toBe(204);
    expect((await account(first)).json().data).toEqual({ [body.key]: body.value });
    expect((await account(second)).json().data).toEqual({});
    const saveCep = (cep: string | null, session = first) => app.inject({
      method: 'PUT', url: '/api/account/cep', headers: { ...headers, cookie: session }, payload: { cep },
    });
    expect((await saveCep('1234')).statusCode).toBe(400);
    expect((await saveCep('12345-678', second)).statusCode).toBe(409);
    expect((await saveCep('01234-567')).json()).toEqual({ cep: '01234567' });
    expect((await account(first)).json().user.cep).toBe('01234567');
    expect((await account(second)).json().user.cep).toBeNull();
    expect((await saveCep(null)).json()).toEqual({ cep: null });
    expect((await app.inject({ method: 'POST', url: '/api/account/logout', headers })).statusCode).toBe(204);
    expect((await account(first)).json().user).toBeNull();
    expect((await persist()).statusCode).toBe(401);
    expect((await saveCep('12345-678')).statusCode).toBe(401);
    expect((await account(await login('first'))).json().data).toEqual({ [body.key]: body.value });
  } finally {
    await app.close();
    db.close();
  }
});
