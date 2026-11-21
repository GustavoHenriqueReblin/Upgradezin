import { describe, expect, it } from 'vitest';
import { extractPsuSpecs, isDesktopPsu, parseBRL } from './normalize.ts';
import { groupOffers, modelKeyFromTitle } from './group.ts';
import type { Offer } from './types.ts';

describe('extractPsuSpecs', () => {
  it.each([
    ['Fonte MACH1 Steady, 750W, 80 Plus Bronze, PFC Ativo, Preto - 750Steady', { watts: 750, efficiency: 'bronze', efficiencyCert: '80plus' }],
    ['Fonte Gigabyte UD Gold, 750W, Full-Modular, 80 Plus Gold, Preto, GP-UD750GM', { watts: 750, efficiency: 'gold', modular: 'full' }],
    ['Fonte XPG Kyber, 750W, ATX 3.1, 80 Plus Gold, Preto, KYBER750G-BKCBR', { watts: 750, efficiency: 'gold', atx: '3.1' }],
    ['Fonte Husky Stardust, 750W, Full Modular, Cybenetics Bronze', { watts: 750, efficiency: 'bronze', efficiencyCert: 'cybenetics', modular: 'full' }],
    ['Fonte Montech Century II 750W, 80 Plus Gold, ATX 3.1, PFC Ativo, Full Modular, Cinza', { watts: 750, atx: '3.1', modular: 'full' }],
    ['Fonte Corsair RM850e, 850W, 80 Plus Gold, Semi Modular, ATX 3.0, PCIe 5.0', { watts: 850, modular: 'semi', atx: '3.0', pcie5: true }],
    ['Fonte Fortrek PWS-2003, 200W, Sem Cabo, Prata', { watts: 200 }],
  ])('%s', (title, expected) => {
    expect(extractPsuSpecs(title)).toMatchObject(expected);
  });
});

describe('isDesktopPsu', () => {
  it('aceita fontes ATX', () => {
    expect(isDesktopPsu('Fonte Corsair CX750, 750W, 80 Plus Bronze')).toBe(true);
  });
  it.each([
    'Fonte De Alimentacao 110/220vac Saida 5vdc 2a 5,5x2,1mm',
    'Fonte para Notebook Dell 90W',
    'Kit Fonte 500W + Gabinete',
    'Gabinete Gamer com Fonte 500W',
  ])('rejeita %s', (t) => expect(isDesktopPsu(t)).toBe(false));
});

describe('parseBRL', () => {
  it('lê formatos brasileiros', () => {
    expect(parseBRL('R$ 1.234,56')).toBe(1234.56);
    expect(parseBRL('R$ 54,91')).toBe(54.91);
    expect(parseBRL('')).toBeUndefined();
  });
});

describe('modelKeyFromTitle', () => {
  it('normaliza títulos de lojas diferentes para a mesma chave', () => {
    const a = modelKeyFromTitle('Fonte XPG Kyber, 750W, ATX 3.1, 80 Plus Gold, Preto', 'XPG');
    const b = modelKeyFromTitle('Fonte XPG Kyber 750W 80 Plus Gold ATX 3.1 Full', 'XPG');
    expect(a).toBe('xpg kyber 750');
    expect(b).toBe(a);
  });
  it('separa variante branca', () => {
    expect(modelKeyFromTitle('Fonte Corsair RM850e 850W Branca', 'Corsair')).toBe('corsair rm850e 850 white');
  });
});

