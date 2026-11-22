import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoutineInfo, SheetRoutineSettings } from '@upgradezin/shared';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/db.ts';
import { adminStores, saveStoreConfig, useStoreStorage } from '../stores.ts';
import { AdminAuth, readCookie, sessionCookie } from './auth.ts';
import { Backups, MergeUploads } from './backup.ts';
import { listAttempts, onAttempt, pageAttempts } from '../prices/attempts.ts';
import { attemptTimeline, coverage, perfGaps } from './data.ts';
import { listProducts, sheetStoreStatus } from './products.ts';
import { registerAdmin } from './routes.ts';
import { emitChange, onChange } from '../changes.ts';
import { baseName, serverStatus } from './status.ts';

describe('status', () => {
  it('banco: só o nome do arquivo, sem o caminho da máquina', () => {
    expect(baseName('E:\\Github\\Upgradezin\\data\\upgradezin.db')).toBe('upgradezin.db');
    expect(baseName('/home/server/Upgradezin/data/upgradezin.db')).toBe('upgradezin.db');
  });
});

const OPTS = { user: 'admin', password: 'senha-forte-123', sessionHours: 1 };

describe('AdminAuth', () => {
  it('só liga com usuário e senha de 10+ caracteres', () => {
    expect(AdminAuth.isConfigured('admin', 'senha-forte-123')).toBe(true);
    expect(AdminAuth.isConfigured('admin', 'curta')).toBe(false);
    expect(AdminAuth.isConfigured('', 'senha-forte-123')).toBe(false);
    expect(AdminAuth.isConfigured(undefined, undefined)).toBe(false);
  });

  it('login certo cria sessão que expira; errado não', () => {
    const auth = new AdminAuth(OPTS);
    expect(auth.login('admin', 'errada', '1.1.1.1')).toEqual({ ok: false, reason: 'invalid' });
    expect(auth.login('outro', 'senha-forte-123', '1.1.1.1').ok).toBe(false);
    const r = auth.login('admin', 'senha-forte-123', '1.1.1.1', 1_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(auth.check(r.token, 2_000)).toBe(true);
    expect(auth.check(r.token, 1_000 + 3_600_000)).toBe(false); // expirou
    expect(auth.check('inventado')).toBe(false);
    expect(auth.check(undefined)).toBe(false);
  });

  it('logout encerra a sessão', () => {
    const auth = new AdminAuth(OPTS);
    const r = auth.login('admin', 'senha-forte-123', 'x');
    if (!r.ok) throw new Error('login');
    auth.logout(r.token);
    expect(auth.check(r.token)).toBe(false);
  });

  it('força bruta: depois de 5 erros por IP, recusa sem conferir (nem a senha certa) até a janela passar', () => {
    const auth = new AdminAuth({ ...OPTS, maxFails: 5, failWindowMs: 60_000 });
    for (let i = 0; i < 5; i++) expect(auth.login('admin', `errada${i}`, '9.9.9.9', 1000 + i).ok).toBe(false);
    const blocked = auth.login('admin', 'senha-forte-123', '9.9.9.9', 2000);
    expect(blocked).toMatchObject({ ok: false, reason: 'too-many-attempts', retryAt: 61_000 });
    // Outro IP não é afetado.
    expect(auth.login('admin', 'senha-forte-123', '8.8.8.8', 2000).ok).toBe(true);
    // Passada a janela, volta a aceitar.
    expect(auth.login('admin', 'senha-forte-123', '9.9.9.9', 62_000).ok).toBe(true);
  });
});

describe('cookie da sessão', () => {
  it('HttpOnly, Secure, SameSite=Strict, só em /api/admin', () => {
    const c = sessionCookie('abc', 3600);
    for (const part of ['uz_admin=abc', 'Path=/api/admin', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=3600']) expect(c).toContain(part);
  });
  it('lê o cookie certo no cabeçalho', () => {
    expect(readCookie('a=1; uz_admin=tok%2Bx; b=2', 'uz_admin')).toBe('tok+x');
    expect(readCookie('a=1', 'uz_admin')).toBeUndefined();
    expect(readCookie(undefined, 'uz_admin')).toBeUndefined();
  });
});

/** Chamadas feitas às ações do admin (as de verdade são testadas em ops.test.ts). */
const calls: unknown[][] = [];

function makeApp() {
  const app = Fastify();
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'uz-routes-'));
  calls.length = 0;
  const routine: RoutineInfo = { enabled: false, stores: [], modes: { s1: 'normal', s2: 'slow', s3: 'slow' }, live: { s1: true, s2: true, s3: true }, busy: false, lastTickAt: null, nextTickAt: null, seconds: { normal: 15, reduced: 20, slow: 60 } };
  let sheetRoutine: SheetRoutineSettings = { enabled: false, stores: ['s1', 's2', 's3'], seconds: 180 };
  registerAdmin(app, {
    auth: new AdminAuth(OPTS),
    status: () => serverStatus(db, { version: '9.9.9', browserOpen: false, activeSessions: 0 }),
    stores: { list: () => adminStores(db), save: (id, input) => saveStoreConfig(db, id, input) },
    ops: {
      storesState: () => [],
      unpause: (id) => (calls.push(['unpause', id]), true),
      pause: (id, minutes) => void calls.push(['pause', id, minutes]),
      sweep: (id, category) => (calls.push(['sweep', id, category]), id === 's3' ? { ok: false, error: 'Loja em pausa.' } : { ok: true, startsAt: '2026-11-20T21:00:00.000Z' }),
      routine: () => routine,
      setRoutine: (s) => (calls.push(['routine', s]), { ...routine, ...s, modes: { ...routine.modes, ...s.modes }, live: { ...routine.live, ...s.live }, seconds: { ...routine.seconds, ...s.seconds } }),
    },
    products: {
      list: (f) => listProducts(db, f),
      sheets: () => ({ ...sheetRoutine, busy: false, progress: sheetStoreStatus(db, [{ id: 's1', name: 'Loja S1', canRead: true }]).map((p) => ({ ...p, nextAt: null })) }),
      setSheets: (s) => {
        calls.push(['sheets', s]);
        sheetRoutine = { ...sheetRoutine, ...s };
        return { ...sheetRoutine, busy: false, progress: [] };
      },
      readSheet: (id, sku) => (calls.push(['sheet', id, sku]), sku === 'pausada' ? { ok: false, error: 'Loja em pausa.' } : { ok: true, startsAt: '2026-11-20T21:00:00.000Z' }),
    },
    data: {
      coverage: () => coverage(db, () => 0),
      perfGaps: () => perfGaps(db),
      attempts: (f) => pageAttempts(db, f),
      timeline: (hours) => attemptTimeline(db, hours),
    },
    activity: () => ({ recent: [], people: 0, searchesOpen: 0, watchesOpen: 0, atLimit: { force: 0, text: 0, sheets: 0, share: 0 } }),
    live: { recent: () => listAttempts(db, { limit: 50 }), subscribe: onAttempt },
    db: () => db,
    backups: new Backups(join(dir, 'backups')),
    merges: new MergeUploads(join(dir, 'tmp')),
  });
  useStoreStorage(db);
  return app;
}

const login = (app: ReturnType<typeof makeApp>, password = 'senha-forte-123', headers: Record<string, string> = { 'x-admin': '1' }) =>
  app.inject({ method: 'POST', url: '/api/admin/login', headers, payload: { user: 'admin', password } });

const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie']).split(';')[0]!;

describe('rotas /api/admin', () => {
  it('sem sessão: 401; com sessão: responde, sem cache', async () => {
    const app = makeApp();
    expect((await app.inject('/api/admin/me')).statusCode).toBe(401);
    const res = await login(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: 'admin' });
    const me = await app.inject({ url: '/api/admin/me', headers: { cookie: cookieOf(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: 'admin' });
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('senha errada: 401; muitas: 429 com quando volta', async () => {
    const app = makeApp();
    expect((await login(app, 'errada')).statusCode).toBe(401);
    for (let i = 0; i < 4; i++) await login(app, 'errada');
    const r = await login(app);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toHaveProperty('retryAt');
  });

  it('sem o cabeçalho X-Admin, nada que muda algo passa (nem o login)', async () => {
    const app = makeApp();
    expect((await login(app, 'senha-forte-123', {})).statusCode).toBe(403);
    const ok = await login(app);
    expect((await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie: cookieOf(ok) } })).statusCode).toBe(403);
  });

  it('logout encerra a sessão e apaga o cookie', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const out = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie, 'x-admin': '1' } });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await app.inject({ url: '/api/admin/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('status: versão, banco, memória, Chrome', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const s = (await app.inject({ url: '/api/admin/status', headers: { cookie } })).json();
    expect(s).toMatchObject({ version: '9.9.9', browserOpen: false, activeSessions: 0, db: { file: ':memory:', migration: 12 } });
    expect(s.uptimeS).toBeGreaterThanOrEqual(0);
    expect(s.memory.rssMb).toBeGreaterThan(0);
  });
});

