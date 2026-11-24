import { isFormTerm, type CategoryId, type Offer, type SearchParams, type StoreId, type StoreStatusEvent } from '@upgradezin/shared';
import { config } from './config.ts';
import { getDb } from './db/instance.ts';
import { backoffInfo, BlockedError, SearchRedirectError, PageLimitError, pageLimitUntil, registerSuccess } from './pace.ts';
import { collectText, partialOf, withBrowserSession } from './prices/collect.ts';
import { applySheets } from './prices/offer-sheets.ts';
import { matchingListings, titleMatches, withHistoryStats } from './prices/prices.ts';
import { isLive } from './prices/routine.ts';
import { sweepState } from './prices/sweep.ts';

export interface SearchHandlers {
  onStatus(e: StoreStatusEvent): void;
  /** partial=true: lote de uma página (acrescentar). false: lista final da loja (substituir). */
  onOffers(store: StoreId, offers: Offer[], partial?: boolean): void;
}

/**
 * Busca do site. Os termos do formulário ("RTX 4060", "AM4", "750W"…) não vão às lojas: o
 * resultado são os anúncios do banco (lidos pela rotina nas páginas de categoria) que batem com
 * eles pelas specs. Texto livre ("Não achou? Buscar nas lojas"): o banco (títulos com todas as
 * palavras) e, nas lojas com busca ao vivo ligada, a busca da própria loja, na frente da rotina;
 * o resultado troca quando ela chega, e o que ela trouxer também vai para o banco.
 */
export async function runSearch(p: SearchParams, handlers: SearchHandlers, signal: AbortSignal, force = false) {
  // A pessoa saiu da página (ou "Parar"): a tela para de receber, mas a consulta que já saiu
  // termina e grava no banco. Assim a próxima busca já acha o que ela trouxe.
  const h: SearchHandlers = {
    onStatus: (e) => !signal.aborted && handlers.onStatus(e),
    onOffers: (store, offers, partial) => !signal.aborted && handlers.onOffers(store, offers, partial),
  };
  await withBrowserSession(() => runStores(p, h, signal, force));
}

/** Consultas da busca que seguem depois de a pessoa sair; só param quando o servidor desliga. */
const background = new AbortController();
export const stopBackgroundSearches = () => background.abort();

/** Última busca por texto que deu certo em cada loja (loja|categoria|texto): não repete por REVALIDATE_MIN. */
const searchedAt = new Map<string, number>();
const textKey = (store: StoreId, category: CategoryId, text: string) => `${store}|${category}|${text.toLowerCase()}`;

/** Testes: esquece as buscas por texto recentes. */
export const forgetTextSearches = () => searchedAt.clear();

/** Termos do formulário (specs) e textos livres de uma busca, sem repetidos. */
function splitTerms(category: CategoryId, terms: string[]) {
  const seen = new Set<string>();
  const list = terms.map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  return { form: list.filter((t) => isFormTerm(category, t)), texts: list.filter((t) => !isFormTerm(category, t)) };
}

/** O que o banco tem para a busca numa loja: os anúncios que batem com os termos do formulário e os de título com o texto. */
function fromDb(store: StoreId, category: CategoryId, form: string[], texts: string[]): Offer[] {
  const db = getDb();
  const since = new Date(Date.now() - config.SEARCH_DB_MAX_AGE_H * 3_600_000).toISOString();
  return dedupe([...(form.length ? matchingListings(db, store, category, form, since) : []), ...texts.flatMap((t) => titleMatches(db, store, category, t, since))]);
}

/** Fim da última volta completa da rotina pela categoria na loja (a idade do que o banco mostra). */
const sweptAt = (store: StoreId, category: CategoryId) => sweepState(getDb(), store, category).doneAt;

async function runStores(p: SearchParams, h: SearchHandlers, signal: AbortSignal, force: boolean) {
  const { form, texts } = splitTerms(p.category, p.terms);
  if (!form.length && !texts.length) return;
  const db = getDb();

  await Promise.all(
    p.stores.map(async (store) => {
      if (signal.aborted) return;
      // Lista completa da loja (não os lotes de página): vai com o resumo do histórico de cada anúncio.
      // Com a ficha de cada produto (o que veio da busca ao vivo ainda não tinha).
      const sendList = (offers: Offer[]) => h.onOffers(store, withHistoryStats(db, applySheets(db, p.category, offers)));
      const now = Date.now();
      // Texto buscado na loja há menos de REVALIDATE_MIN ("Atualizar": FORCE_MIN_AGE_MIN) vale o banco.
      const fresh = (Math.max(config.REVALIDATE_MIN, force ? config.FORCE_MIN_AGE_MIN : 0) || 0) * 60_000;
      const need = isLive(store) ? texts.filter((t) => (searchedAt.get(textKey(store, p.category, t)) ?? 0) < now - fresh) : [];
      const live: Offer[] = [];
      const current = () => dedupe([...fromDb(store, p.category, form, texts), ...live]);

      if (!need.length) {
        const offers = current();
        sendList(offers);
        h.onStatus({ store, state: 'cached', count: offers.length, at: sweptAt(store, p.category) });
        return;
      }
      // Enquanto consulta, mostra o que o banco já tem.
      if (current().length) sendList(current());

      const bo = backoffInfo(store);
      const limit = pageLimitUntil(store);
      if (bo || limit) {
        h.onStatus({ store, state: 'blocked', reason: bo ? bo.reason : 'hourly-limit', count: current().length, at: new Date(bo ? bo.until : limit!).toISOString() });
        return;
      }

      const t0 = Date.now();
      h.onStatus({ store, state: 'running', count: current().length });
      let pending: Offer[] = [];
      try {
        for (const text of need) {
          pending = [];
          const before = current().length;
          // Sinal do servidor, não da conexão: sair da página não interrompe a consulta.
          const offers = await collectText(store, p.category, text, background.signal, {
            onPage: ({ page, total, found, offers: batch }) => {
              pending.push(...batch);
              if (batch.length) h.onOffers(store, applySheets(db, p.category, batch), true);
              h.onStatus({ store, state: 'running', page, totalPages: total, count: before + found });
            },
            onNeedsHuman: () => h.onStatus({ store, state: 'needs-human' }),
          }).catch((err) => {
            // A loja leva o texto para a página de uma categoria: o que ela tem, a rotina já lê.
            if (err instanceof SearchRedirectError) return [];
            throw err;
          });
          searchedAt.set(textKey(store, p.category, text), Date.now());
          live.push(...offers);
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
 * Lista de uma loja para uma busca, só do banco (a mesma conta da busca). Usada pelas telas abertas
 * quando chega coleta nova.
 */
export function storedList(store: StoreId, category: CategoryId, terms: string[]): Offer[] {
  const { form, texts } = splitTerms(category, terms);
  return withHistoryStats(getDb(), fromDb(store, category, form, texts));
}

/** Mesmo anúncio duas vezes: fica a versão mais recente. */
function dedupe(offers: Offer[]): Offer[] {
  const seen = new Map<string, Offer>();
  for (const o of offers) {
    const prev = seen.get(o.storeSku);
    if (!prev || o.collectedAt >= prev.collectedAt) seen.set(o.storeSku, o);
  }
  return [...seen.values()];
}
