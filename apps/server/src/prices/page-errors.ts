import type { StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';

/**
 * Página de produto que dá erro sem ser bloqueio da loja (ex.: a loja redireciona o endereço para ele
 * mesmo, e quem clica em "Ver na Loja" cai numa página de erro). Fica na tabela page_errors:
 *
 * - a rotina de fichas deixa o produto de fora por PAGE_ERROR_SKIP_MS e segue para o próximo (em vez de
 *   tentar o mesmo produto a cada vez e travar a fila da loja);
 * - com BROKEN_AFTER falhas seguidas (cada uma depois da espera, então horas entre elas: uma queda de rede
 *   não esconde nada), a oferta sai do app (busca, ofertas da categoria e página do produto);
 * - a página abrindo de novo (rotina ou "Ler ficha" do admin) apaga o registro e a oferta volta;
 * - NETWORK_STREAK erros seguidos na mesma loja, em produtos diferentes, são a rede (ou a loja) fora, não as páginas:
 *   a rotina desfaz os registros da sequência (restorePageError) e pausa a loja por NETWORK_PAUSE_MS.
 */
export const PAGE_ERROR_SKIP_MS = 6 * 3_600_000;
export const BROKEN_AFTER = 2;
export const NETWORK_STREAK = 3;
export const NETWORK_PAUSE_MS = 10 * 60_000;

/** Registro de erro da página antes de uma falha nova (null = não havia), para desfazer se for a rede. */
export type PageErrorState = { fails: number; last_at: string; detail: string } | null;

/** Condição SQL: o anúncio (tabela `listings`, sem apelido) não está com a página quebrada. */
export const NOT_BROKEN = `NOT EXISTS (SELECT 1 FROM page_errors e WHERE e.store = listings.store AND e.store_sku = listings.store_sku AND e.fails >= ${BROKEN_AFTER})`;

export function recordPageError(db: Db, store: StoreId, sku: string, detail: string, at = new Date()): number {
  db.prepare(
    `INSERT INTO page_errors (store, store_sku, fails, last_at, detail) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (store, store_sku) DO UPDATE SET fails = fails + 1, last_at = excluded.last_at, detail = excluded.detail`,
  ).run(store, sku, at.toISOString(), detail.slice(0, 200));
  return (db.prepare('SELECT fails FROM page_errors WHERE store = ? AND store_sku = ?').get(store, sku) as { fails: number }).fails;
}

export function clearPageError(db: Db, store: StoreId, sku: string): void {
  db.prepare('DELETE FROM page_errors WHERE store = ? AND store_sku = ?').run(store, sku);
}

/** Códigos da loja com erro há menos de PAGE_ERROR_SKIP_MS: fora da fila de fichas agora. */
export function recentPageErrors(db: Db, store: StoreId, now = Date.now()): Set<string> {
  const since = new Date(now - PAGE_ERROR_SKIP_MS).toISOString();
  const rows = db.prepare('SELECT store_sku FROM page_errors WHERE store = ? AND last_at > ?').all(store, since) as { store_sku: string }[];
  return new Set(rows.map((r) => r.store_sku));
}

export function pageErrorState(db: Db, store: StoreId, sku: string): PageErrorState {
  return (db.prepare('SELECT fails, last_at, detail FROM page_errors WHERE store = ? AND store_sku = ?').get(store, sku) as PageErrorState | undefined) ?? null;
}

/** Volta o registro ao estado de antes da falha (apaga se não havia): a falha foi da rede, não da página. */
export function restorePageError(db: Db, store: StoreId, sku: string, state: PageErrorState): void {
  if (!state) {
    clearPageError(db, store, sku);
    return;
  }
  db.prepare('UPDATE page_errors SET fails = ?, last_at = ?, detail = ? WHERE store = ? AND store_sku = ?').run(state.fails, state.last_at, state.detail, store, sku);
}
