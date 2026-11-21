import { ENABLED_CATEGORIES, isFormTerm, isTextTerm, type AdminStoreState, type CategoryId, type StoreId } from '@upgradezin/shared';
import { config } from '../config.ts';
import type { Db } from '../db/db.ts';
import { backoffInfo, pagesUsed, queuedAt, registerSuccess } from '../pace.ts';
import { attemptCounts, lastAttempt } from '../prices/attempts.ts';
import { canReadSheet, collectTerm, sheetOf, withBrowserSession } from '../prices/collect.ts';
import { ensureTerms, idOf } from '../prices/prices.ts';
import { SHEET_CATEGORIES } from '../prices/sheets.ts';
import { routineBusy, routineNextAt, routineSettings } from '../prices/routine.ts';
import { ACTIVE_STORES, adminStores } from '../stores.ts';

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

/** Coletas pedidas no admin seguem depois da resposta; só param quando o servidor desliga. */
const jobs = new AbortController();
export const stopAdminJobs = () => jobs.abort();

export type CollectNowResult = { ok: true; startsAt: string } | { ok: false; error: string };

/**
 * "Coletar agora" (admin): consulta um termo numa loja, na fila dela, com as mesmas regras de
 * sempre (fila da loja, na frente da rotina; limite por hora). Loja em pausa recusa:
 * tire a pausa antes. Responde na hora; o resultado aparece no registro de consultas.
 */
export function collectNow(db: Db, store: StoreId, category: CategoryId, term: string, now = Date.now()): CollectNowResult {
  const t = term.trim().replace(/\s+/g, ' ');
  if (!ACTIVE_STORES.includes(store)) return { ok: false, error: 'Loja desligada ou não configurada.' };
  if (!ENABLED_CATEGORIES.includes(category)) return { ok: false, error: 'Categoria inválida.' };
  const form = isFormTerm(category, t);
  if (!form && !isTextTerm(t)) return { ok: false, error: 'Termo inválido: de 3 a 60 caracteres, letras, números e - + . /' };
  const bo = backoffInfo(store);
  if (bo) return { ok: false, error: `Loja em pausa até ${new Date(bo.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Tire a pausa antes.` };
  const ids = ensureTerms(db, [{ category, term: t }], form ? 'user' : 'text');
  const due = { id: idOf(ids, { category, term: t }), category, term: t };
  void withBrowserSession(() => collectTerm(store, due, jobs.signal, { origin: 'admin' }))
    .then((offers) => {
      registerSuccess(store);
      console.info(`[admin ${store}] ${category} "${t}": ${offers.length} ofertas`);
    })
    .catch((err) => {
      if (!jobs.signal.aborted) console.warn(`[admin ${store}] ${category} "${t}":`, err instanceof Error ? err.message : err);
    });
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
