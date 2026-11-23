import type { CategoryId, Offer, StoreId } from '@upgradezin/shared';
import { getMeta, metaByPrefix, setMeta, type Db } from '../db/db.ts';
import { hasListing, markOutOfStock, saveCollection } from './prices.ts';

/**
 * Rotina de preços pelas páginas de categoria das lojas (docs/ARCHITECTURE.md §8.2): a rotina lê a
 * lista de cada categoria em cada loja, página por página, retomando de onde parou. Uma categoria
 * pode ter mais de um caminho na loja (configuração da loja, "Página da categoria"): a volta lê um
 * depois do outro.
 *
 * Só o que está em estoque: as lojas listam os em estoque primeiro, então a lista de um caminho
 * acaba na primeira página sem nenhum item em estoque (ou na última página, ou no teto de páginas).
 * Anúncio novo só entra em estoque; um que já está no banco e aparece esgotado é atualizado. No fim
 * de uma volta completa, o que estava em estoque e não apareceu na volta passa a "sem estoque"
 * (markOutOfStock). Voltou ao estoque: a próxima volta o encontra entre os em estoque.
 *
 * Volta completa ("varrer agora" do admin, `full`): lê cada caminho até o fim da lista, esgotados
 * também, e grava anúncio novo mesmo esgotado (para popular o banco com o que a loja tem). O modo fica
 * no estado da volta, então uma página que a rotina leia no meio dela segue a mesma regra.
 *
 * Estado por loja e categoria em meta ("sweep:<loja>:<categoria>").
 */
export interface SweepState {
  /** Caminho da volta em andamento (posição na lista da categoria, 0 = o primeiro). */
  path?: number;
  /** Próxima página a ler no caminho; path 0 e page 1 = nenhuma volta em andamento. */
  page: number;
  /** Início da volta em andamento. */
  startedAt?: string;
  /** Algum caminho desta volta parou no teto de páginas ainda com itens em estoque: o fim da volta não marca nada como esgotado. */
  capped?: boolean;
  /** Fim da última volta completa. */
  doneAt?: string;
  /** Última falha (erro que não é bloqueio): a categoria espera antes de tentar de novo. */
  failedAt?: string;
  /** Volta completa: até o fim da lista, esgotados também. */
  full?: boolean;
}

/** Teto de páginas por caminho numa volta completa. */
export const FULL_SWEEP_MAX_PAGES = 200;

const key = (store: StoreId, category: CategoryId) => `sweep:${store}:${category}`;

export function sweepState(db: Db, store: StoreId, category: CategoryId): SweepState {
  const raw = getMeta(db, key(store, category));
  return raw ? (JSON.parse(raw) as SweepState) : { page: 1 };
}

const saveState = (db: Db, store: StoreId, category: CategoryId, s: SweepState) => setMeta(db, key(store, category), JSON.stringify(s));

/**
 * Ao subir o servidor: nenhuma varredura completa sobrevive a um reinício, então a volta completa que
 * ficou no meio volta ao normal (senão a rotina a continuaria, lendo os esgotados). Devolve quantas.
 */
export function clearFullSweeps(db: Db): number {
  let n = 0;
  for (const [k, v] of metaByPrefix(db, 'sweep:')) {
    const st = JSON.parse(v) as SweepState;
    if (!st.full) continue;
    setMeta(db, k, JSON.stringify({ page: 1, ...(st.doneAt && { doneAt: st.doneAt }) }));
    n++;
  }
  return n;
}

/** Volta em andamento (já leu alguma página). */
export const inProgress = (s: SweepState) => (s.path ?? 0) > 0 || s.page > 1;

/**
 * Recomeça a categoria do começo agora ("varrer agora" do admin): a volta seguinte não espera o
 * intervalo. `full`: volta completa, até o fim da lista (esgotados também).
 */
export function restartSweep(db: Db, store: StoreId, category: CategoryId, opts: { full?: boolean } = {}): void {
  saveState(db, store, category, { page: 1, ...(opts.full && { full: true }) });
}

/**
 * Próxima página a ler numa loja, entre as categorias com caminhos (`paths`: quantos caminhos cada
 * uma tem). Ordem: a volta em andamento; categorias nunca lidas; a volta completa mais antiga. Fica
 * de fora a categoria lida há menos de `refreshMs` ou que falhou há menos de `retryMs`. Caminho que
 * saiu da configuração no meio da volta: recomeça do primeiro.
 */
