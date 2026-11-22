import { effectiveCash, type Offer } from '@upgradezin/shared';

/** Chave do produto no endereço (/produto/<chave>, codificada como em productPath). null: não é a página do produto. */
export function productKeyFromUrl(path = location.pathname): string | null {
  const m = /^\/produto\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

/** Novo e vendido pela própria loja (o padrão da busca: "Só Vendido pela Própria Loja"). */
export const trustedOffer = (o: Offer) => !o.marketplace && !o.openbox;

const byStockThenPrice = (a: Offer, b: Offer) => Number(b.inStock) - Number(a.inStock) || effectiveCash(a) - effectiveCash(b);

/**
 * Ofertas da página do produto: as da própria loja (novo) aparecem; produto aberto e outros vendedores
 * ficam atrás de um botão. O melhor preço e o histórico são só das da própria loja (o histórico usa
 * todas quando o produto não tem nenhuma da própria loja).
 */
export function splitOffers(offers: Offer[]) {
  const main = offers.filter(trustedOffer).sort(byStockThenPrice);
  const others = offers.filter((o) => !trustedOffer(o)).sort(byStockThenPrice);
  return {
    main,
    others,
    best: main.find((o) => o.inStock),
    othersInStock: others.filter((o) => o.inStock).length,
    history: main.length ? main : others,
  };
}
