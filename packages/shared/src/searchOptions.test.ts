import { describe, expect, it } from 'vitest';
import { searchOptionCounts } from './searchOptions.ts';
import { isFormTerm, termMatches } from './terms.ts';
import type { Offer } from './types.ts';

const o = (store: Offer['store'], sku: string, specs: Offer['specs'], extra: Partial<Offer> = {}): Offer =>
  ({ store, storeSku: sku, title: sku, url: '', priceCash: 1, inStock: true, specs, modelKey: sku, collectedAt: '', ...extra }) as Offer;

describe('opções do formulário da busca', () => {
  it('conta produtos (não anúncios), só em estoque e da própria loja', () => {
    const offers = [
      o('s1', '1', { watts: 750 }, { productKey: 'psu:A' }),
      o('s2', '9', { watts: 750 }, { productKey: 'psu:A' }), // o mesmo produto em outra loja
      o('s1', '2', { watts: 750, efficiency: 'gold' }),
      o('s1', '3', { watts: 1600 }),
      o('s1', '4', { watts: 650 }, { inStock: false }),
      o('s1', '5', { watts: 850 }, { marketplace: true }),
    ];
    expect(searchOptionCounts('psu', offers)).toEqual({ watts: { 750: 2, 1600: 1 }, efficiency: { gold: 1 }, modular: {} });
  });

  it('memória: capacidade e frequência por tipo', () => {
    const c = searchOptionCounts('ram', [o('s1', '1', { memory: 'ddr5', ramCapacity: 32, ramSpeed: 6000, ramModules: 2 }), o('s1', '2', { memory: 'ddr4', ramCapacity: 16 })]);
    expect(c).toMatchObject({ memory: { ddr5: 1, ddr4: 1 }, capacity: { 'ddr5:32': 1, 'ddr4:16': 1 }, speed: { 'ddr5:6000': 1 }, modules: { 2: 1 } });
  });

  it('potência e capacidade que o banco tiver valem como termo (dentro da faixa)', () => {
    expect(isFormTerm('psu', '1600W')).toBe(true);
    expect(isFormTerm('psu', '750W')).toBe(true);
    expect(isFormTerm('psu', '100W')).toBe(false);
    expect(isFormTerm('psu', '9999W')).toBe(false);
    expect(isFormTerm('ram', 'DDR5 24GB')).toBe(true);
    expect(isFormTerm('ram', 'DDR3 8GB')).toBe(false);
    expect(termMatches('psu', '1600W', { watts: 1600 })).toBe(true);
    expect(termMatches('ram', 'DDR5 24GB', { memory: 'ddr5', ramCapacity: 24 })).toBe(true);
  });
});
