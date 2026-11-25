import { ADMIN_PAGE_SIZE_MAX, INTERVAL_KINDS, type IntervalKind, STORE_INTERVAL_S_MAX, STORE_INTERVAL_S_MIN, type StoreInterval, CATEGORIES, STORES, type FullSweepSettings, type AdminPage, type AdminStoreConfig, type AdminStoreInput, type AdminStoreState, type CategoryId, type CoverageRow, type PerfGap, type ProbeResult, type AdminProductFilter, type AdminProductPage, type SheetRoutineStatus, type SheetRoutineInput, type WebAnswer, type WebAnswerFilter, type WebAnswerPage, type WebFillInput, type WebFillStatus, type SheetManualInput, type SheetCoverageRow, type SheetPageText, type SheetProductFilter, type SheetProductPage, type RoutineInfo, type StoreAttempt, type TimelineBucket, type RoutineInput, type StoreId, type SystemSnapshot } from '@upgradezin/shared';
import { createReadStream } from 'node:fs';
import { emitChange, onChange } from '../changes.ts';
import type { ActivityInfo } from '@upgradezin/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientIp } from '../security.ts';
import { ADMIN_COOKIE, readCookie, sessionCookie, type AdminAuth } from './auth.ts';
import type { CollectNowResult } from './actions.ts';
import { applyMerge, previewMerge, type Backups, type MergeUploads } from './backup.ts';
import type { Db } from '../db/db.ts';
import type { ServerStatus } from './status.ts';

/** O que as rotas do admin usam do servidor (injetado, para os testes montarem só o admin). */
export interface AdminDeps {
  auth: AdminAuth;
  status: () => ServerStatus;
  /** Monitor da máquina (CPU, memória, disco, rede, processos), lido na hora. */
  system: () => Promise<SystemSnapshot>;
  stores: {
    list: () => AdminStoreConfig[];
    save: (id: StoreId, input: AdminStoreInput) => { config: unknown } | { errors: string[] };
  };
  ops: {
    storesState: () => AdminStoreState[];
    unpause: (id: StoreId) => boolean;
    pause: (id: StoreId, minutes: number) => void;
    /** "Varredura completa": pausa as rotinas e lê as categorias marcadas da loja até o fim (esgotados também). */
    sweep: (id: StoreId) => CollectNowResult;
    /** "Parar varredura": interrompe a varredura completa da loja; false se nada rodava. */
    stopSweep: (id: StoreId) => boolean;
    /** Guarda a configuração da varredura completa da loja (intervalo e categorias; vale também para a da madrugada). */
    saveSweep: (id: StoreId, s: FullSweepSettings) => FullSweepSettings;
    /** Intervalo da loja (listagens ou fichas): guarda e devolve o que vale. */
    setInterval: (id: StoreId, kind: IntervalKind, i: StoreInterval) => StoreInterval;
    /** "Testar página": abre uma página de categoria direto (sem as anteriores) e espera o resultado. */
    probe: (id: StoreId, category: CategoryId, opts: { page: number; pages?: number; path?: string }) => Promise<{ ok: true; results: ProbeResult[] } | { ok: false; error: string }>;
    routine: () => RoutineInfo;
    setRoutine: (s: RoutineInput) => RoutineInfo;
  };
  products: {
    list: (f: AdminProductFilter) => AdminProductPage;
  };
  sheets: {
    routine: () => SheetRoutineStatus;
    setRoutine: (s: SheetRoutineInput) => SheetRoutineStatus;
    coverage: () => SheetCoverageRow[];
    list: (f: SheetProductFilter) => SheetProductPage;
    page: (store: StoreId, sku: string) => SheetPageText | undefined;
    read: (store: StoreId, sku: string) => CollectNowResult;
    web: () => WebFillStatus;
    setWeb: (s: WebFillInput) => WebFillStatus;
    /** Pergunta a próxima agora (ou refaz o produto `key`); null: nada na fila, pausada ou já perguntando. */
    askWeb: (key?: string) => Promise<WebAnswer | null>;
    resumeWeb: () => WebFillStatus;
    webAnswers: (f: WebAnswerFilter) => WebAnswerPage;
    /** Preenche à mão campos de um produto; devolve os campos recusados (fora do tipo, das opções ou da faixa). */
    setCompletion: (m: { key: string; category: CategoryId; complete: boolean }) => boolean;
    setManual: (m: SheetManualInput) => { errors: string[] };
  };
  data: {
    coverage: () => CoverageRow[];
    perfGaps: () => PerfGap[];
    attempts: (f: { store?: StoreId; status?: StoreAttempt['status']; origin?: StoreAttempt['origin']; page?: number; pageSize?: number }) => AdminPage<StoreAttempt>;
    timeline: (hours: number) => TimelineBucket[];
  };
  activity: () => ActivityInfo;
  live: { recent: () => StoreAttempt[]; subscribe: (fn: (a: StoreAttempt) => void) => () => void };
  db: () => Db;
  backups: Backups;
  merges: MergeUploads;
}