describe('rotas /api/admin/stores', () => {
  const body = {
    enabled: true,
    name: 'Loja Editada',
    url: 'https://www.editada.example',
    search: '/busca/{slug}',
    categories: { psu: 'hardware/fontes' },
    sweep: { psu: '/hardware/fontes' },
    colors: '#123456',
  };

  it('lista as três lojas, com a configuração copiada do .env', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const list = (await app.inject({ url: '/api/admin/stores', headers: { cookie } })).json();
    expect(list.map((s: { id: string }) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(list[0]).toMatchObject({ configured: true, enabled: true, name: 'Loja S1', url: 'https://www.s1.example' });
  });

  it('salva e devolve a loja; erro de validação volta com as mensagens', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const put = (id: string, payload: unknown, headers: Record<string, string> = { cookie, 'x-admin': '1' }) =>
      app.inject({ method: 'PUT', url: `/api/admin/stores/${id}`, headers, payload: payload as object });
    const ok = await put('s1', body);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: 's1', name: 'Loja Editada', colors: ['#123456'] });

    const bad = await put('s1', { ...body, url: 'http://x.example', search: '/busca' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toHaveLength(2);

    expect((await put('s1', { ...body, categories: { inventada: 'x' } })).statusCode).toBe(400);
    expect((await put('s9', body)).statusCode).toBe(404);
    expect((await put('s1', body, { cookie })).statusCode).toBe(403); // sem X-Admin
    expect((await put('s1', body, { 'x-admin': '1' })).statusCode).toBe(401); // sem sessão
  });
});

