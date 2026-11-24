import { effectiveCash, productPath, type Offer, type ProductGroup } from '@upgradezin/shared';

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
 * todas quando o produto não tem nenhuma da própria loja). `rest`: as da própria loja sem a do melhor
 * preço (que já aparece em cima, com o botão).
 */
export function splitOffers(offers: Offer[]) {
  const main = offers.filter(trustedOffer).sort(byStockThenPrice);
  const others = offers.filter((o) => !trustedOffer(o)).sort(byStockThenPrice);
  const best = main.find((o) => o.inStock);
  return {
    main,
    rest: main.filter((o) => o !== best),
    others,
    best,
    othersInStock: others.filter((o) => o.inStock).length,
    history: main.length ? main : others,
  };
}

/** Página do produto de um card: a da melhor oferta, ou a de qualquer oferta do grupo que o servidor conheça. */
export function productHref(group: Pick<ProductGroup, 'best' | 'offers'>): string | undefined {
  const key = group.best.productKey ?? group.offers.find((o) => o.productKey)?.productKey;
  return key ? productPath(key) : undefined;
}
