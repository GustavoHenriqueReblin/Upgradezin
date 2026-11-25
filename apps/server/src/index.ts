import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { ENABLED_CATEGORIES, isFormTerm, isTextTerm, cpuSheetFor, pickUpgrades, searchOptionCounts, STORES, type CategoryId, type Offer, type SearchOptionCounts, type SheetRoutineStatus, type StoreId } from '@upgradezin/shared';
import { fullSweep, fullSweepAll, probePage, readSheetNow, resumeRoutines, saveFullSweepSettings, useStoreIntervals, stopAdminJobs, stopFullSweep, storesState } from './admin/actions.ts';
import { clearFullSweeps } from './prices/sweep.ts';
import { budgetOffers, budgetPlan } from './budget.ts';
import { nightlySchedule, startNightlySweep, stopNightlySweep } from './admin/nightly.ts';
import { listProducts } from './admin/products.ts';
import { listSheetProducts, sheetPageText, sheetStoreStatus } from './admin/sheets.ts';
import { AdminAuth, MIN_PASSWORD } from './admin/auth.ts';
import { ActivityLog } from './admin/activity.ts';
import { Backups, MergeUploads } from './admin/backup.ts';
import { attemptTimeline, coverage, perfGaps } from './admin/data.ts';
import { listAttempts, onAttempt, pageAttempts } from './prices/attempts.ts';
import { registerAdmin } from './admin/routes.ts';
import { serverStatus } from './admin/status.ts';
import { SystemMonitor } from './admin/system.ts';
import { browserOpen, closeBrowser } from './browser.ts';
import { BUILD_ID, findSharedBuild, getSharedBuild, saveSharedBuild, SharedBuildSchema } from './builds/builds.ts';
import { config } from './config.ts';
import { configureGoogleLogin, registerAccountRoutes } from './account.ts';
import { emitChange } from './changes.ts';
import { closeServer } from './shutdown.ts';
import { deleteMeta, getMeta, metaByPrefix, setMeta } from './db/db.ts';
import { clearBackoff, pauseStore, setStoreInterval, storeInterval, useBackoffStorage, type Backoff } from './pace.ts';
import { closeDb, getDb } from './db/instance.ts';
import { activeSessions, canReadSheet } from './prices/collect.ts';
import { listingBrands, listingsHistory, recentOffers } from './prices/prices.ts';
import { productPage } from './prices/product-page.ts';
import { rereadSheets, setManualSheet, setSheetCompletion, SHEET_SCOPE_DAYS, sheetCoverage, syncSheetTables } from './prices/sheets.ts';
import { askNextNow, clearWebPause, setWebFill, startWebFill, stopWebFill, useWebFillStorage, webAnswers, webFillStatus } from './prices/web-fill.ts';
import { startProductKeys } from './prices/identity.ts';
import { setSheetRoutine, sheetNextAt, sheetRoutineBusy, sheetRoutineSettings, startSheetRoutine, stopSheetRoutine, useSheetRoutineStorage } from './prices/sheet-routine.ts';
import { routineInfo, routineSettings, setRoutineSettings, startRoutine, stopRoutine, useRoutineStorage } from './prices/routine.ts';
import { runSearch, stopBackgroundSearches, storedList } from './search.ts';
import { onCollected } from './prices/events.ts';
import { clientIp, forceLimiter, registerSecurity, searchStreams, shareLimiter, textLimiter, watchStreams } from './security.ts';
import { ACTIVE_STORES, adminStores, publicStores, saveStoreConfig, storeConfig, sweepPaths, useStoreStorage } from './stores.ts';

/** Versão do app (package.json da raiz; ver CHANGELOG.md). */
const VERSION: string = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;

const app = Fastify({ logger: { level: 'info', serializers: {
  req: (req) => ({
    method: req.method,
    url: req.url?.startsWith('/api/account/google/callback') ? '/api/account/google/callback' : req.url,
    hostname: req.hostname, remoteAddress: req.ip, remotePort: req.socket?.remotePort,
  }),
} } });
registerSecurity(app);

