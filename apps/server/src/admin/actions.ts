import { CATEGORY_DEFS, ENABLED_CATEGORIES, type AdminStoreState, type CategoryId, type StoreId } from '@upgradezin/shared';
import { config } from '../config.ts';
import type { Db } from '../db/db.ts';
import { backoffInfo, BlockedError, jitter, PageLimitError, pagesUsed, queuedAt, registerSuccess, sleep } from '../pace.ts';
import { attemptCounts, lastAttempt } from '../prices/attempts.ts';
import { canReadSheet, canSweep, collectSweepPage, sheetOf, withBrowserSession } from '../prices/collect.ts';
import { SHEET_CATEGORIES } from '../prices/sheets.ts';
import { routineBusy, routineNextAt, routineSettings } from '../prices/routine.ts';
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

/** Categorias sendo lidas pelo "varrer agora" (loja|categoria). */
const sweeping = new Set<string>();

/** Teto de páginas de uma volta do "varrer agora" (todos os caminhos juntos). */
const SWEEP_NOW_MAX_PAGES = 200;

/**
 * "Varrer agora" (admin): lê a categoria inteira na loja agora, do começo (todos os caminhos, até
 * acabar o que está em estoque), uma página por vez na fila da loja, na frente da rotina, com o
 * intervalo e o limite por hora de sempre. Serve também para conferir um caminho novo. Loja em pausa
 * recusa. Responde na hora; as páginas aparecem em Consultas e a volta na Cobertura.
 */
export function sweepNow(db: Db, store: StoreId, category: CategoryId, now = Date.now()): CollectNowResult {
  if (!ACTIVE_STORES.includes(store)) return { ok: false, error: 'Loja desligada ou não configurada.' };
  if (!ENABLED_CATEGORIES.includes(category)) return { ok: false, error: 'Categoria inválida.' };
  if (!canSweep(store)) return { ok: false, error: 'Esta loja ainda não tem leitor de página de categoria.' };
  if (!sweepPaths(store, category).length) return { ok: false, error: `Sem página de ${CATEGORY_DEFS[category].name.toLowerCase()} nesta loja: configure em Lojas.` };
  const key = `${store}|${category}`;
  if (sweeping.has(key)) return { ok: false, error: 'Essa categoria já está sendo lida agora.' };
  const bo = backoffInfo(store);
  if (bo) return { ok: false, error: `Loja em pausa até ${new Date(bo.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Tire a pausa antes.` };
  restartSweep(db, store, category);
  sweeping.add(key);
  void withBrowserSession(async () => {
    for (let n = 0; n < SWEEP_NOW_MAX_PAGES && !jobs.signal.aborted; n++) {
      if (n > 0) await sleep(jitter(), jobs.signal);
      const s = sweepState(db, store, category);
      const r = await collectSweepPage(store, category, s.path ?? 0, s.page, jobs.signal, { origin: 'admin' });
      registerSuccess(store);
      if (r.roundDone) {
        console.info(`[admin ${store}] ${category}: volta completa${r.outOfStock ? `, ${r.outOfStock} sem estoque agora` : ''}`);
        break;
      }
    }
  })
    .catch((err) => {
      if (!jobs.signal.aborted && !(err instanceof BlockedError) && !(err instanceof PageLimitError)) console.warn(`[admin ${store}] ${category}:`, err instanceof Error ? err.message : err);
    })
    .finally(() => sweeping.delete(key));
  return { ok: true, startsAt: new Date(now).toISOString() };
}

/**
 * "Ler ficha" (admin, aba Produtos): abre a página do produto e lê a ficha técnica de novo, mesmo
 * que já esteja guardada. Na fila da loja, na frente da rotina, com o intervalo e o limite por hora
 * de sempre. Loja em pausa recusa. Responde na hora; a ficha aparece na lista quando terminar.
 */
export function readSheetNow(db: Db, store: StoreId, sku: string): CollectNowResult {
  if (!ACTIVE_STORES.includes(store)) return { ok: false, error: 'Loja desligada ou não configurada.' };
  if (!canReadSheet(store)) return { ok: false, error: 'Esta loja ainda não tem leitor de ficha técnica.' };
  const row = db.prepare('SELECT category FROM listings WHERE store = ? AND store_sku = ?').get(store, sku) as { category: CategoryId } | undefined;
  if (!row) return { ok: false, error: 'Produto não encontrado no catálogo.' };
  if (!SHEET_CATEGORIES.includes(row.category)) return { ok: false, error: 'Só placa de vídeo, gabinete e cooler têm ficha física.' };
  const bo = backoffInfo(store);
  if (bo) return { ok: false, error: `Loja em pausa até ${new Date(bo.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Tire a pausa antes.` };
  void withBrowserSession(() => sheetOf(store, sku, row.category, jobs.signal, { origin: 'admin', force: true }))
    .then((sheet) => {
      registerSuccess(store);
      console.info(`[admin ${store}] ficha ${sku}: ${sheet && (Object.keys(sheet.specs).length || sheet.mpn) ? 'lida' : 'página sem ficha'}`);
    })
    .catch((err) => {
      if (!jobs.signal.aborted) console.warn(`[admin ${store}] ficha ${sku}:`, err instanceof Error ? err.message : err);
    });
  return { ok: true, startsAt: new Date().toISOString() };
}
