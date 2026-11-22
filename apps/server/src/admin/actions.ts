import { ENABLED_CATEGORIES, type AdminStoreState, type FullSweepSettings, type CategoryId, type StoreId } from '@upgradezin/shared';
import { config } from '../config.ts';
import { deleteMeta, getMeta, setMeta, type Db } from '../db/db.ts';
import { backoffInfo, BlockedError, PageLimitError, pagesUsed, queuedAt, registerSuccess } from '../pace.ts';
import { attemptCounts, lastAttempt } from '../prices/attempts.ts';
import { canReadSheet, canSweep, collectSweepPage, sheetOf, withBrowserSession } from '../prices/collect.ts';
import { routineBusy, routineNextAt, routineSettings, setRoutineSettings } from '../prices/routine.ts';
import { setSheetRoutine, sheetRoutineSettings } from '../prices/sheet-routine.ts';
import { restartSweep, sweepState } from '../prices/sweep.ts';
import { ACTIVE_STORES, adminStores, sweepPaths } from '../stores.ts';

/** Situação de cada loja agora: pausa, páginas da hora, intervalo, última coleta boa e último bloqueio. */
export function storesState(db: Db, now = Date.now()): AdminStoreState[] {
  const routine = routineSettings();
  const since = new Date(now - 86_400_000).toISOString();
  return adminStores(db)
    .filter((s) => s.configured)
    .map((s) => {
      const id = s.id as StoreId;
      const bo = backoffInfo(id);
      const inRoutine = routine.enabled && routine.stores.includes(id) && s.enabled;
      // Próxima consulta da rotina, mas nunca antes do fim da pausa.
      const routineAt = inRoutine ? routineNextAt(id) : null;
      return {
        id,
        name: s.name,
        enabled: s.enabled,
        inRoutine,
        mode: routine.modes[id],
        live: routine.live[id],
        busy: routineBusy(id),
        fullSweep: fullSweepOf(id),
        fullSweepSettings: fullSweepSettings(db, id),
        sweepCategories: sweepCategoriesOf(id),
        queue: queuedAt(id),
        pause: bo ? { until: new Date(bo.until).toISOString(), step: bo.step, reason: bo.reason } : null,
        pagesUsed: pagesUsed(id),
        pagesPerHour: config.MAX_PAGES_PER_HOUR,
        routinePagesPerHour: config.ROUTINE_PAGES_PER_HOUR,
        nextAt: routineAt != null ? new Date(Math.max(routineAt, bo?.until ?? 0, now)).toISOString() : null,
        lastOk: lastAttempt(db, id, ['ok']),
        lastBlock: lastAttempt(db, id, ['blocked']),
        last24h: attemptCounts(db, id, since),
      };
    });
}

/** Leituras pedidas no admin seguem depois da resposta; só param quando o servidor desliga. */
const jobs = new AbortController();
export const stopAdminJobs = () => jobs.abort();

export type CollectNowResult = { ok: true; startsAt: string } | { ok: false; error: string };

/** Varredura completa em andamento, por loja: a categoria sendo lida e a posição dela na lista. */
const fullSweeps = new Map<StoreId, { category: CategoryId; index: number; total: number }>();

/**
 * Rotinas pausadas pela varredura completa: como estavam antes (meta "sweep-paused", para voltar ao
 * normal mesmo se o servidor reiniciar no meio). A primeira varredura pausa; a última que acaba volta.
 */
const PAUSED_KEY = 'sweep-paused';
type PausedRoutines = { routine: boolean; sheets: boolean };

function pauseRoutines(db: Db): void {
  if (getMeta(db, PAUSED_KEY)) return;
  const routine = routineSettings();
  const sheets = sheetRoutineSettings();
  const was: PausedRoutines = { routine: routine.enabled, sheets: sheets.enabled };
  setMeta(db, PAUSED_KEY, JSON.stringify(was));
  if (was.routine) setRoutineSettings({ ...routine, enabled: false });
  if (was.sheets) setSheetRoutine({ enabled: false });
}

