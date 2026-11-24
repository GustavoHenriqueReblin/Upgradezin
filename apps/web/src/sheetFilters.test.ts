import { describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { applyFilters, DEFAULT_FILTERS, resetResultFilters, sheetOnlyFields, sheetValues, type Filters } from './filters.ts';
import { loadUi } from './uiState.ts';

const f = (patch: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...patch });
const gpu = (sku: string, sheet?: Offer['sheet']): Offer =>
  ({ store: 's1', storeSku: sku, title: `Placa ${sku}`, url: '', priceCash: 100, inStock: true, specs: {}, modelKey: sku, collectedAt: '', ...(sheet && { sheet }) }) as Offer;

describe('filtros da ficha técnica', () => {
  const offers = [
    gpu('a', { chip: 'RTX 5070', lengthMm: 300, power16Pin: 1, pcie: '5.0 x16', fans: 3 }),
    gpu('b', { chip: 'RTX 5060', lengthMm: 240, power16Pin: 0, pcie: '5.0 x8', fans: 2 }),
    gpu('c', { chip: 'RX 9060 XT', lengthMm: 270, fans: 2 }),
    gpu('d'), // sem ficha
  ];

  it('só os campos sem filtro próprio (o chip e a VRAM já têm)', () => {
    const keys = sheetOnlyFields('gpu').map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['lengthMm', 'power16Pin', 'pcie', 'fans', 'busBits', 'tdpW']));
    expect(keys).not.toContain('chip');
    expect(keys).not.toContain('vramGb');
    expect(sheetOnlyFields('case').map((x) => x.key)).not.toContain('dimensions');
  });

  it('valores escolhidos: texto, número e sim/não (no banco, 0/1); sem o valor na ficha não passa', () => {
    expect(applyFilters(offers, f({ sheet: { pcie: ['5.0 x8'] } })).map((o) => o.storeSku)).toEqual(['b']);
    expect(applyFilters(offers, f({ sheet: { fans: ['2'] } })).map((o) => o.storeSku)).toEqual(['b', 'c']);
    expect(applyFilters(offers, f({ sheet: { power16Pin: ['sim'] } })).map((o) => o.storeSku)).toEqual(['a']);
    expect(applyFilters(offers, f({ sheet: { power16Pin: ['não'] } })).map((o) => o.storeSku)).toEqual(['b']);
    expect(applyFilters(offers, f({ sheet: { fans: [] } }))).toHaveLength(4); // nada escolhido: não filtra
  });

  it('faixa (de / até) nos números; a contagem de um campo desconsidera o próprio filtro', () => {
    const cur = f({ sheetRange: { lengthMm: { max: 280 } }, sheet: { fans: ['3'] } });
    expect(applyFilters(offers, f({ sheetRange: { lengthMm: { max: 280 } } })).map((o) => o.storeSku)).toEqual(['b', 'c']);
    expect(applyFilters(offers, f({ sheetRange: { lengthMm: { min: 250, max: 280 } } })).map((o) => o.storeSku)).toEqual(['c']);
    // Ventoinhas: conta com a faixa de comprimento, sem o próprio filtro de ventoinhas.
    expect(applyFilters(offers, cur, 'sheet:fans').map((o) => o.storeSku)).toEqual(['b', 'c']);
    expect(applyFilters(offers, cur)).toEqual([]);
  });

  it('lista (soquetes do cooler, radiadores do gabinete): cada item é um valor', () => {
    const coolers = [gpu('x', { sockets: 'LGA1700,AM5' }), gpu('y', { sockets: 'AM4' })];
    const sockets = sheetOnlyFields('cooler').find((x) => x.key === 'sockets')!;
    expect(sheetValues(coolers[0]!, sockets)).toEqual(['LGA1700', 'AM5']);
    expect(applyFilters(coolers, f({ sheet: { sockets: ['AM5'] } })).map((o) => o.storeSku)).toEqual(['x']);
  });

  it('"Limpar" tira os filtros da ficha; estado salvo de outra versão não quebra', () => {
    const store = new Map<string, string>();
    globalThis.localStorage ??= { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage;
    expect(resetResultFilters(f({ sheet: { fans: ['2'] }, sheetRange: { lengthMm: { max: 1 } } }), 'gpu')).toMatchObject({ sheet: {}, sheetRange: {} });
    localStorage.setItem(
      'upgradezin.ui.v1',
      JSON.stringify({ byCategory: { gpu: { filters: { sheet: { fans: ['2'], pcie: 'x', bad: [1] }, sheetRange: { lengthMm: { max: 300, min: 'a' } } }, results: true } } }),
    );
    expect(loadUi().byCategory.gpu!.filters).toMatchObject({ sheet: { fans: ['2'] }, sheetRange: { lengthMm: { max: 300 } } });
    localStorage.setItem('upgradezin.ui.v1', JSON.stringify({ byCategory: { gpu: { filters: { sheet: null, sheetRange: [] }, results: true } } }));
    expect(loadUi().byCategory.gpu!.filters).toMatchObject({ sheet: {}, sheetRange: {} });
  });
});