const SearchQuery = z.object({
  category: z.enum(ENABLED_CATEGORIES as [CategoryId, ...CategoryId[]]),
  /** Termos separados por vírgula (ex. "750W,850W"). Obrigatório: nunca a categoria inteira. */
  terms: z
    .string()
    .max(200)
    .transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8))
    .pipe(z.array(z.string()).min(1)),
  /** IDs separados por vírgula; vazio = todas as lojas configuradas. Lojas não configuradas são ignoradas. */
  stores: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : [...ACTIVE_STORES]))
    .pipe(z.array(z.enum(STORES)))
    .transform((ids) => ids.filter((id) => ACTIVE_STORES.includes(id)))
    .pipe(z.array(z.enum(STORES)).min(1, 'Nenhuma loja configurada')),
  force: z
    .string()
    .optional()
    .transform((v) => v === '1'),
  /** "1": a busca traz um texto livre ("Não achou? Buscar nas lojas" do filtro de texto). */
  text: z
    .string()
    .optional()
    .transform((v) => v === '1'),
}).superRefine((v, ctx) => {
  // Só os termos que o formulário gera (respondidos pelo banco). Exceção: com text=1, um texto livre
  // (isTextTerm), que vai às lojas, limitado por pessoa por hora (TEXT_SEARCHES_PER_HOUR).
  const free = v.terms.filter((t) => !isFormTerm(v.category, t));
  const ok = v.text && free.length <= 1 && free.every(isTextTerm);
  if (!ok) for (const t of free) ctx.addIssue({ code: 'custom', path: ['terms'], message: `Termo não aceito: ${t.slice(0, 40)}` });
});

// Pausas por bloqueio sobrevivem a reinício (meta "backoff:<loja>").
{
  const db = getDb();
  const saved = metaByPrefix(db, 'backoff:').map(([k, v]) => [k.slice('backoff:'.length), JSON.parse(v)] as [(typeof STORES)[number], Backoff]);
  useBackoffStorage(saved, (store, b) => {
    if (b) setMeta(db, `backoff:${store}`, JSON.stringify(b));
    else deleteMeta(db, `backoff:${store}`);
    emitChange('store'); // entrou ou saiu de pausa
  });
  // Chave antiga (intervalo do modo valia para a busca do site): não é mais usada.
  for (const [k] of metaByPrefix(db, 'slowlast:')) deleteMeta(db, k);
  // Intervalo de cada loja (admin; meta "interval:<loja>").
  useStoreIntervals(db);
  // Rotina: ligada, lojas e busca ao vivo, do admin (meta "routine"); sem nada guardado, vale o .env.
  const routine = getMeta(db, 'routine');
  useRoutineStorage(routine ? JSON.parse(routine) : null, (s) => setMeta(db, 'routine', JSON.stringify(s)));
  // Rotina de fichas (separada da coleta): do admin (meta "sheet-routine"); sem nada guardado, vale o .env.
  const sheetRoutine = getMeta(db, 'sheet-routine');
  useSheetRoutineStorage(sheetRoutine ? JSON.parse(sheetRoutine) : null, (s) => setMeta(db, 'sheet-routine', JSON.stringify(s)));
  // Busca na web das fichas: ligada e intervalo, do admin (meta "web-fill"); desligada por padrão.
  useWebFillStorage(db);
  // Fichas: colunas por categoria conforme a lista de campos; leitor ou campos mudaram, relê as páginas guardadas.
  const cols = syncSheetTables(db);
  if (cols.added.length || cols.dropped.length) app.log.info(`Fichas: colunas criadas ${cols.added.join(', ') || '-'}; apagadas ${cols.dropped.join(', ') || '-'}.`);
  const reread = rereadSheets(db);
  if (reread) app.log.info(`Fichas: ${reread} página(s) relida(s) com o leitor atual.`);
  // Lojas: do banco (admin); na primeira vez, copiadas do .env.
  const seeded = useStoreStorage(db);
  if (seeded) app.log.info(`Lojas: ${seeded} copiada(s) do .env para o banco; daqui em diante, edite no admin (/admin).`);
}

/** Rotina de fichas para o admin: configuração, andamento e próxima ficha de cada loja. */
function sheetStatus(): SheetRoutineStatus {
  const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
  const progress = sheetStoreStatus(
    getDb(),
    ACTIVE_STORES.map((id) => ({ id, name: storeConfig(id).name, canRead: canReadSheet(id) })),
  ).map((p) => ({ ...p, nextAt: iso(sheetNextAt(p.store)), interval: storeInterval(p.store, 'sheet') }));
  return { ...sheetRoutineSettings(), busy: sheetRoutineBusy(), progress };
}

