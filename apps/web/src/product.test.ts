import { describe, expect, it } from 'vitest';
import { productPath, type Offer } from '@upgradezin/shared';
import { productKeyFromUrl, splitOffers } from './product.ts';

describe('endereço da página do produto', () => {
  it('lê a chave codificada (ida e volta com productPath); outros endereços e código quebrado, nada', () => {
    expect(productKeyFromUrl(productPath('ssd:SDSSDA3N2T00G26'))).toBe('ssd:SDSSDA3N2T00G26');
    expect(productKeyFromUrl('/produto/id%3A42/')).toBe('id:42');
    expect(productKeyFromUrl('/produto/')).toBeNull();
    expect(productKeyFromUrl('/produto/a/b')).toBeNull();
    expect(productKeyFromUrl('/admin')).toBeNull();
    expect(productKeyFromUrl('/produto/%E0%A4%A')).toBeNull();
  });
});

describe('ofertas da página do produto', () => {
  const o = (store: 's1' | 's2' | 's3', sku: string, priceCash: number, extra: Partial<Offer> = {}): Offer =>
    ({ store, storeSku: sku, priceCash, inStock: true, marketplace: false, openbox: false, ...extra }) as Offer;

  it('só da própria loja e novo na lista; produto aberto e outros vendedores à parte; melhor preço e histórico sem eles', () => {
    const offers = [
      o('s3', 'aberto', 1549.99, { openbox: true }),
      o('s1', 'parceiro', 2199, { marketplace: true }),
      o('s1', 'parceiro-2', 2428.04, { marketplace: true, inStock: false }),
      o('s3', 'esgotado', 2819.99, { inStock: false }),
      o('s2', 'novo', 2649.99),
    ];
    const s = splitOffers(offers);
    expect(s.main.map((x) => x.storeSku)).toEqual(['novo', 'esgotado']);
    expect(s.others.map((x) => x.storeSku)).toEqual(['aberto', 'parceiro', 'parceiro-2']);
    expect(s.best?.storeSku).toBe('novo');
    expect(s.othersInStock).toBe(2);
    expect(s.history.map((x) => x.storeSku)).toEqual(['novo', 'esgotado']);
  });

  it('sem oferta da própria loja em estoque: sem melhor preço; sem nenhuma da própria loja, o histórico usa as outras', () => {
    expect(splitOffers([o('s3', 'esgotado', 100, { inStock: false }), o('s1', 'p', 90, { marketplace: true })]).best).toBeUndefined();
    const only = splitOffers([o('s1', 'p', 90, { marketplace: true })]);
    expect(only.main).toEqual([]);
    expect(only.history.map((x) => x.storeSku)).toEqual(['p']);
  });
});
