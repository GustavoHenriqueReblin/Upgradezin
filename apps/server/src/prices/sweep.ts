import type { CategoryId, Offer, StoreId } from '@upgradezin/shared';
import { getMeta, setMeta, type Db } from '../db/db.ts';
import { saveCollection } from './prices.ts';

/**
 * Varredura de categoria (docs/ARCHITECTURE.md §8.2): a rotina lê a categoria inteira da loja,
 * algumas páginas por hora, retomando de onde parou. Cada página grava anúncios e pontos de
 * histórico como uma coleta comum, ligada a um termo especial da categoria (origin "sweep",
 * termo "*"), que a busca do site e a fila de termos ignoram.
 *
 * Estado por loja e categoria em meta ("sweep:<loja>:<categoria>"): a próxima página da volta
 * em andamento, quando a última volta terminou e a última falha.
 */
export interface SweepState {
  /** Próxima página a ler; 1 = nenhuma volta em andamento. */
  page: number;
  /** Fim da última volta completa. */
  doneAt?: string;
  /** Última falha (erro que não é bloqueio): a categoria espera antes de tentar de novo. */
  failedAt?: string;
}

/** Termo que recebe as coletas da varredura. */
export const SWEEP_TERM = '*';

const key = (store: StoreId, category: CategoryId) => `sweep:${store}:${category}`;

export function sweepState(db: Db, store: StoreId, category: CategoryId): SweepState {
  const raw = getMeta(db, key(store, category));
  return raw ? (JSON.parse(raw) as SweepState) : { page: 1 };
}

const saveState = (db: Db, store: StoreId, category: CategoryId, s: SweepState) => setMeta(db, key(store, category), JSON.stringify(s));

/** Id do termo da varredura de uma categoria (cria na primeira vez). */
export function sweepTermId(db: Db, category: CategoryId, now = new Date().toISOString()): number {
  db.prepare("INSERT INTO search_terms (category, term, origin, created_at) VALUES (?, ?, 'sweep', ?) ON CONFLICT DO NOTHING").run(category, SWEEP_TERM, now);
  return (db.prepare('SELECT id FROM search_terms WHERE category = ? AND term = ?').get(category, SWEEP_TERM) as { id: number }).id;
}

/**
 * Próxima página a ler numa loja, entre as categorias com caminho de varredura. Ordem: a volta
 * em andamento; categorias nunca varridas; a volta completa mais antiga. Fica de fora a categoria
 * varrida há menos de `refreshMs` ou que falhou há menos de `retryMs`.
 */
export function nextSweep(
  db: Db,
  store: StoreId,
  categories: CategoryId[],
  now: number,
  refreshMs: number,
  retryMs: number,
): { category: CategoryId; page: number } | null {
  const due = categories
    .map((category) => ({ category, s: sweepState(db, store, category) }))
    .filter(({ s }) => !(s.failedAt && Date.parse(s.failedAt) > now - retryMs))
    .filter(({ s }) => s.page > 1 || !s.doneAt || Date.parse(s.doneAt) <= now - refreshMs);
  const rank = (s: SweepState) => (s.page > 1 ? 0 : !s.doneAt ? 1 : 2);
  due.sort((a, b) => rank(a.s) - rank(b.s) || (a.s.doneAt ?? '').localeCompare(b.s.doneAt ?? ''));
  return due[0] ? { category: due[0].category, page: due[0].s.page } : null;
}

/**
 * Grava uma página da varredura e avança. A volta termina na última página da loja ou no teto
 * `maxPages`; a página final marca a coleta como completa.
 */
export function recordSweepPage(
  db: Db,
  run: { store: StoreId; category: CategoryId; page: number; totalPages: number; maxPages: number; offers: Offer[]; at: string },
): void {
  const { store, category, page, totalPages, maxPages, offers, at } = run;
  const last = page >= Math.min(totalPages, maxPages);
  saveCollection(db, { store, category, termId: sweepTermId(db, category, at), offers, at, complete: last });
  const prev = sweepState(db, store, category);
  saveState(db, store, category, last ? { page: 1, doneAt: at } : { ...prev, page: page + 1, failedAt: undefined });
}

/** Erro numa página (fora bloqueio): a categoria espera e depois retoma da mesma página. */
export function recordSweepFailure(db: Db, store: StoreId, category: CategoryId, at: string): void {
  saveState(db, store, category, { ...sweepState(db, store, category), failedAt: at });
}