app.get('/api/version', async () => ({ version: VERSION }));

const googleLogin = configureGoogleLogin(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI);
if (!googleLogin && (config.GOOGLE_CLIENT_ID || config.GOOGLE_CLIENT_SECRET || config.GOOGLE_REDIRECT_URI)) {
  app.log.warn('Login com Google desligado: confira o cliente OAuth e a URI de redirecionamento.');
}
registerAccountRoutes(app, getDb, googleLogin);

/** Últimas buscas do site, para a atividade do admin (sem IP). */
const activity = new ActivityLog();

// Admin (/admin): só com usuário e senha no .env.
if (AdminAuth.isConfigured(config.ADMIN_USER, config.ADMIN_PASSWORD)) {
  registerAdmin(app, {
    auth: new AdminAuth({ user: config.ADMIN_USER!, password: config.ADMIN_PASSWORD!, sessionHours: config.ADMIN_SESSION_H }),
    status: () => serverStatus(getDb(), { version: VERSION, browserOpen: browserOpen(), activeSessions: activeSessions() }),
    system: ((m) => () => m.snapshot())(new SystemMonitor()),
    stores: { list: () => adminStores(getDb()), save: (id, input) => saveStoreConfig(getDb(), id, input) },
    ops: {
      storesState: () => storesState(getDb()),
      unpause: clearBackoff,
      pause: (id, minutes) => void pauseStore(id, minutes),
      sweep: (id) => fullSweep(getDb(), id),
      saveSweep: (id, settings) => saveFullSweepSettings(getDb(), id, settings),
      setInterval: (id, kind, i) => {
        const r = setStoreInterval(id, kind, i);
        emitChange('admin');
        return r;
      },
      stopSweep: stopFullSweep,
      probe: (id, category, opts) => probePage(getDb(), id, category, opts),
      routine: () => ({ ...routineInfo(), nightly: { ...nightlySchedule(), lastAt: getMeta(getDb(), 'nightly-sweep') ?? null } }),
      setRoutine: (s) => (setRoutineSettings(s), routineInfo()),
    },
    products: { list: (f) => listProducts(getDb(), f) },
    sheets: {
      routine: sheetStatus,
      setRoutine: (s) => (setSheetRoutine(s), sheetStatus()),
      coverage: () => sheetCoverage(getDb(), new Date(Date.now() - SHEET_SCOPE_DAYS * 86_400_000).toISOString()),
      list: (f) => listSheetProducts(getDb(), f),
      page: (store, sku) => sheetPageText(getDb(), store, sku),
      read: (store, sku) => readSheetNow(getDb(), store, sku),
      web: () => webFillStatus(getDb()),
      setWeb: (s) => (setWebFill(s), webFillStatus(getDb())),
      askWeb: (key) => askNextNow(getDb(), key),
      resumeWeb: () => (clearWebPause(), webFillStatus(getDb())),
      setCompletion: (m) => setSheetCompletion(getDb(), m.key, m.category, m.complete),
      setManual: (m) => setManualSheet(getDb(), m.key, m.category, m.values),
      webAnswers: (f) => webAnswers(getDb(), f),
    },
    data: {
      coverage: () => coverage(getDb(), (store, category) => (ACTIVE_STORES.includes(store) ? sweepPaths(store, category).length : 0)),
      perfGaps: () => perfGaps(getDb()),
      attempts: (f) => pageAttempts(getDb(), f),
      timeline: (hours) => attemptTimeline(getDb(), hours),
    },
    activity: () => ({
      recent: activity.recent(100),
      people: activity.people(),
      searchesOpen: searchStreams.total(),
      watchesOpen: watchStreams.total(),
      atLimit: { force: forceLimiter.atLimit(), text: textLimiter.atLimit(), share: shareLimiter.atLimit() },
    }),
    live: { recent: () => listAttempts(getDb(), { limit: 50 }), subscribe: onAttempt },
    db: getDb,
    backups: new Backups(join(config.DATA_DIR, 'backups')),
    merges: new MergeUploads(join(config.DATA_DIR, 'tmp')),
  });
} else if (config.ADMIN_USER || config.ADMIN_PASSWORD) {
  app.log.warn(`Admin desligado: ADMIN_USER e ADMIN_PASSWORD (mínimo ${MIN_PASSWORD} caracteres) são obrigatórios.`);
}