describe('rotas das ações (pausa, coletar agora, rotina)', () => {
  const setup = async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, headers: { cookie, 'x-admin': '1' }, ...(payload ? { payload } : {}) });
    return { app, cookie, post };
  };

  it('tirar pausa e pausar (5 min a 7 dias)', async () => {
    const { post } = await setup();
    expect((await post('/api/admin/stores/s2/unpause')).json()).toEqual({ ok: true, hadPause: true });
    expect((await post('/api/admin/stores/s2/pause', { minutes: 60 })).statusCode).toBe(200);
    expect((await post('/api/admin/stores/s2/pause', { minutes: 1 })).statusCode).toBe(400);
    expect((await post('/api/admin/stores/s2/pause', { minutes: 99_999 })).statusCode).toBe(400);
    expect((await post('/api/admin/stores/s9/unpause')).statusCode).toBe(404);
    expect(calls).toEqual([['unpause', 's2'], ['pause', 's2', 60]]);
  });

  it('varrer agora: aceito com o horário; recusado (409) com o motivo', async () => {
    const { post } = await setup();
    const ok = await post('/api/admin/stores/s1/sweep', { category: 'gpu' });
    expect(ok.json()).toEqual({ ok: true, startsAt: '2026-11-20T21:00:00.000Z' });
    const no = await post('/api/admin/stores/s3/sweep', { category: 'gpu' });
    expect(no.statusCode).toBe(409);
    expect(no.json().errors).toEqual(['Loja em pausa.']);
    expect((await post('/api/admin/stores/s1/sweep', { category: 'inventada' })).statusCode).toBe(400);
    expect((await post('/api/admin/stores/s1/collect', { category: 'gpu', term: 'RTX 3050' })).statusCode).toBe(404); // rota antiga saiu
  });

  it('produtos: lista paginada com filtros, andamento das fichas e "Ler ficha"', async () => {
    const { app, cookie } = await setup();
    const list = await app.inject({ url: '/api/admin/products?store=s1&sheet=missing&inStock=1&page=1&pageSize=20', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
    for (const q of ['sheet=talvez', 'store=s9', 'page=0', 'pageSize=500', 'inStock=sim']) {
      expect((await app.inject({ url: `/api/admin/products?${q}`, headers: { cookie } })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: '/api/admin/sheets', headers: { cookie } })).json()).toMatchObject({ enabled: false, seconds: 180, stores: ['s1', 's2', 's3'], progress: [{ store: 's1', total: 0, nextAt: null }] });

    // Rotina de fichas (separada da coleta): ligar, lojas e intervalo; inválido é recusado.
    const put = (payload: unknown, headers: Record<string, string> = { cookie, 'x-admin': '1' }) => app.inject({ method: 'PUT', url: '/api/admin/sheets', headers, payload: payload as object });
    const on = await put({ enabled: true, stores: ['s2'], seconds: 3600 });
    expect(on.json()).toMatchObject({ enabled: true, stores: ['s2'], seconds: 3600 });
    expect(calls.at(-1)).toEqual(['sheets', { enabled: true, stores: ['s2'], seconds: 3600 }]);
    for (const bad of [{ seconds: 9 }, { seconds: 86_401 }, { seconds: 60.5 }, { stores: ['s9'] }, { enabled: 'sim' }]) expect((await put(bad)).statusCode).toBe(400);
    expect((await put({ enabled: false }, { cookie })).statusCode).toBe(403);

    const post = (path: string) => app.inject({ method: 'POST', url: path, headers: { cookie, 'x-admin': '1' } });
    const ok = await post('/api/admin/products/s1/123/sheet');
    expect(ok.json()).toEqual({ ok: true, startsAt: '2026-11-20T21:00:00.000Z' });
    expect(calls.at(-1)).toEqual(['sheet', 's1', '123']);
    const paused = await post('/api/admin/products/s1/pausada/sheet');
    expect(paused.statusCode).toBe(409);
    expect(paused.json().errors).toEqual(['Loja em pausa.']);
    expect((await post('/api/admin/products/s9/123/sheet')).statusCode).toBe(404);
    expect((await post('/api/admin/products/s1/a%20b/sheet')).statusCode).toBe(404);
    // Sem o cabeçalho do admin (outro site): recusado.
    expect((await app.inject({ method: 'POST', url: '/api/admin/products/s1/123/sheet', headers: { cookie } })).statusCode).toBe(403);
    // Sem sessão: 401.
    expect((await app.inject({ url: '/api/admin/products' })).statusCode).toBe(401);
  });

  it('rotina: lê e muda', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ url: '/api/admin/routine', headers: { cookie } })).json()).toMatchObject({ enabled: false });
    const put = await app.inject({ method: 'PUT', url: '/api/admin/routine', headers: { cookie, 'x-admin': '1' }, payload: { enabled: true, stores: ['s1', 's3'] } });
    expect(put.json()).toMatchObject({ enabled: true, stores: ['s1', 's3'] });
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/routine', headers: { cookie, 'x-admin': '1' }, payload: { enabled: true, stores: ['s9'] } });
    expect(bad.statusCode).toBe(400);
    const mode = await app.inject({ method: 'PUT', url: '/api/admin/routine', headers: { cookie, 'x-admin': '1' }, payload: { enabled: true, stores: ['s2'], modes: { s2: 'reduced' } } });
    expect(mode.json()).toMatchObject({ modes: { s1: 'normal', s2: 'reduced', s3: 'slow' } });
    const badMode = await app.inject({ method: 'PUT', url: '/api/admin/routine', headers: { cookie, 'x-admin': '1' }, payload: { enabled: true, stores: ['s2'], modes: { s2: 'turbo' } } });
    expect(badMode.statusCode).toBe(400);
    const live = await app.inject({ method: 'PUT', url: '/api/admin/routine', headers: { cookie, 'x-admin': '1' }, payload: { enabled: true, stores: ['s2'], live: { s3: false }, seconds: { normal: 300 } } });
    expect(live.json()).toMatchObject({ live: { s1: true, s3: false }, seconds: { normal: 300, reduced: 20 } });
    for (const payload of [{ seconds: { normal: 2 } }, { seconds: { normal: 1.5 } }, { live: { s3: 'sim' } }]) {
      const res = await app.inject({ method: 'PUT', url: '/api/admin/routine', headers: { cookie, 'x-admin': '1' }, payload: { enabled: true, stores: ['s2'], ...payload } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('painel das lojas responde com sessão', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ url: '/api/admin/stores/state', headers: { cookie } })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/admin/stores/state' })).statusCode).toBe(401);
  });
});

