import { describe, expect, it } from 'vitest';
import type { CategoryId, Offer, StoreId } from '@upgradezin/shared';
import { openDb, type Db } from '../db/db.ts';
import { ensureTerms, idOf, saveCollection } from './prices.ts';
import { getSheet, nextSheets, saveSheet, sheetCounts } from './sheets.ts';

const offer = (store: StoreId, sku: string, inStock = true): Offer =>
  ({ store, storeSku: sku, title: `Produto ${sku}`, url: `https://${store}.example/${sku}`, priceCash: 100, inStock, specs: {}, modelKey: `m${sku}`, collectedAt: '' }) as Offer;

/** Grava anúncios de uma categoria numa loja, vistos em `at`. */
function seen(db: Db, store: StoreId, category: CategoryId, offers: Offer[], at: string) {
  const ids = ensureTerms(db, [{ category, term: 'teste' }], 'seed');
  saveCollection(db, { store, category, termId: idOf(ids, { category, term: 'teste' }), offers, at, complete: true });
}

const NOW = '2026-11-21T12:00:00.000Z';
const SEEN_SINCE = '2026-11-07T12:00:00.000Z';
const EMPTY_BEFORE = '2026-10-22T12:00:00.000Z';

describe('fichas técnicas guardadas', () => {
  it('com dados vale para sempre; vazia (página sem ficha) só até ser lida de novo', () => {
    const db = openDb(':memory:');
    saveSheet(db, 's1', '1', { specs: { gpuLength: 300 } }, '2020-01-01T00:00:00.000Z');
    saveSheet(db, 's1', '2', { specs: {}, mpn: 'ABC-123' }, '2020-01-01T00:00:00.000Z');
    saveSheet(db, 's1', '3', { specs: {} }, '2020-01-01T00:00:00.000Z');
    saveSheet(db, 's1', '4', { specs: {} }, NOW);
    expect(getSheet(db, 's1', '1', EMPTY_BEFORE)?.specs.gpuLength).toBe(300); // antiga, com dados: vale
    expect(getSheet(db, 's1', '2', EMPTY_BEFORE)?.mpn).toBe('ABC-123'); // só part number também conta como ficha
    expect(getSheet(db, 's1', '3', EMPTY_BEFORE)).toBeUndefined(); // vazia e antiga: ler de novo
    expect(getSheet(db, 's1', '4', EMPTY_BEFORE)).toEqual({ specs: {} }); // vazia e recente: não abre a página de novo
  });

  it('fila da rotina: placa de vídeo, gabinete e cooler, em estoque primeiro; pula os já lidos e os que saíram do catálogo', () => {
    const db = openDb(':memory:');
    seen(db, 's2', 'cooler', [offer('s2', 'c1')], NOW);
    seen(db, 's2', 'case', [offer('s2', 'k1')], NOW);
    seen(db, 's2', 'gpu', [offer('s2', 'g-sem-estoque', false), offer('s2', 'g1'), offer('s2', 'g-lida')], NOW);
    seen(db, 's2', 'gpu', [offer('s2', 'g-antiga')], '2026-10-01T00:00:00.000Z'); // não vista nos últimos 14 dias
    seen(db, 's2', 'cpu', [offer('s2', 'p1')], NOW); // processador não tem ficha física
    seen(db, 's1', 'gpu', [offer('s1', 'outra-loja')], NOW);
    saveSheet(db, 's2', 'g-lida', { specs: { gpuLength: 250 } }, NOW);
    saveSheet(db, 's2', 'k1', { specs: {} }, '2026-09-01T00:00:00.000Z'); // vazia e antiga: volta para a fila

    expect(nextSheets(db, 's2', SEEN_SINCE, EMPTY_BEFORE, 10)).toEqual([
      { sku: 'g1', category: 'gpu' },
      { sku: 'g-sem-estoque', category: 'gpu' },
      { sku: 'k1', category: 'case' },
      { sku: 'c1', category: 'cooler' },
    ]);
    expect(nextSheets(db, 's2', SEEN_SINCE, EMPTY_BEFORE)).toEqual([{ sku: 'g1', category: 'gpu' }]); // uma por vez
  });

  it('contagem por loja e categoria (cobertura do admin)', () => {
    const db = openDb(':memory:');
    seen(db, 's3', 'gpu', [offer('s3', 'a'), offer('s3', 'b')], NOW);
    saveSheet(db, 's3', 'a', { specs: { gpuLength: 280 } }, NOW);
    expect(sheetCounts(db).get('s3|gpu')).toBe(1);
  });
});