/** Lojas configuradas no .env: id, nome e URL de busca (para o link "Ver na loja"). */
app.get('/api/stores', async () => publicStores());

/**
 * Marcas que aparecem nos anúncios de uma categoria (últimos 30 dias), para sugerir no
 * formulário da fonte do "Meu PC" as mesmas marcas que a busca mostra. Refeito a cada 10 min.
 */
const brandsCache = new Map<CategoryId, { at: number; value: string[] }>();
app.get('/api/brands', async (req, reply) => {
  const parsed = z.object({ category: z.enum(ENABLED_CATEGORIES as [CategoryId, ...CategoryId[]]) }).safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
  const { category } = parsed.data;
  const hit = brandsCache.get(category);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const value = listingBrands(getDb(), category, new Date(Date.now() - 30 * 86_400_000).toISOString());
  brandsCache.set(category, { at: Date.now(), value });
  return value;
});

/**
 * As melhores ofertas de agora para uma dica de upgrade do "Identificar Gargalo" (picks.ts): só do
 * banco, sem consultar loja. Ofertas da categoria vistas nas últimas SEARCH_DB_MAX_AGE_H horas,
 * nas lojas ligadas; lidas de novo no máximo a cada minuto.
 */
const ids = z.array(z.string().max(40)).max(80).optional();
const nums = z.array(z.number()).max(20).optional();
const PicksBody = z.object({
  slot: z.enum(['gpu', 'cpu', 'ram', 'psu', 'ssd']),
  filters: z
    .object({
      sockets: ids,
      cpuLines: ids,
      gpuMakers: ids,
      gpuModels: ids,
      vram: nums,
      memory: ids,
      ramCapacity: nums,
      ramModules: nums,
      ramSpeed: nums,
      ssdInterfaces: ids,
      ssdCapacity: nums,
    })
    .strict(),
  context: z
    .object({
      current: z.number().positive().optional(),
      chipset: z.string().max(20).optional(),
      maxGpuPower: z.number().positive().optional(),
      minVram: z.number().positive().max(64).optional(),
      minWatts: z.number().positive().optional(),
      certified: z.boolean().optional(),
    })
    .strict()
    .optional(),
});
/** Ofertas da categoria nas lojas ligadas, com a ficha, guardadas por 1 min (upgrades e opções do formulário). */
const offersCache = new Map<CategoryId, { at: number; value: Offer[]; options?: SearchOptionCounts }>();
function categoryOffers(category: CategoryId) {
  let hit = offersCache.get(category);
  if (!hit || Date.now() - hit.at > 60_000) {
    const since = new Date(Date.now() - config.SEARCH_DB_MAX_AGE_H * 3_600_000).toISOString();
    hit = { at: Date.now(), value: recentOffers(getDb(), category, since).filter((o) => ACTIVE_STORES.includes(o.store)) };
    offersCache.set(category, hit);
  }
  return hit;
}
app.post('/api/upgrade/picks', { bodyLimit: 16 * 1024 }, async (req, reply) => {
  const parsed = PicksBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
  return pickUpgrades(parsed.data as Parameters<typeof pickUpgrades>[0], categoryOffers(parsed.data.slot).value);
});

/** Montar pelo orçamento: o PC inteiro ou o upgrade do PC importado, com as ofertas de agora (budget.ts). */
app.post('/api/budget/plan', { bodyLimit: 32 * 1024 }, async (req, reply) => {
  const r = budgetPlan(req.body, (slot, mode, now) => (ENABLED_CATEGORIES.includes(slot) ? budgetOffers(getDb(), slot, mode, ACTIVE_STORES, now) : []));
  if (!r.ok) return reply.code(400).send({ error: r.error });
  return r.plan;
});

/**
 * Ficha técnica de um processador pelo modelo ("5800X3D", "12400F"): a do mesmo modelo no catálogo, com
 * mais campos. A análise do PC importado usa para a nota do processador (o CPU-Z não traz o clock boost).
 */
