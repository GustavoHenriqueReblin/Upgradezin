import { withSheetSpecs, type CategoryId, type Offer, type SheetValues } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { catalogProducts } from './sheets.ts';

/**
 * Ficha nas ofertas que vão para o site: cada oferta leva a chave do produto (`productKey`, a da página
 * do produto) e a ficha juntada dele (`sheet`), e as
 * specs dos campos que a ficha cobre passam a vir dela (withSheetSpecs). Busca, filtros, montagem e
 * sugestões de upgrade leem a ficha, não o título.
 *
 * O índice anúncio → ficha é montado por categoria a partir das fichas juntadas (catalogProducts) e
 * vale por TTL_MS: ficha nova ou corrigida aparece no site em até um minuto.
 */
const TTL_MS = 60_000;
/** Anúncios vistos nos últimos dias (a busca mostra os das últimas horas). */
const SCOPE_DAYS = 30;

type Product = { key: string; values: SheetValues };
type Index = { at: number; db: Db; byListing: Map<string, Product> };
const cache = new Map<string, Index>();

/** Testes e mudanças feitas à mão: esquece os índices (o próximo pedido monta de novo). */
export const forgetSheetIndex = () => cache.clear();

function index(db: Db, category: CategoryId, now: number, scopeDays: number): Map<string, Product> {
  const key = `${category}|${scopeDays}`;
  const hit = cache.get(key);
  if (hit && hit.db === db && now - hit.at < TTL_MS) return hit.byListing;
  const byListing = new Map<string, Product>();
  for (const p of catalogProducts(db, category, new Date(now - scopeDays * 86_400_000).toISOString())) {
    for (const l of p.listings) byListing.set(`${l.store}|${l.sku}`, { key: p.key, values: p.values });
  }
  cache.set(key, { at: now, db, byListing });
  return byListing;
}

/** A oferta com a chave do produto e a ficha dele (e as specs da ficha); sem ficha, só a chave. */
export function offerWithSheet(category: CategoryId, o: Offer, sheet: SheetValues | undefined, productKey?: string): Offer {
  const keyed = productKey ? { ...o, productKey } : o;
  return sheet && Object.keys(sheet).length ? { ...keyed, sheet, specs: withSheetSpecs(category, o.specs, sheet) } : keyed;
}

/** As ofertas da categoria com a ficha de cada produto. */
export function applySheets<T extends Offer>(db: Db, category: CategoryId, offers: T[], now = Date.now(), scopeDays = SCOPE_DAYS): T[] {
  if (!offers.length) return offers;
  const byListing = index(db, category, now, scopeDays);
  return offers.map((o) => {
    const p = byListing.get(`${o.store}|${o.storeSku}`);
    return { ...o, ...offerWithSheet(category, o, p?.values, p?.key) };
  });
}
