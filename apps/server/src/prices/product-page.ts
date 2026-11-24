import { effectiveCash, type CategoryId, type Offer, type ProductPage, type StoreId } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { offerWithSheet } from './offer-sheets.ts';
import { NOT_BROKEN } from './page-errors.ts';
import { withHistoryStats } from './prices.ts';
import { productSheet } from './sheets.ts';

/**
 * Página do produto: os anúncios com a chave de produto (ou o anúncio "id:<n>", sem chave), das lojas
 * dadas, com a ficha juntada e as ofertas (em estoque primeiro, a mais barata antes). undefined: não existe.
 */
export function productPage(db: Db, key: string, stores: readonly StoreId[]): ProductPage | undefined {
  const byId = /^id:(\d{1,12})$/.exec(key);
  const rows = (
    byId
      ? db.prepare(`SELECT store, store_sku, category, title, offer FROM listings WHERE id = ? AND product_key IS NULL AND ${NOT_BROKEN}`).all(Number(byId[1]))
      : db.prepare(`SELECT store, store_sku, category, title, offer FROM listings WHERE product_key = ? AND ${NOT_BROKEN} ORDER BY last_seen_at DESC`).all(key)
  ) as { store: StoreId; store_sku: string; category: CategoryId; title: string; offer: string }[];
  const live = rows.filter((r) => stores.includes(r.store));
  const newest = live[0];
  if (!newest) return undefined;
  const values = productSheet(db, newest.store, newest.store_sku)?.values ?? {};
  const offers = withHistoryStats(
    db,
    live.map((r) => offerWithSheet(newest.category, JSON.parse(r.offer) as Offer, values, key)),
  ).sort((a, b) => Number(b.inStock) - Number(a.inStock) || effectiveCash(a) - effectiveCash(b));
  const image = offers.find((o) => o.image)?.image;
  return {
    key,
    category: newest.category,
    title: newest.title,
    ...(image && { image }),
    values,
    offers,
  };
}