app.get('/api/sheets/cpu', async (req, reply) => {
  const parsed = z.object({ model: z.string().trim().min(3).max(20).regex(/^[\w-]+$/) }).safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
  const sheet = cpuSheetFor(categoryOffers('cpu').value, parsed.data.model);
  if (!sheet) return reply.code(404).send({ error: 'not-found' });
  reply.header('Cache-Control', 'public, max-age=300');
  return sheet;
});

/** Opções do formulário da busca: quantos produtos em estoque há para cada uma (pela ficha). */
app.get('/api/search/options', async (req, reply) => {
  const parsed = z.object({ category: z.enum(ENABLED_CATEGORIES as [CategoryId, ...CategoryId[]]) }).safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
  const hit = categoryOffers(parsed.data.category);
  hit.options ??= searchOptionCounts(parsed.data.category, hit.value);
  reply.header('Cache-Control', 'public, max-age=60');
  return hit.options;
});

/** Compartilhar a montagem: grava uma cópia e devolve o código do link (/m/<id>). */
app.post('/api/builds', { bodyLimit: 256 * 1024 }, async (req, reply) => {
  const parsed = SharedBuildSchema.safeParse((req.body as { build?: unknown } | null)?.build);
  if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
  const db = getDb();
  const existing = findSharedBuild(db, parsed.data);
  if (existing) return { id: existing };
  if (!shareLimiter.take(clientIp(req))) return reply.code(429).header('Retry-After', '3600').send({ error: 'too-many-requests' });
  return { id: saveSharedBuild(db, parsed.data) };
});

/** Montagem compartilhada, com os preços mais recentes do banco. */
app.get('/api/builds/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const found = BUILD_ID.test(id) ? getSharedBuild(getDb(), id) : null;
  if (!found) return reply.code(404).send({ error: 'not-found' });
  return found;
});

/**
 * Histórico de preço dos anúncios de um produto (um ponto a cada mudança de preço, cupom,
 * oferta ou estoque). items = "loja:código" separados por vírgula, até 12.
 */
const HistoryQuery = z.object({
  items: z
    .string()
    .max(1000)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^s\d:[^,]{1,64}$/)).min(1).max(12))
    .transform((xs) => xs.map((x) => ({ store: x.slice(0, x.indexOf(':')), sku: x.slice(x.indexOf(':') + 1) })))
    .pipe(z.array(z.object({ store: z.enum(STORES), sku: z.string() }))),
});
app.get('/api/prices/history', async (req, reply) => {
  const parsed = HistoryQuery.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
  return listingsHistory(getDb(), parsed.data.items);
});

/** Página do produto: ficha técnica juntada e as ofertas das lojas ligadas (só do banco). */
app.get('/api/products/:key', async (req, reply) => {
  const { key } = req.params as { key: string };
  const page = key.length <= 200 ? productPage(getDb(), key, ACTIVE_STORES) : undefined;
  if (!page) return reply.code(404).send({ error: 'not-found' });
  return page;
});

/**
 * SSE de novidades para a tela de resultado aberta (depois que a busca termina): quando uma coleta
 * grava no banco algo da categoria (rotina, varredura, busca de outra pessoa), manda a lista nova
 * daquela loja para a busca (evento "offers", lista completa) e "fresh" (loja, quantas ofertas).
 * Mesmos parâmetros da busca; não consulta loja nenhuma. Ping a cada 25 s para o túnel não fechar.
 */
app.get('/api/watch', async (req, reply) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
  const ip = clientIp(req);
  if (!watchStreams.acquire(ip)) return reply.code(429).send({ error: 'too-many-requests' });
  const { category, terms, stores } = parsed.data;

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const write = (chunk: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(chunk);
  };
  write(': ok\n\n');
  const ping = setInterval(() => write(': ping\n\n'), 25_000);
  // Várias páginas da mesma coleta em sequência: uma lista só, um pouco depois da última.
  const timers = new Map<StoreId, NodeJS.Timeout>();
  const off = onCollected((e) => {
    if (e.category !== category || !stores.includes(e.store)) return;
    clearTimeout(timers.get(e.store));
    timers.set(
      e.store,
      setTimeout(() => {
        timers.delete(e.store);
        try {
          const offers = storedList(e.store, category, terms);
          write(`event: offers\ndata: ${JSON.stringify({ store: e.store, offers, partial: false })}\n\n`);
          write(`event: fresh\ndata: ${JSON.stringify({ store: e.store, count: offers.length, at: e.at })}\n\n`);
        } catch (err) {
          req.log.error(err);
        }
      }, 1500),
    );
  });
  res.on('close', () => {
    off();
    clearInterval(ping);
    for (const t of timers.values()) clearTimeout(t);
    watchStreams.release(ip);
  });
});