/** Volta as rotinas a como estavam antes da varredura completa (e apaga a marca). */
export function resumeRoutines(db: Db): PausedRoutines | null {
  const raw = getMeta(db, PAUSED_KEY);
  if (!raw) return null;
  const was = JSON.parse(raw) as PausedRoutines;
  if (was.routine) setRoutineSettings({ ...routineSettings(), enabled: true });
  if (was.sheets) setSheetRoutine({ enabled: true });
  deleteMeta(db, PAUSED_KEY);
  return was;
}

/** Categorias com página configurada na loja (as que a varredura completa pode ler). */
export const sweepCategoriesOf = (store: StoreId): CategoryId[] => ENABLED_CATEGORIES.filter((c) => sweepPaths(store, c).length > 0);

const settingsKey = (store: StoreId) => `full-sweep:${store}`;

/**
 * Configuração da varredura completa da loja (meta "full-sweep:<loja>"): intervalo e categorias. Sem
 * nada guardado: PAGE_DELAY_* e todas as categorias com página. Categoria que perdeu a página sai.
 */
export function fullSweepSettings(db: Db, store: StoreId): FullSweepSettings {
  const available = sweepCategoriesOf(store);
  const raw = getMeta(db, settingsKey(store));
  const saved = raw ? (JSON.parse(raw) as Partial<FullSweepSettings>) : {};
  const minS = saved.minS ?? Math.round(config.PAGE_DELAY_MIN_MS / 1000);
  const maxS = saved.maxS ?? Math.max(minS, Math.round(config.PAGE_DELAY_MAX_MS / 1000));
  return { minS, maxS, categories: saved.categories ? available.filter((c) => saved.categories!.includes(c)) : available };
}

/** Guarda a configuração (já validada nos limites pela rota). Devolve a configuração que vale. */
export function saveFullSweepSettings(db: Db, store: StoreId, input: FullSweepSettings): FullSweepSettings {
  setMeta(db, settingsKey(store), JSON.stringify({ minS: input.minS, maxS: Math.max(input.minS, input.maxS), categories: ENABLED_CATEGORIES.filter((c) => input.categories.includes(c)) }));
  return fullSweepSettings(db, store);
}

/** Varredura completa da loja agora (para o painel das lojas). */
export const fullSweepOf = (store: StoreId) => fullSweeps.get(store) ?? null;

/** Teto de páginas de uma categoria na varredura completa (todos os caminhos juntos; cada caminho vai até FULL_SWEEP_MAX_PAGES). */
const FULL_SWEEP_CATEGORY_MAX_PAGES = 600;

/**
 * "Varredura completa" (admin): lê todas as categorias da loja, uma depois da outra, cada uma do
 * começo até o fim da lista (todos os caminhos, esgotados também: anúncio novo esgotado entra no
 * banco, para popular o catálogo com o que a loja tem; a rotina só lê o que está em estoque).
 * Pausa a rotina de preços e a de fichas enquanto roda (para não disputar a loja nem pesar no
 * servidor) e volta cada uma a como estava quando a última varredura completa acabar. Uma página por
 * vez na fila da loja, com o intervalo da varredura (configurado no admin) e o limite por hora de
 * sempre. Loja em pausa recusa. Responde na hora; as páginas aparecem em
 * Consultas e cada volta na Cobertura.
 */