export function nextSweep(
  db: Db,
  store: StoreId,
  paths: Partial<Record<CategoryId, number>>,
  now: number,
  refreshMs: number,
  retryMs: number,
): { category: CategoryId; path: number; page: number } | null {
  const due = (Object.entries(paths) as [CategoryId, number][])
    .filter(([, n]) => n > 0)
    .map(([category, n]) => {
      const s = sweepState(db, store, category);
      return { category, s: (s.path ?? 0) < n ? s : { ...s, path: 0, page: 1 } };
    })
    .filter(({ s }) => !(s.failedAt && Date.parse(s.failedAt) > now - retryMs))
    .filter(({ s }) => inProgress(s) || !s.doneAt || Date.parse(s.doneAt) <= now - refreshMs);
  const rank = (s: SweepState) => (inProgress(s) ? 0 : !s.doneAt ? 1 : 2);
  due.sort((a, b) => rank(a.s) - rank(b.s) || (a.s.doneAt ?? '').localeCompare(b.s.doneAt ?? ''));
  const first = due[0];
  return first ? { category: first.category, path: first.s.path ?? 0, page: first.s.page } : null;
}

export interface SweepPageRun {
  store: StoreId;
  category: CategoryId;
  /** Caminho lido (posição) e quantos a categoria tem. */
  path: number;
  paths: number;
  page: number;
  /** Páginas da lista do caminho, segundo a loja, e o teto da rotina. */
  totalPages: number;
  maxPages: number;
  /** Itens em estoque na página (contados pelo adapter, antes do filtro da categoria). */
  inStock: number;
  offers: Offer[];
  at: string;
}

/**
 * Grava uma página e avança: na mesma lista, no caminho seguinte ou no fim da volta. Devolve o que
 * aconteceu: quantas ofertas gravou, se a lista do caminho acabou, se a volta acabou e quantos
 * anúncios passaram a "sem estoque" no fim dela.
 */
export function recordSweepPage(db: Db, run: SweepPageRun): { saved: number; listEnded: boolean; roundDone: boolean; outOfStock: number; repeated: boolean } {
  const { store, category, path, paths, page, totalPages, inStock, offers, at } = run;
  const prev = sweepState(db, store, category);
  // Página que só traz o que esta volta já viu (a loja devolveu de novo uma página anterior): a lista
  // não anda mais. Para aqui, como no teto, sem marcar nada como esgotado (o resto pode não ter sido lido).
  const seenAt = db.prepare('SELECT last_seen_at FROM listings WHERE store = ? AND store_sku = ?');
  const repeated =
    page > 1 &&
    offers.length > 0 &&
    inProgress(prev) &&
    !!prev.startedAt &&
    offers.every((o) => ((seenAt.get(store, o.storeSku) as { last_seen_at: string } | undefined)?.last_seen_at ?? '') >= prev.startedAt!);
  if (repeated) console.warn(`[${store}] ${category} pág ${page}: só produtos que esta volta já viu (a loja repetiu a página); fim da lista aqui`);
  const full = !!prev.full;
  const maxPages = full ? Math.max(run.maxPages, FULL_SWEEP_MAX_PAGES) : run.maxPages;
  // Esgotado só atualiza o anúncio que já existe (não cria anúncio novo de produto que não dá para
  // comprar), menos na volta completa, que serve para popular o banco com tudo o que a loja tem.
  const keep = full ? offers : offers.filter((o) => o.inStock || hasListing(db, store, o.storeSku));
  saveCollection(db, { store, category, offers: keep, at });
  const started = inProgress(prev) && prev.startedAt ? prev.startedAt : at;
  // Volta começada antes de o início ser guardado: não dá para saber o que ela já viu, então o fim
  // dela não marca nada como esgotado (antes, marcava tudo o que não estava na última página).
  const capped = inProgress(prev) && (!!prev.capped || !prev.startedAt);
  const atCap = repeated || (page >= maxPages && page < totalPages && (full || inStock > 0));
  const listEnded = repeated || (!full && inStock === 0) || page >= totalPages || page >= maxPages;
  const mode = full ? { full: true } : {};
  let outOfStock = 0;
  if (!listEnded) {
    saveState(db, store, category, { path, page: page + 1, startedAt: started, capped, doneAt: prev.doneAt, ...mode });
  } else if (path + 1 < paths) {
    saveState(db, store, category, { path: path + 1, page: 1, startedAt: started, capped: capped || atCap, doneAt: prev.doneAt, ...mode });
  } else {
    if (!capped && !atCap) outOfStock = markOutOfStock(db, store, category, started, at);
    saveState(db, store, category, { page: 1, doneAt: at });
  }
  return { saved: keep.length, listEnded, roundDone: listEnded && path + 1 >= paths, outOfStock, repeated };
}

/** Erro numa página (fora bloqueio): a categoria espera e depois retoma da mesma página. */
export function recordSweepFailure(db: Db, store: StoreId, category: CategoryId, at: string): void {
  saveState(db, store, category, { ...sweepState(db, store, category), failedAt: at });
}