/** SSE: eventos "status" (progresso por loja), "offers" (lote por loja) e "end". */
app.get('/api/search/stream', async (req, reply) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
  const ip = clientIp(req);
  // Muitas buscas abertas ao mesmo tempo pela mesma pessoa: recusa a nova.
  if (!searchStreams.acquire(ip)) return reply.code(429).send({ error: 'too-many-requests' });
  const { force: wantsForce, ...params } = parsed.data;
  // Texto livre além do limite por hora: a busca segue só com os termos do formulário.
  if (params.text && params.terms.some((t) => !isFormTerm(params.category, t)) && !textLimiter.take(ip)) {
    params.terms = params.terms.filter((t) => isFormTerm(params.category, t));
    params.text = false;
    if (!params.terms.length) {
      searchStreams.release(ip);
      return reply.code(429).send({ error: 'too-many-requests' });
    }
  }
  // Passou do limite de "Atualizar": a busca responde com o que está no banco.
  const force = wantsForce && forceLimiter.take(ip);
  activity.record({ at: new Date().toISOString(), ip, category: params.category, terms: params.terms, stores: params.stores, text: !!params.text, force });
  emitChange('activity');

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const ac = new AbortController();
  // 'close' da resposta = cliente desconectou (botão Parar, troca de busca, aba fechada).
  res.on('close', () => {
    ac.abort();
    searchStreams.release(ip);
  });

  await runSearch(
    params,
    { onStatus: (e) => send('status', e), onOffers: (store, offers, partial) => send('offers', { store, offers, partial: !!partial }) },
    ac.signal,
    force,
  );
  if (!res.writableEnded && !res.destroyed) {
    send('end', {});
    res.end();
  }
});

const webDist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  // Rota da API que não existe (ex. uma removida) responde 404 em JSON, não a página do app.
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not-found' }) : reply.sendFile('index.html'),
  );
}

/** Para o recálculo das chaves de produto (ligado depois de subir). */
let stopProductKeys = () => {};

const shutdown = async () => {
  // Garantia: se algo travar ao fechar, sai mesmo assim (antes do SIGKILL do systemd, 90 s).
  setTimeout(() => process.exit(1), 10_000).unref();
  stopRoutine();
  stopSheetRoutine();
  stopWebFill();
  stopNightlySweep();
  stopProductKeys();
  stopAdminJobs();
  stopBackgroundSearches();
  await closeBrowser();
  await closeServer(app); // conexões ao vivo (SSE) abertas não seguram a parada
  closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`Upgradezin v${VERSION}`);
// Varredura completa interrompida por um reinício: as rotinas voltam a como estavam antes dela.
{
  const left = clearFullSweeps(getDb());
  if (left) app.log.info(`Varredura completa interrompida: ${left} categoria(s) de volta ao normal.`);
  const was = resumeRoutines(getDb());
  if (was) app.log.info(`Varredura completa interrompida: rotinas de volta (preços ${was.routine ? 'ligada' : 'desligada'}, fichas ${was.sheets ? 'ligada' : 'desligada'}).`);
}
startRoutine();
startSheetRoutine();
startWebFill();
// Varredura completa automática de madrugada (antes do backup do cron).
startNightlySweep(
  config.NIGHTLY_SWEEP_HOUR,
  () => {
    const started = fullSweepAll(getDb());
    app.log.info(`Varredura da madrugada: ${started.map((x) => `${x.store} ${x.result.ok ? 'começou' : `não começou (${x.result.error})`}`).join(', ') || 'nenhuma loja'}`);
  },
  (at) => setMeta(getDb(), 'nightly-sweep', at.toISOString()),
);
// Mesmo produto em lojas diferentes: chaves recalculadas ao subir e depois das coletas.
stopProductKeys = startProductKeys(getDb);