export function fullSweep(db: Db, store: StoreId, now = Date.now()): CollectNowResult {
  if (!ACTIVE_STORES.includes(store)) return { ok: false, error: 'Loja desligada ou não configurada.' };
  if (!canSweep(store)) return { ok: false, error: 'Esta loja ainda não tem leitor de página de categoria.' };
  if (!sweepCategoriesOf(store).length) return { ok: false, error: 'Nenhuma página de categoria configurada nesta loja: configure em Lojas.' };
  const { minS, maxS, categories } = fullSweepSettings(db, store);
  if (!categories.length) return { ok: false, error: 'Nenhuma categoria marcada para a varredura completa desta loja.' };
  const delayMs: [number, number] = [minS * 1000, maxS * 1000];
  if (fullSweeps.has(store)) return { ok: false, error: 'A varredura completa desta loja já está rodando.' };
  const bo = backoffInfo(store);
  if (bo) return { ok: false, error: `Loja em pausa até ${new Date(bo.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Tire a pausa antes.` };
  pauseRoutines(db);
  fullSweeps.set(store, { category: categories[0]!, index: 0, total: categories.length });
  void withBrowserSession(async () => {
    for (const [index, category] of categories.entries()) {
      if (jobs.signal.aborted) break;
      fullSweeps.set(store, { category, index, total: categories.length });
      restartSweep(db, store, category, { full: true });
      try {
        for (let n = 0; n < FULL_SWEEP_CATEGORY_MAX_PAGES && !jobs.signal.aborted; n++) {
          // O intervalo entre páginas (o da varredura, configurado no admin) é aplicado na fila da loja.
          const s = sweepState(db, store, category);
          const r = await collectSweepPage(store, category, s.path ?? 0, s.page, jobs.signal, { origin: 'admin', delayMs });
          registerSuccess(store);
          if (r.roundDone) {
            console.info(`[admin ${store}] varredura completa, ${category}: volta completa${r.outOfStock ? `, ${r.outOfStock} sem estoque agora` : ''}`);
            break;
          }
        }
      } catch (err) {
        // Bloqueio ou limite da hora: para a loja inteira; erro numa categoria: segue para a próxima.
        if (jobs.signal.aborted || err instanceof BlockedError || err instanceof PageLimitError) throw err;
        console.warn(`[admin ${store}] varredura completa, ${category}:`, err instanceof Error ? err.message : err);
      }
    }
  })
    .catch((err) => {
      if (!jobs.signal.aborted) console.warn(`[admin ${store}] varredura completa parou:`, err instanceof Error ? err.message : err);
    })
    .finally(() => {
      fullSweeps.delete(store);
      // Servidor desligando: a marca fica no banco e as rotinas voltam ao subir (resumeRoutines no index).
      if (!fullSweeps.size && !jobs.signal.aborted) resumeRoutines(db);
    });
  return { ok: true, startsAt: new Date(now).toISOString() };
}

/**
 * "Ler ficha" (admin, aba Fichas): abre a página do produto e lê a ficha técnica de novo, mesmo
 * que já esteja guardada. Na fila da loja, na frente da rotina, com o intervalo e o limite por hora
 * de sempre. Loja em pausa recusa. Responde na hora; a ficha aparece na lista quando terminar.
 */
export function readSheetNow(db: Db, store: StoreId, sku: string): CollectNowResult {
  if (!ACTIVE_STORES.includes(store)) return { ok: false, error: 'Loja desligada ou não configurada.' };
  if (!canReadSheet(store)) return { ok: false, error: 'Esta loja ainda não tem leitor de ficha técnica.' };
  const row = db.prepare('SELECT category FROM listings WHERE store = ? AND store_sku = ?').get(store, sku) as { category: CategoryId } | undefined;
  if (!row) return { ok: false, error: 'Produto não encontrado no catálogo.' };
  const bo = backoffInfo(store);
  if (bo) return { ok: false, error: `Loja em pausa até ${new Date(bo.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Tire a pausa antes.` };
  void withBrowserSession(() => sheetOf(store, sku, row.category, jobs.signal, { origin: 'admin' }))
    .then((r) => {
      registerSuccess(store);
      console.info(`[admin ${store}] ficha ${sku}: ${!r?.hasSheet ? 'página sem ficha' : `${Object.keys(r.values).length} campos`}`);
    })
    .catch((err) => {
      if (!jobs.signal.aborted) console.warn(`[admin ${store}] ficha ${sku}:`, err instanceof Error ? err.message : err);
    });
  return { ok: true, startsAt: new Date().toISOString() };
}

/** Varredura completa em todas as lojas ligadas que sabem ler página de categoria (a da madrugada). */
export function fullSweepAll(db: Db): { store: StoreId; result: CollectNowResult }[] {
  return ACTIVE_STORES.filter((store) => canSweep(store)).map((store) => ({ store, result: fullSweep(db, store) }));
}
