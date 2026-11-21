import type { Offer, SearchParams, StoreId, StoreStatusEvent } from '@upgradezin/shared';
import { config } from './config.ts';
import { getDb } from './db/instance.ts';
import { backoffInfo, BlockedError, SearchRedirectError, PageLimitError, pageLimitUntil, registerSuccess } from './pace.ts';
import { collectTerm, partialOf, withBrowserSession } from './prices/collect.ts';
import { ensureTerms, idOf, matchingListings, readResult, withHistoryStats, type DueTerm } from './prices/prices.ts';

export interface SearchHandlers {
  onStatus(e: StoreStatusEvent): void;
  /** partial=true: lote de uma página (acrescentar). false: lista final da loja (substituir). */
  onOffers(store: StoreId, offers: Offer[], partial?: boolean): void;
}

/**
 * Busca do site: responde na hora com o que o banco tem (termos + anúncios que batem pelas
 * specs) e, por trás, consulta as lojas para os termos coletados há mais de REVALIDATE_MIN,
 * na frente da rotina (no reduzido e no lento, respeitando o intervalo do modo). O resultado
 * troca quando a consulta chega, e o que ela trouxer também vai para o banco.
 */
export async function runSearch(p: SearchParams, handlers: SearchHandlers, signal: AbortSignal, force = false) {
  // A pessoa saiu da página (ou "Parar"): a tela para de receber, mas a consulta que já saiu
  // termina e grava no banco. Assim a próxima busca já acha o preço fresco.
  const h: SearchHandlers = {
    onStatus: (e) => !signal.aborted && handlers.onStatus(e),
    onOffers: (store, offers, partial) => !signal.aborted && handlers.onOffers(store, offers, partial),
  };
  await withBrowserSession(() => runStores(p, h, signal, force));
}

/** Consultas da busca que seguem depois de a pessoa sair; só param quando o servidor desliga. */
const background = new AbortController();
export const stopBackgroundSearches = () => background.abort();