describe('rotas de dados (cobertura, consultas)', () => {
  it('respondem com sessão e validam os filtros', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const get = (url: string) => app.inject({ url, headers: { cookie } });
    expect((await get('/api/admin/coverage')).json()).toEqual([]);
    expect((await get('/api/admin/terms')).statusCode).toBe(404); // os termos saíram
    expect((await get('/api/admin/attempts?store=s2&status=blocked&page=2')).json()).toEqual({ items: [], total: 0, page: 2, pageSize: 50 });
    for (const q of ['page=0', 'pageSize=9999', 'status=talvez']) expect((await get(`/api/admin/attempts?${q}`)).statusCode).toBe(400);
    expect((await get('/api/admin/attempts/timeline?hours=48')).json()).toEqual([]);
    expect((await get('/api/admin/attempts/timeline?hours=0')).statusCode).toBe(400);
  });
});

describe('rotas de backup, merge e atividade', () => {
  it('backup: cria, lista, baixa e apaga; nome inválido 404', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const h = { cookie, 'x-admin': '1' };
    const b = (await app.inject({ method: 'POST', url: '/api/admin/backups', headers: h })).json();
    expect(b.name).toMatch(/^manual-.*\.db\.gz$/);
    expect((await app.inject({ url: '/api/admin/backups', headers: { cookie } })).json().map((x: { name: string }) => x.name)).toEqual([b.name]);
    const dl = await app.inject({ url: `/api/admin/backups/${b.name}`, headers: { cookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain(b.name);
    expect(dl.rawPayload[0]).toBe(0x1f); // gzip
    expect((await app.inject({ url: '/api/admin/backups/..%2Fapp.db', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/backups/${b.name}`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/admin/backups', headers: { cookie } })).json()).toEqual([]);
  });

  it('merge: arquivo que não é banco é recusado; banco válido mostra a prévia e aplica com backup antes', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const h = { cookie, 'x-admin': '1', 'content-type': 'application/octet-stream' };
    const bad = await app.inject({ method: 'POST', url: '/api/admin/merge', headers: h, payload: Buffer.from('oi') });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0]).toContain('SQLite');

    const src = join(mkdtempSync(join(tmpdir(), 'uz-src-')), 'local.db');
    const sdb = openDb(src);
    sdb.prepare("INSERT INTO listings (store, store_sku, category, title, url, model_key, offer, first_seen_at, last_seen_at) VALUES ('s2', '1', 'gpu', 'Placa', 'https://s2.example/1', 'k', '{}', '2026-11-20', '2026-11-20')").run();
    sdb.close();
    const up = await app.inject({ method: 'POST', url: '/api/admin/merge', headers: h, payload: readFileSync(src) });
    expect(up.statusCode).toBe(200);
    const { id, report } = up.json();
    expect(report).toMatchObject({ newListings: 1 });
    const applied = await app.inject({ method: 'POST', url: `/api/admin/merge/${id}/apply`, headers: { cookie, 'x-admin': '1' } });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ backup: expect.stringMatching(/^pre-merge-/), report: { newListings: 1 } });
    // Já aplicado: o envio não existe mais.
    expect((await app.inject({ method: 'POST', url: `/api/admin/merge/${id}/apply`, headers: { cookie, 'x-admin': '1' } })).statusCode).toBe(404);
  });

  it('atividade responde com sessão', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    expect((await app.inject({ url: '/api/admin/activity', headers: { cookie } })).json()).toMatchObject({ searchesOpen: 0, atLimit: { force: 0 } });
  });

  it('canal ao vivo: avisa as telas quando algo muda pelo admin (não em leitura, recusa ou login) e manda os avisos como `change`', async () => {
    const app = makeApp();
    const cookie = cookieOf(await login(app));
    const seen: string[] = [];
    const off = onChange((k) => seen.push(k));
    const put = (payload: object, headers: Record<string, string> = { cookie, 'x-admin': '1' }) => app.inject({ method: 'PUT', url: '/api/admin/sheets', headers, payload });
    expect((await put({ seconds: 600 })).statusCode).toBe(200);
    expect(seen).toEqual(['admin']);
    await app.inject({ url: '/api/admin/sheets', headers: { cookie } }); // leitura
    await put({ seconds: 1 }); // recusada (400)
    await put({ seconds: 600 }, { cookie }); // sem o cabeçalho (403)
    await login(app, 'errada-errada-errada'); // login recusado
    await login(app); // login
    expect(seen).toEqual(['admin']);
    off();

    // O canal (SSE) manda cada aviso como evento `change`.
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const ac = new AbortController();
    const res = await fetch(`${url}/api/admin/live`, { headers: { cookie }, signal: ac.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    emitChange('store');
    let text = '';
    while (!text.includes('event: change')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`event: change${'\n'}data: {"kind":"store"}${'\n\n'}`);
    ac.abort();
    await app.close();
  });
});