describe('groupOffers', () => {
  const base = (p: Partial<Offer>): Offer => ({
    store: 's1', storeSku: '1', title: 't', url: '', priceCash: 100, inStock: true, seller: 's',
    marketplace: false, openbox: false, specs: {}, modelKey: 'k', collectedAt: '', ...p,
  });
  it('junta por EAN mesmo com chaves diferentes e ordena pelo menor preço em estoque', () => {
    const g = groupOffers([
      base({ store: 's1', modelKey: 'a', ean: '123', priceCash: 300 }),
      base({ store: 's2', modelKey: 'b', ean: '123', priceCash: 250, inStock: false }),
      base({ store: 's3', modelKey: 'b', priceCash: 280 }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.best.store).toBe('s3');
  });
  it('mostra só a melhor oferta de cada loja', () => {
    const g = groupOffers([
      base({ store: 's3', storeSku: '1', priceCash: 369.99 }),
      base({ store: 's3', storeSku: '2', priceCash: 349.99 }),
      base({ store: 's3', storeSku: '3', priceCash: 579.99 }),
      base({ store: 's2', storeSku: '4', priceCash: 549.99 }),
      base({ store: 's2', storeSku: '5', priceCash: 399.99 }),
      base({ store: 's2', storeSku: '6', priceCash: 299.99, inStock: false }),
    ]);
    expect(g[0]!.offers.map((o) => [o.store, o.priceCash])).toEqual([
      ['s3', 349.99],
      ['s2', 399.99],
    ]);
  });
});

describe('aparência e formato da fonte', () => {
  it('branca, RGB e SFX', () => {
    expect(extractPsuSpecs('Fonte Corsair SF750, 750W, 80 Plus Platinum, SFX, Full Modular, Branca')).toMatchObject({ white: true, sfx: true });
    expect(extractPsuSpecs('Fonte Gamer Rise Mode Zeus, 650W, 80 Plus Bronze, ARGB, Preta')).toMatchObject({ rgb: true });
    expect(extractPsuSpecs('Fonte XPG Kyber, 750W, ATX 3.1, 80 Plus Gold, Preto')).not.toHaveProperty('white');
  });
  it('branca é outro produto, qualquer que seja a grafia e a posição', () => {
    const a = modelKeyFromTitle('Fonte Corsair RM850e White 850W, 80 Plus Gold', 'Corsair');
    const b = modelKeyFromTitle('Fonte Corsair RM850e, 850W, 80 Plus Gold, Branca', 'Corsair');
    expect(a).toBe('corsair rm850e 850 white');
    expect(b).toBe(a);
    expect(modelKeyFromTitle('Fonte Corsair RM850e, 850W, Preta', 'Corsair')).toBe('corsair rm850e 850');
  });
});

describe('isWhite', () => {
  it('"80 Plus White" é eficiência, não cor', () => {
    expect(extractPsuSpecs('Fonte Gamemax GS600, 600W, 80 Plus White, PFC Ativo, Black')).not.toHaveProperty('white');
    expect(modelKeyFromTitle('Fonte Gamemax GS600, 600W, 80 Plus White, PFC Ativo, Black', 'GameMax')).toBe('gamemax gs600 600');
    expect(extractPsuSpecs('Fonte PCyes Electro V2 750w White Ghost 80 Plus Bronze')).toMatchObject({ white: true });
  });
});

describe('groupOffers por part number', () => {
  const base = (p: Partial<Offer>): Offer => ({
    store: 's1', storeSku: '1', title: 't', url: '', priceCash: 100, inStock: true, seller: 's',
    marketplace: false, openbox: false, specs: {}, modelKey: 'k', collectedAt: '', ...p,
  });
  it('mesmo part number em lojas diferentes vira um produto, mesmo com chaves diferentes', () => {
    const g = groupOffers([
      base({ store: 's1', modelKey: 'a', mpn: 'KF432C16BB/16' }),
      base({ store: 's2', modelKey: 'b', mpn: 'kf432c16bb-16' }),
    ]);
    expect(g).toHaveLength(1);
  });
  it('part number ambíguo (mesma loja, produtos diferentes) é ignorado', () => {
    const g = groupOffers([
      base({ store: 's1', storeSku: '1', modelKey: 'intel core i5 14600kf', mpn: 'BX8071514' }),
      base({ store: 's1', storeSku: '2', modelKey: 'intel core i7 14700kf', mpn: 'BX8071514' }),
    ]);
    expect(g).toHaveLength(2);
  });
  it('código curto ou sem dígito não agrupa', () => {
    const g = groupOffers([base({ store: 's1', modelKey: 'a', mpn: 'AB1' }), base({ store: 's2', modelKey: 'b', mpn: 'AB1' })]);
    expect(g).toHaveLength(2);
  });
});
