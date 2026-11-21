import { describe, expect, it } from 'vitest';
import type { CategoryId, Offer, Specs, StoreId } from '@upgradezin/shared';
import { openDb, type Db } from '../db/db.ts';
import { recordAttempt } from '../prices/attempts.ts';
import { ensureTerms, idOf, saveCollection } from '../prices/prices.ts';
import { saveSheet } from '../prices/sheets.ts';
import { listProducts, sheetStoreStatus } from './products.ts';

const offer = (store: StoreId, sku: string, title: string, specs: Specs = {}, extra: Partial<Offer> = {}): Offer =>
  ({ store, storeSku: sku, title, url: `https://${store}.example/${sku}`, priceCash: 1000, inStock: true, specs, modelKey: `m${sku}`, collectedAt: '', ...extra }) as Offer;

function seen(db: Db, store: StoreId, category: CategoryId, offers: Offer[], at: string) {
  const ids = ensureTerms(db, [{ category, term: 'teste' }], 'seed');
  saveCollection(db, { store, category, termId: idOf(ids, { category, term: 'teste' }), offers, at, complete: true });
}

const NOW = Date.parse('2026-11-21T12:00:00.000Z');

function catalog() {
  const db = openDb(':memory:');
  seen(db, 's1', 'gpu', [offer('s1', 'g1', 'Placa RTX 5060 Gigabyte', { gpuModel: 'RTX 5060' }), offer('s1', 'g2', 'Placa RX 9050', { gpuModel: 'RX 9050' })], '2026-11-21T10:00:00.000Z');
  seen(db, 's1', 'case', [offer('s1', 'k1', 'Gabinete Mid Tower', {}, { inStock: false })], '2026-11-21T09:00:00.000Z');
  seen(db, 's2', 'cpu', [offer('s2', 'p1', 'Processador Ryzen 5 5600 100%', { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '5600' })], '2026-11-21T08:00:00.000Z');
  seen(db, 's2', 'cooler', [offer('s2', 'c1', 'Cooler antigo')], '2026-10-01T00:00:00.000Z'); // fora dos 14 dias
  saveSheet(db, 's1', 'g1', { specs: { gpuLength: 228 } }, '2026-11-21T11:00:00.000Z');
  saveSheet(db, 's1', 'k1', { specs: {} }, '2026-11-21T11:00:00.000Z');
  return db;
}

describe('produtos do catálogo (admin)', () => {
  it('lista paginada, do visto há menos tempo; ficha, specs do título e índice de desempenho', () => {
    const db = catalog();
    const all = listProducts(db);
    expect(all.total).toBe(5);
    // Vistos no mesmo instante: o anúncio mais novo primeiro.
    expect(all.items.map((p) => [p.sku, p.sheetStatus])).toEqual([
      ['g2', 'missing'],
      ['g1', 'ok'],
      ['k1', 'empty'],
      ['p1', 'na'], // processador não tem ficha física
      ['c1', 'missing'],
    ]);
    const g1 = all.items.find((p) => p.sku === 'g1')!;
    expect(g1).toMatchObject({ store: 's1', category: 'gpu', price: 1000, inStock: true, perf: 128, sheet: { specs: { gpuLength: 228 } }, sheetAt: '2026-11-21T11:00:00.000Z' });
    expect(all.items[0]!.perf).toBeUndefined(); // RX 9050 fora da tabela
    expect(all.items.find((p) => p.sku === 'p1')!.perf).toBe(100);

    const page2 = listProducts(db, { pageSize: 2, page: 2 });
    expect(page2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(page2.items.map((p) => p.sku)).toEqual(['k1', 'p1']);
  });

  it('filtros: loja, categoria, ficha, estoque e texto (título ou código, % literal)', () => {
    const db = catalog();
    const skus = (f: Parameters<typeof listProducts>[1]) => listProducts(db, f).items.map((p) => p.sku);
    expect(skus({ store: 's2' })).toEqual(['p1', 'c1']);
    expect(skus({ category: 'gpu' })).toEqual(['g2', 'g1']);
    expect(skus({ sheet: 'missing' })).toEqual(['g2', 'c1']);
    expect(skus({ sheet: 'na' })).toEqual(['p1']);
    expect(skus({ inStock: false })).toEqual(['k1']);
    expect(skus({ q: 'rtx' })).toEqual(['g1']);
    expect(skus({ q: 'K1' })).toEqual(['k1']); // pelo código
    expect(skus({ q: '100%' })).toEqual(['p1']);
    expect(skus({ q: '%' })).toEqual(['p1']); // não vira curinga
  });

  it('andamento das fichas por loja: lidas, sem ficha, faltam (vistos nos últimos 14 dias) e lidas na última hora', () => {
    const db = catalog();
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    recordAttempt(db, { store: 's1', at: at(10 * 60_000), kind: 'sheet', origin: 'routine', category: 'gpu', term: 'g1', status: 'ok', count: 1, ms: 900 });
    recordAttempt(db, { store: 's1', at: at(3 * 3_600_000), kind: 'sheet', origin: 'routine', category: 'case', term: 'k1', status: 'ok', count: 0, ms: 900 });
    recordAttempt(db, { store: 's1', at: at(5 * 60_000), kind: 'term', origin: 'routine', category: 'gpu', term: 'x', status: 'ok', count: 3, ms: 900 }); // termo não conta
    const st = sheetStoreStatus(db, [{ id: 's1', name: 'Loja S1', canRead: true }, { id: 's2', name: 'Loja S2', canRead: true }], NOW);
    expect(st).toEqual([
      { store: 's1', name: 'Loja S1', canRead: true, total: 3, ok: 1, empty: 1, missing: 1, lastHour: 1, lastAt: at(10 * 60_000) },
      { store: 's2', name: 'Loja S2', canRead: true, total: 0, ok: 0, empty: 0, missing: 0, lastHour: 0, lastAt: null }, // o cooler da s2 saiu do catálogo
    ]);
  });
});
