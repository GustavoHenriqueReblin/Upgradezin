import { describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { couponFromS1ProductHtml, mapS1Product, parseS1Html } from './s1.ts';
import { COLLECTED_AT, fixture } from './fixtures.ts';

const offersOf = (file: string, category: 'psu' | 'motherboard') =>
  parseS1Html(fixture(file))
    .data.map((p) => mapS1Product(p, COLLECTED_AT, category))
    .filter((o): o is Offer => !!o);

describe('S1: parseS1Html', () => {
  it('lê o catálogo do __NEXT_DATA__ (data em string JSON)', () => {
    const cat = parseS1Html(fixture('s1-psu.html'));
    expect(cat.meta).toEqual({ totalItemsCount: 78, totalPagesCount: 2 });
    expect(cat.data).toHaveLength(4);
  });

  it('falha claro quando a página não tem __NEXT_DATA__', () => {
    expect(() => parseS1Html('<html><body>Manutenção</body></html>')).toThrow(/__NEXT_DATA__/);
  });
});

describe('S1: fonte', () => {
  const offers = offersOf('s1-psu.html', 'psu');
  const byId = (id: string) => offers.find((o) => o.storeSku === id)!;

  it('mapeia preços, parcelamento, link e part number', () => {
    expect(byId('516057')).toMatchObject({
      store: 's1',
      brand: 'Corsair',
      priceCash: 409.99,
      priceCard: 455.54,
      listPrice: 555.54,
      installments: { count: 10, value: 45.55 },
      inStock: true,
      marketplace: false,
      mpn: 'CP-9020279-BR',
      url: expect.stringMatching(/^https:\/\/www\.s1\.example\/produto\/516057\//),
    });
  });

  it('extrai specs do título', () => {
    expect(byId('691266').specs).toEqual({ watts: 750, efficiency: 'gold', efficiencyCert: 'cybenetics', modular: 'full', atx: '3.1', pcie5: true });
  });

  it('selo "CUPOM X" vira cupom com código (a % vem da página do produto)', () => {
    expect(byId('912176').coupon).toEqual({ code: 'CUPOMS1' });
  });

  it('marca oferta de marketplace', () => {
    expect(byId('923379')).toMatchObject({ marketplace: true, coupon: undefined });
  });
});

describe('S1: placa-mãe', () => {
  const offers = offersOf('s1-motherboard.html', 'motherboard');

  it('descarta itens de outras categorias da loja (kit, PC montado, acessório)', () => {
    expect(offers.map((o) => o.storeSku).sort()).toEqual(['1047422', '522300', '692460']);
  });

  it('extrai socket, chipset, formato, memória e Wi-Fi', () => {
    expect(offers.find((o) => o.storeSku === '1047422')!.specs).toEqual({ chipset: 'B550', socket: 'AM4', formFactor: 'atx', memory: 'ddr4', wifi: true, bluetooth: true });
  });

  it('selo que não é cupom ("AGORA OU NUNCA") não vira cupom', () => {
    expect(offers.find((o) => o.storeSku === '1047422')!.coupon).toBeUndefined();
  });
});

describe('S1: cupom na página do produto', () => {
  it('lê a porcentagem e as condições do texto do selo ("os cupons são limitados")', () => {
    expect(couponFromS1ProductHtml(fixture('s1-product.html'), 'CUPOMS1')).toEqual({ percent: 10, limited: true });
  });

  it('código que não aparece na página não vira desconto', () => {
    expect(couponFromS1ProductHtml(fixture('s1-product.html'), 'OUTRO')).toBeNull();
  });
});

describe('S1: oferta temporária e estoque', () => {
  const at = Date.parse(COLLECTED_AT) / 1000;
  const base = {
    code: 1, name: 'Fonte Teste 750W, 80 Plus Gold - T750', friendlyName: 'fonte-teste', sellerName: 'S1!',
    category: 'Hardware/Fontes/Fonte 750W', price: 600, priceWithDiscount: 540, maxInstallment: '10x de R$ 60,00',
    quantity: 0, available: true, flags: { isMarketplace: false, isOpenbox: false },
  };
  const map = (p: object) => mapS1Product({ ...base, ...p } as Parameters<typeof mapS1Product>[0], COLLECTED_AT, 'psu')!;

  it('fora de oferta a loja manda estoque 0: vale "disponível"', () => {
    expect(map({}).inStock).toBe(true);
    expect(map({ available: false }).inStock).toBe(false);
  });

  it('oferta ativa usa o preço dela e informa prazo e estoque', () => {
    const o = map({ offer: { price: 500, priceWithDiscount: 450, endsAt: at + 3600, quantityAvailable: 12 } });
    expect(o).toMatchObject({ priceCash: 450, priceCard: 500, promo: { left: 12, endsAt: new Date((at + 3600) * 1000).toISOString() } });
  });

  it('oferta vencida ou esgotada não vale: preço normal', () => {
    for (const offer of [
      { price: 500, priceWithDiscount: 450, endsAt: at - 60, quantityAvailable: 12 },
      { price: 500, priceWithDiscount: 450, endsAt: at + 3600, quantityAvailable: 0 },
    ]) expect(map({ offer })).toMatchObject({ priceCash: 540, priceCard: 600, promo: undefined });
  });
});

describe('S1: cupom', () => {
  const p = {
    code: 2, name: 'Processador Teste Ryzen 5 5600, AM4', friendlyName: 'processador-teste', sellerName: 'S1!',
    category: 'Hardware/Processadores', price: 1000, priceWithDiscount: 900, quantity: 0, available: true,
    flags: { isMarketplace: false, isOpenbox: false }, stamps: { title: 'CUPOM TESTE7' },
  };
  const map = (patch: object) => mapS1Product({ ...p, ...patch } as Parameters<typeof mapS1Product>[0], COLLECTED_AT, 'cpu')!;
  it('vale também sobre o preço de oferta (a loja soma os dois)', () => {
    expect(map({ offer: { price: 800, priceWithDiscount: 720 } })).toMatchObject({ priceCash: 720, coupon: { code: 'TESTE7' } });
  });
  it('não vale para produto de vendedor parceiro', () => {
    expect(map({ sellerName: 'Outra Loja', flags: { isMarketplace: true, isOpenbox: false } }).coupon).toBeUndefined();
  });
});