/** Banco enviado para merge: até este tamanho. */
const MERGE_MAX_BYTES = 300 * 1024 * 1024;

/** Paginação das tabelas do admin (produtos, consultas). */
const Paging = {
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(ADMIN_PAGE_SIZE_MAX).optional(),
};
const AttemptsQuery = z.object({
  store: z.enum(STORES).optional(),
  status: z.enum(['ok', 'partial', 'blocked', 'limit', 'error']).optional(),
  origin: z.enum(['search', 'routine', 'admin']).optional(),
  ...Paging,
});
const ProductsQuery = z.object({
  store: z.enum(STORES).optional(),
  category: z.enum(CATEGORIES).optional(),
  inStock: z.enum(['1', '0']).transform((v) => v === '1').optional(),
  q: z.string().max(80).optional(),
  ...Paging,
});
const SheetProductsQuery = z.object({
  category: z.enum(CATEGORIES).optional(),
  state: z.enum(['complete', 'incomplete', 'unread', 'exhausted', 'manual']).optional(),
  q: z.string().max(80).optional(),
  ...Paging,
});
const SheetPageQuery = z.object({ store: z.enum(STORES), sku: z.string().regex(/^[\w-]{1,64}$/) });
const TimelineQuery = z.object({ hours: z.coerce.number().int().min(1).max(720).default(48) });

const Pause = z.object({ minutes: z.number().int().min(5).max(7 * 24 * 60) });
const Routine = z.object({ enabled: z.boolean(), stores: z.array(z.enum(STORES)).max(STORES.length),
  live: z.partialRecord(z.enum(STORES), z.boolean()).optional(),
});

const SheetRoutine = z.object({
  enabled: z.boolean().optional(),
  stores: z.array(z.enum(STORES)).max(STORES.length).optional(),
});

const storeParam = (id: string): StoreId | null => ((STORES as readonly string[]).includes(id) ? (id as StoreId) : null);

const PathMap = z.partialRecord(z.enum(CATEGORIES), z.string().max(300)).default({});
/** Página de cada categoria: até 10 caminhos separados por espaço. */
const FULL_SWEEP_ERROR = 'Varredura completa: categorias válidas.';
const FullSweepBody = z.object({ categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length) }).strict();
const INTERVAL_ERROR = `Intervalo da loja: listagens ou fichas, de ${STORE_INTERVAL_S_MIN} a ${STORE_INTERVAL_S_MAX} segundos, o primeiro não maior que o segundo.`;
const intervalSeconds = z.number().int().min(STORE_INTERVAL_S_MIN).max(STORE_INTERVAL_S_MAX);
const IntervalBody = z
  .object({ kind: z.enum(INTERVAL_KINDS), minS: intervalSeconds, maxS: intervalSeconds })
  .strict()
  .refine((v) => v.minS <= v.maxS);
const ManualBody = z
  .object({
    key: z.string().min(1).max(200),
    category: z.enum(CATEGORIES),
    values: z.record(z.string().max(40), z.union([z.string().max(80), z.number(), z.boolean(), z.null()])),
  })
  .strict();
const WebAnswersQuery = z.object({
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(['ok', 'none']).optional(),
  q: z.string().max(80).optional(),
  ...Paging,
});
const WebFillBody = z
  .object({
    enabled: z.boolean().optional(),
    interval: z.object({ minS: intervalSeconds, maxS: intervalSeconds }).strict().refine((v) => v.minS <= v.maxS).optional(),
  })
  .strict();
