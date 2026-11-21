import { describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { grabJson, mapS2Item, parseS2Rsc, rscFromHtml, s2Redirect } from './s2.ts';
import { COLLECTED_AT, fixture } from './fixtures.ts';

const parse = (file: string) => parseS2Rsc(rscFromHtml(fixture(file)));
const offersOf = (file: string, category: 'psu' | 'motherboard') =>
  parse(file)
    .items.map((it) => mapS2Item(it, COLLECTED_AT, category))
    .filter((o): o is Offer => !!o);

describe('S2: payload RSC', () => {
  it('junta os pedaços de self.__next_f do HTML e acha os produtos', () => {
    const { items, totalPages } = parse('s2-psu.html');
    expect(items).toHaveLength(5);
    expect(totalPages).toBe(61);
  });

  it('grabJson respeita colchetes dentro de strings', () => {
    expect(grabJson('x "k":[{"a":"]}"},{"b":1}] y', '"k":[')).toEqual(['[{"a":"]}"},{"b":1}]']);
  });

  it('página sem o bloco de produtos (limitação disfarçada) é diferente de busca sem resultado', () => {
    expect(parseS2Rsc('')).toEqual({ items: [], totalPages: 1, hasProducts: false, redirect: null });
    expect(parseS2Rsc('1:{"products":{"items":[],"page_info":{"total_pages":0}}}')).toMatchObject({ items: [], hasProducts: true });
  });

  it('busca que a loja redireciona para a categoria: lê a instrução do payload, sem depender do navegador seguir', () => {
    // Trecho real (anonimizado) da resposta da busca por "Water Cooler": sem bloco de produtos, com o redirect do Next.js.
    const html =
      '<script>self.__next_f.push([1,"1:{\\"name\\":\\"Loja\\"}\\n"])</script>' +
      '<script>self.__next_f.push([1,"20:E{\\"digest\\":\\"NEXT_REDIRECT;replace;/hardware/cooler-processador;307;\\"}\\n"])</script>' +
      '<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/hardware/cooler-processador"/>';
    expect(parseS2Rsc(rscFromHtml(html))).toMatchObject({ hasProducts: false, redirect: '/hardware/cooler-processador' });
    expect(s2Redirect('20:E{"digest":"NEXT_REDIRECT;push;/hardware/gabinete;307;"}')).toBe('/hardware/gabinete');
    expect(s2Redirect('1:{"products":{"items":[]}}')).toBeNull();
  });
});

describe('S2: fonte', () => {
  const offers = offersOf('s2-psu.html', 'psu');
  const byId = (id: string) => offers.find((o) => o.storeSku === id)!;

  it('mapeia preços, EAN, part number e link', () => {
    expect(byId('48503')).toMatchObject({
      store: 's2',
      brand: 'XPG',
      priceCash: 429.99,
      priceCard: 505.87,
      listPrice: 705.87,
      installments: { count: 12, value: 42.16 },
      inStock: true,
      ean: '4711085942463',
      mpn: 'KYBER750G-BKCBR',
      url: 'https://www.s2.example/fonte-xpg-kyber-750w-atx-3-1-80-plus-gold-preto-kyber750g-bkcbr',
      modelKey: 'xpg kyber 750',
    });
  });

  it('categoria com nome de cupom ("PROMO10OFF") vira cupom de 10%', () => {
    expect(byId('40925').coupon).toEqual({ code: 'PROMO10OFF', percent: 10 });
  });

  it('sem estoque', () => {
    expect(byId('58527').inStock).toBe(false);
  });

  it('marcas próprias da loja (categoria "mktplace") seguem como vendidas pela loja', () => {
    expect(byId('48233')).toMatchObject({ brand: 'S2', marketplace: false });
  });

  it('usa a potência estruturada', () => {
    expect(byId('33503').specs.watts).toBe(200);
  });
});

describe('S2: placa-mãe', () => {
  const offers = offersOf('s2-motherboard.html', 'motherboard');

  it('descarta open box (vem fora da categoria de placa-mãe)', () => {
    expect(offers.map((o) => o.storeSku)).not.toContain('63501');
  });

  it('descarta placa DDR3 (só DDR4 e DDR5)', () => {
    expect(offers.map((o) => o.storeSku)).not.toContain('43140');
    expect(offers).toHaveLength(3);
  });

  it('deduz socket e memória pelo chipset', () => {
    expect(offers.find((o) => o.storeSku === '54267')).toMatchObject({
      inStock: false,
      specs: { chipset: 'B860', socket: 'LGA1851', formFactor: 'matx', memory: 'ddr5' },
    });
  });

  it('cupom também em placa-mãe', () => {
    expect(offers.find((o) => o.storeSku === '21748')!.coupon).toEqual({ code: 'PROMO10OFF', percent: 10 });
  });
});