async function runStores(p: SearchParams, h: SearchHandlers, signal: AbortSignal, force: boolean) {
  const seen = new Set<string>();
  const terms = p.terms.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  if (!terms.length) return;
  const db = getDb();
  const ids = ensureTerms(db, terms.map((term) => ({ category: p.category, term })), p.text ? 'text' : 'user');
  const items: DueTerm[] = terms.map((term) => ({ id: idOf(ids, { category: p.category, term }), category: p.category, term }));

  await Promise.all(
    p.stores.map(async (store) => {
      if (signal.aborted) return;
      const stored = items.map((t) => readResult(db, store, t.id));
      // Lista completa da loja (não os lotes de página): vai com o resumo do histórico de cada anúncio.
      const sendList = (offers: Offer[]) => h.onOffers(store, withHistoryStats(db, offers));
      const now = Date.now();
      // Toda busca atualiza por trás: mostra o banco na hora e consulta a loja para todo termo
      // coletado há mais de REVALIDATE_MIN (a pessoa não espera; o resultado troca quando chega).
      // "Atualizar" (force) usa o mesmo piso, para não repetir uma coleta de minutos atrás.
      const revalidateBefore = now - Math.max(config.REVALIDATE_MIN, force ? config.FORCE_MIN_AGE_MIN : 0) * 60_000;
      const atOf = (i: number) => (stored[i]!.at ? Date.parse(stored[i]!.at!) : 0);
      let need = items.filter((_, i) => atOf(i) < revalidateBefore);
      // Resultado por termo; começa com o do banco e é trocado conforme a consulta ao vivo termina.
      const byTerm = new Map(items.map((t, i) => [t.id, stored[i]!.offers]));
      // Anúncios da loja que o banco já tem de outras coletas (outros termos, varredura) e batem
      // com algum termo pelas specs: sem isso, buscar "AM4" escondia o processador AM4 que só tinha
      // aparecido na coleta de "Ryzen 7" (ou numa loja bloqueada, que nunca coletou "AM4").
      const related = matchingListings(db, store, p.category, terms, new Date(now - config.SEARCH_DB_MAX_AGE_H * 3_600_000).toISOString());
      const current = () => dedupe([...related, ...[...byTerm.values()].flat()]);
      const oldest = () => {
        const ats = stored.map((r) => r.at).filter((a): a is string => !!a);
        return ats.length ? ats.sort()[0] : undefined;
      };

      // Todos os termos vão à loja, um por vez, com prioridade sobre a rotina na fila da loja.
      // O modo da loja decide o intervalo: normal vai na hora; reduzido e lento esperam o
      // intervalo do modo desde a última consulta (pace.ts, withStore). Termos mais antigos primeiro.
      need = [...need].sort((a, b) => atOf(items.indexOf(a)) - atOf(items.indexOf(b)));

      if (!need.length) {
        const offers = current();
        sendList(offers);
        h.onStatus({ store, state: 'cached', count: offers.length, at: oldest() });
        return;
      }
      // Enquanto consulta, mostra o que o banco já tem.
      if (current().length) sendList(current());

      const bo = backoffInfo(store);
      const limit = pageLimitUntil(store);
      if (bo || limit) {
        h.onStatus({
          store,
          state: 'blocked',
          reason: bo ? bo.reason : 'hourly-limit',
          count: current().length,
          at: new Date(bo ? bo.until : limit!).toISOString(),
        });
        return;
      }

      const t0 = Date.now();
      h.onStatus({ store, state: 'running', count: current().length });
      let pending: Offer[] = [];
      try {
        for (const t of need) {
          pending = [];
          const before = dedupe([...related, ...[...byTerm.entries()].filter(([id]) => id !== t.id).flatMap(([, o]) => o)]).length;
          // Sinal do servidor, não da conexão: sair da página não interrompe a consulta.
          // Termo que a loja redireciona para outra página (ex. a da categoria): fica com o que o banco já
          // tem (anúncios de outros termos que batem pelas specs) e segue para o próximo.
          const offers = await collectTerm(store, t, background.signal, {
            onPage: ({ page, total, found, offers: batch }) => {
              pending.push(...batch);
              if (batch.length) h.onOffers(store, batch, true);
              h.onStatus({ store, state: 'running', page, totalPages: total, count: before + found });
            },
            onNeedsHuman: () => h.onStatus({ store, state: 'needs-human' }),
          }).catch((err) => {
            if (err instanceof SearchRedirectError) return null;
            throw err;
          });
          if (!offers) continue;
          byTerm.set(t.id, offers);
          h.onStatus({ store, state: 'running', count: current().length });
        }
        registerSuccess(store);
        const final = current();
        sendList(final);
        h.onStatus({ store, state: 'done', count: final.length, ms: Date.now() - t0 });
      } catch (err) {
        if (background.signal.aborted) return;
        // Mantém o que já havia (banco) e o que veio antes de a loja parar.
        const kept = dedupe([...current(), ...partialOf(err), ...pending]);
        if (kept.length) sendList(kept);
        if (err instanceof PageLimitError) {
          h.onStatus({ store, state: 'blocked', reason: 'hourly-limit', count: kept.length, at: new Date(err.until).toISOString() });
        } else if (err instanceof BlockedError) {
          const b = backoffInfo(store);
          h.onStatus({ store, state: 'blocked', reason: err.reason, count: kept.length, at: b ? new Date(b.until).toISOString() : undefined });
        } else {
          console.error(`[${store}]`, err);
          h.onStatus({ store, state: 'error' });
        }
      }
    }),
  );
}

/**
 * Lista de uma loja para uma busca, só do banco: o resultado de cada termo mais os anúncios que
 * batem pelas specs (a mesma conta da busca). Usada pelas telas abertas quando chega coleta nova.
 */
export function storedList(store: StoreId, category: SearchParams['category'], terms: string[]): Offer[] {
  const db = getDb();
  const idOfTerm = db.prepare('SELECT id FROM search_terms WHERE category = ? AND lower(term) = lower(?)');
  const fromTerms = terms.flatMap((t) => {
    const row = idOfTerm.get(category, t) as { id: number } | undefined;
    return row ? readResult(db, store, row.id).offers : [];
  });
  const related = matchingListings(db, store, category, terms, new Date(Date.now() - config.SEARCH_DB_MAX_AGE_H * 3_600_000).toISOString());
  return withHistoryStats(db, dedupe([...related, ...fromTerms]));
}

/** Mesmo anúncio em dois termos: fica a versão mais recente. */
function dedupe(offers: Offer[]): Offer[] {
  const seen = new Map<string, Offer>();
  for (const o of offers) {
    const prev = seen.get(o.storeSku);
    if (!prev || o.collectedAt >= prev.collectedAt) seen.set(o.storeSku, o);
  }
  return [...seen.values()];
}