const ProbeBody = z
  .object({
    category: z.enum(CATEGORIES),
    page: z.number().int().min(1).max(50),
    pages: z.number().int().min(1).max(5).optional(),
    path: z.string().regex(/^\/(?!\/)[^\s\\]{0,300}$/).optional(),
  })
  .strict();
const SweepMap = z.partialRecord(z.enum(CATEGORIES), z.string().max(3100)).default({});
const StoreBody = z.object({
  enabled: z.boolean(),
  name: z.string().max(200),
  url: z.string().max(300),
  search: z.string().max(300),
  categories: PathMap,
  sweep: SweepMap,
  colors: z.string().max(100).default(''),
});

const Login = z.object({ user: z.string().max(200), password: z.string().max(200) });

/** Rotas abertas sem sessão. */
const PUBLIC = new Set(['/api/admin/login']);

const tokenOf = (req: FastifyRequest) => readCookie(req.headers.cookie, ADMIN_COOKIE);

/**
 * Rotas em /api/admin. Toda rota (menos o login) exige sessão. Toda chamada que muda algo
 * exige o cabeçalho X-Admin: 1: um site de fora não consegue mandá-lo sem a pré-checagem de
 * CORS, que o servidor não libera (além do cookie SameSite=Strict).
 */
export function registerAdmin(app: FastifyInstance, deps: AdminDeps): void {
  app.register(
    async (admin) => {
      admin.addHook('onRequest', async (req, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-admin'] !== '1') return reply.code(403).send({ error: 'forbidden' });
        const path = req.url.split('?')[0]!;
        if (!PUBLIC.has(path) && !deps.auth.check(tokenOf(req))) return reply.code(401).send({ error: 'unauthorized' });
      });
      // Mudou algo pelo admin (fora login/logout): avisa as telas abertas (canal ao vivo).
      admin.addHook('onResponse', async (req, reply) => {
        const path = req.url.split('?')[0]!;
        if (req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400 && !PUBLIC.has(path) && !path.endsWith('/logout')) emitChange('admin');
      });

      admin.post('/login', async (req, reply) => {
        const parsed = Login.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
        const ip = clientIp(req);
        const r = deps.auth.login(parsed.data.user, parsed.data.password, ip);
        if (!r.ok) {
          req.log.warn({ ip, reason: r.reason }, 'admin: login recusado');
          return r.reason === 'too-many-attempts'
            ? reply.code(429).send({ error: r.reason, retryAt: new Date(r.retryAt!).toISOString() })
            : reply.code(401).send({ error: r.reason });
        }
        req.log.info({ ip }, 'admin: login');
        reply.header('Set-Cookie', sessionCookie(r.token, (r.expiresAt - Date.now()) / 1000));
        return { user: deps.auth.user, expiresAt: new Date(r.expiresAt).toISOString() };
      });

      admin.post('/logout', async (req, reply) => endSession(req, reply, deps));
      admin.get('/me', async () => ({ user: deps.auth.user }));
      admin.get('/status', async () => deps.status());
      admin.get('/system', async () => deps.system());

      // Lojas (antes STORE_* no .env): salvar passa a valer na hora, sem reiniciar.
      admin.get('/stores', async () => deps.stores.list());
      admin.put<{ Params: { id: string } }>('/stores/:id', async (req, reply) => {
        const id = req.params.id;
        if (!(STORES as readonly string[]).includes(id)) return reply.code(404).send({ error: 'not-found' });
        const body = StoreBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid', errors: ['Dados em formato inválido.'] });
        const r = deps.stores.save(id as StoreId, body.data);
        if ('errors' in r) return reply.code(400).send({ error: 'invalid', errors: r.errors });
        req.log.info({ store: id }, 'admin: loja salva');
        return deps.stores.list().find((s) => s.id === id);
      });

      // Painel das lojas: pausa, páginas da hora, última coleta boa, último bloqueio.
      admin.get('/stores/state', async () => deps.ops.storesState());
      admin.post<{ Params: { id: string } }>('/stores/:id/unpause', async (req, reply) => {
        const id = storeParam(req.params.id);
        if (!id) return reply.code(404).send({ error: 'not-found' });
        const had = deps.ops.unpause(id);
        req.log.info({ store: id }, 'admin: pausa retirada');
        return { ok: true, hadPause: had };
      });
      admin.post<{ Params: { id: string } }>('/stores/:id/pause', async (req, reply) => {
        const id = storeParam(req.params.id);
        const body = Pause.safeParse(req.body);
        if (!id) return reply.code(404).send({ error: 'not-found' });
        if (!body.success) return reply.code(400).send({ error: 'invalid', errors: ['Pausa: de 5 minutos a 7 dias.'] });
        deps.ops.pause(id, body.data.minutes);
        req.log.info({ store: id, minutes: body.data.minutes }, 'admin: loja pausada');
        return { ok: true };
      });
      admin.post<{ Params: { id: string } }>('/stores/:id/sweep/stop', async (req, reply) => {
        const id = storeParam(req.params.id);
        if (!id) return reply.code(404).send({ error: 'not-found' });
        if (!deps.ops.stopSweep(id)) return reply.code(409).send({ error: 'rejected', errors: ['Nenhuma varredura completa rodando nesta loja.'] });
        req.log.info({ store: id }, 'admin: varredura completa parada');
        return { ok: true };
      });
      // Intervalo da loja: listagens (páginas de categoria) ou fichas (páginas de produto).
      admin.put<{ Params: { id: string } }>('/stores/:id/interval', async (req, reply) => {
        const id = storeParam(req.params.id);
        if (!id) return reply.code(404).send({ error: 'not-found' });
        const body = IntervalBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid', errors: [INTERVAL_ERROR] });
        req.log.info({ store: id, ...body.data }, 'admin: intervalo da loja');
        const { kind, ...i } = body.data;
        return deps.ops.setInterval(id, kind, i);
      });
      // Configuração da varredura completa (categorias), guardada para o botão e a madrugada.
      admin.put<{ Params: { id: string } }>('/stores/:id/full-sweep', async (req, reply) => {
        const id = storeParam(req.params.id);
        if (!id) return reply.code(404).send({ error: 'not-found' });
        const body = FullSweepBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid', errors: [FULL_SWEEP_ERROR] });
        return deps.ops.saveSweep(id, body.data);
      });
      // Varredura completa agora; com corpo, guarda a configuração antes (a que está na tela).
      admin.post<{ Params: { id: string } }>('/stores/:id/sweep', async (req, reply) => {
        const id = storeParam(req.params.id);
        if (!id) return reply.code(404).send({ error: 'not-found' });
        if (req.body !== undefined && req.body !== null) {
          const body = FullSweepBody.safeParse(req.body);
          if (!body.success) return reply.code(400).send({ error: 'invalid', errors: [FULL_SWEEP_ERROR] });
          deps.ops.saveSweep(id, body.data);
        }
        const r = deps.ops.sweep(id);
        if (!r.ok) return reply.code(409).send({ error: 'rejected', errors: [r.error] });
        req.log.info({ store: id }, 'admin: varredura completa');
        return r;
      });

      // Teste: uma página de categoria aberta direto; responde com o que a loja devolveu.
      admin.post<{ Params: { id: string } }>('/stores/:id/probe', async (req, reply) => {
        const id = storeParam(req.params.id);
        if (!id) return reply.code(404).send({ error: 'not-found' });
        const body = ProbeBody.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid', errors: ['Teste: categoria válida, página de 1 a 50, de 1 a 5 páginas e endereço começando com /.'] });
        const { category, ...opts } = body.data;
        const r = await deps.ops.probe(id, category, opts);
        if (!r.ok) return reply.code(409).send({ error: 'rejected', errors: [r.error] });
        req.log.info({ store: id, ...body.data, status: r.results.map((x) => x.status).join(',') }, 'admin: teste de página');
        return r.results;
      });

      // Produtos do catálogo (paginado).
      admin.get('/products', async (req, reply) => {
        const q = ProductsQuery.safeParse(req.query);
        return q.success ? deps.products.list(q.data) : reply.code(400).send({ error: 'invalid' });
      });

      // Fichas técnicas: rotina, cobertura por categoria, produtos com a ficha, texto de uma página e "Ler ficha".
      admin.get('/sheets', async () => deps.sheets.routine());
      admin.put('/sheets', async (req, reply) => {
        const b = SheetRoutine.safeParse(req.body);
        if (!b.success) return reply.code(400).send({ error: 'invalid' });
        req.log.info(b.data, 'admin: rotina de fichas');
        return deps.sheets.setRoutine(b.data);
      });
      admin.get('/sheets/coverage', async () => deps.sheets.coverage());
      // Busca na web: ligar, intervalo, perguntar agora, tirar a pausa.
      admin.get('/sheets/web', async () => deps.sheets.web());
      admin.get('/sheets/web/answers', async (req, reply) => {
        const q = WebAnswersQuery.safeParse(req.query);
        return q.success ? deps.sheets.webAnswers(q.data) : reply.code(400).send({ error: 'invalid' });
      });
      admin.put('/sheets/web', async (req, reply) => {
        const b = WebFillBody.safeParse(req.body);
        if (!b.success) return reply.code(400).send({ error: 'invalid', errors: [`Busca na web: intervalo de ${STORE_INTERVAL_S_MIN} a ${STORE_INTERVAL_S_MAX} segundos, o primeiro não maior que o segundo.`] });
        req.log.info(b.data, 'admin: busca na web');
        emitChange('admin');
        return deps.sheets.setWeb(b.data);
      });
      admin.post('/sheets/web/ask', async (req, reply) => {
        const b = z.object({ key: z.string().min(1).max(200).optional() }).strict().safeParse(req.body ?? {});
        if (!b.success) return reply.code(400).send({ error: 'invalid' });
        if (b.data.key) req.log.info({ key: b.data.key }, 'admin: busca na web, refazer');
        return { answer: await deps.sheets.askWeb(b.data.key) };
      });
      // Ficha preenchida à mão (produto "precisa de você").
      admin.put('/sheets/completion', async (req, reply) => {
        const b = ManualBody.pick({ key: true, category: true }).extend({ complete: z.boolean() }).safeParse(req.body);
        if (!b.success) return reply.code(400).send({ error: 'invalid' });
        if (!deps.sheets.setCompletion(b.data)) return reply.code(404).send({ error: 'not-found' });
        emitChange('admin');
        return { ok: true };
      });
      admin.put('/sheets/manual', async (req, reply) => {
        const b = ManualBody.safeParse(req.body);
        if (!b.success) return reply.code(400).send({ error: 'invalid' });
        const r = deps.sheets.setManual(b.data);
        req.log.info({ key: b.data.key, fields: Object.keys(b.data.values), errors: r.errors }, 'admin: ficha à mão');
        emitChange('admin');
        if (r.errors.length) return reply.code(400).send({ error: 'invalid', errors: [`Valor fora do formato: ${r.errors.join(', ')}.`] });
        return { ok: true };
      });
      admin.post('/sheets/web/resume', async () => {
        emitChange('admin');
        return deps.sheets.resumeWeb();
      });
      admin.get('/sheets/products', async (req, reply) => {
        const q = SheetProductsQuery.safeParse(req.query);
        return q.success ? deps.sheets.list(q.data) : reply.code(400).send({ error: 'invalid' });
      });
      admin.get('/sheets/page', async (req, reply) => {
        const q = SheetPageQuery.safeParse(req.query);
        if (!q.success) return reply.code(400).send({ error: 'invalid' });
        return deps.sheets.page(q.data.store, q.data.sku) ?? reply.code(404).send({ error: 'not-found' });
      });
      admin.post<{ Params: { id: string; sku: string } }>('/products/:id/:sku/sheet', async (req, reply) => {
        const id = storeParam(req.params.id);
        if (!id || !/^[\w-]{1,64}$/.test(req.params.sku)) return reply.code(404).send({ error: 'not-found' });
        const r = deps.sheets.read(id, req.params.sku);
        if (!r.ok) return reply.code(409).send({ error: 'rejected', errors: [r.error] });
        req.log.info({ store: id, sku: req.params.sku }, 'admin: ler ficha');
        return r;
      });

      // Dados: cobertura, consultas (registro e linha do tempo).
      admin.get('/coverage', async () => deps.data.coverage());
      admin.get('/perf-gaps', async () => deps.data.perfGaps());
      admin.get('/attempts', async (req, reply) => {
        const q = AttemptsQuery.safeParse(req.query);
        return q.success ? deps.data.attempts(q.data) : reply.code(400).send({ error: 'invalid' });
      });
      admin.get('/attempts/timeline', async (req, reply) => {
        const q = TimelineQuery.safeParse(req.query);
        return q.success ? deps.data.timeline(q.data.hours) : reply.code(400).send({ error: 'invalid' });
      });

      // Atividade do site agora.
      admin.get('/activity', async () => deps.activity());

      // Ao vivo (SSE): as últimas consultas e cada nova, conforme acontecem.
      admin.get('/live', async (_req, reply) => {
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': conectado\n\n'); // manda os cabeçalhos já (sem consulta recente, nada sairia até o 1º aviso)
        const send = (a: StoreAttempt) => !res.writableEnded && res.write(`event: attempt\ndata: ${JSON.stringify(a)}\n\n`);
        for (const a of deps.live.recent().reverse()) send(a);
        const off = deps.live.subscribe(send);
        // Avisos de mudança (loja lendo, pausa, admin, busca no site): as telas recarregam o que mostram.
        const offChange = onChange((kind) => !res.writableEnded && res.write(`event: change\ndata: ${JSON.stringify({ kind })}\n\n`));
        const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 25_000);
        res.on('close', () => {
          off();
          offChange();
          clearInterval(ping);
        });
      });

      // Backups (data/backups): listar, criar, baixar, apagar.
      admin.get('/backups', async () => deps.backups.list());
      admin.post('/backups', async (req) => {
        const b = await deps.backups.create(deps.db(), 'manual');
        req.log.info({ backup: b.name }, 'admin: backup criado');
        return b;
      });
      admin.get<{ Params: { name: string } }>('/backups/:name', async (req, reply) => {
        const path = deps.backups.path(req.params.name);
        if (!path) return reply.code(404).send({ error: 'not-found' });
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${req.params.name}"`);
        return reply.send(createReadStream(path));
      });
      admin.delete<{ Params: { name: string } }>('/backups/:name', async (req, reply) => {
        if (!deps.backups.remove(req.params.name)) return reply.code(404).send({ error: 'not-found' });
        req.log.info({ backup: req.params.name }, 'admin: backup apagado');
        return { ok: true };
      });

      // Merge: envia um banco (.db ou .db.gz), vê o que entraria e só então aplica (com backup antes).
      admin.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MERGE_MAX_BYTES }, (_req, body, done) => done(null, body));
      admin.post('/merge', { bodyLimit: MERGE_MAX_BYTES }, async (req, reply) => {
        if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: 'invalid', errors: ['Envie o arquivo do banco (.db ou .db.gz).'] });
        const up = deps.merges.add(req.body);
        if ('error' in up) return reply.code(400).send({ error: 'invalid', errors: [up.error] });
        try {
          return { id: up.id, report: previewMerge(deps.db(), deps.merges.get(up.id)!) };
        } catch (err) {
          deps.merges.drop(up.id);
          return reply.code(400).send({ error: 'invalid', errors: [err instanceof Error ? err.message : 'Banco inválido.'] });
        }
      });
      admin.post<{ Params: { id: string } }>('/merge/:id/apply', async (req, reply) => {
        const path = deps.merges.get(req.params.id);
        if (!path) return reply.code(404).send({ error: 'not-found', errors: ['Envio expirado: mande o arquivo de novo.'] });
        const backup = await deps.backups.create(deps.db(), 'pre-merge');
        try {
          const report = applyMerge(deps.db(), path);
          req.log.info({ backup: backup.name, ...report }, 'admin: merge aplicado');
          return { backup: backup.name, report };
        } catch (err) {
          return reply.code(400).send({ error: 'invalid', errors: [err instanceof Error ? err.message : 'Não foi possível aplicar.'] });
        } finally {
          deps.merges.drop(req.params.id);
        }
      });
      admin.delete<{ Params: { id: string } }>('/merge/:id', async (req) => {
        deps.merges.drop(req.params.id);
        return { ok: true };
      });

      // Rotina: ligada e em quais lojas, valendo na hora.
      admin.get('/routine', async () => deps.ops.routine());
      admin.put('/routine', async (req, reply) => {
        const body = Routine.safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid', errors: ['Dados em formato inválido.'] });
        req.log.info(body.data, 'admin: rotina alterada');
        return deps.ops.setRoutine(body.data);
      });
    },
    { prefix: '/api/admin' },
  );
}

function endSession(req: FastifyRequest, reply: FastifyReply, deps: AdminDeps) {
  deps.auth.logout(tokenOf(req));
  reply.header('Set-Cookie', sessionCookie('', 0));
  return { ok: true };
}
