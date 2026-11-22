import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer, Specs, StoreId } from '@upgradezin/shared';
import { openDb, type Db } from '../db/db.ts';
import { listProducts, sheetStoreStatus } from '../admin/products.ts';
import { rebuildAllProductKeys, rebuildProductKeys, startProductKeys } from './identity.ts';
import { ensureTerms, idOf, saveCollection } from './prices.ts';
import { nextSheets, productSheet, saveSheet } from './sheets.ts';

afterEach(() => vi.useRealTimers());

const offer = (store: StoreId, sku: string, title: string, mpn?: string, specs: Specs = { gpuModel: 'RTX 5070', vram: 12 }): Offer =>
  ({ store, storeSku: sku, title, url: `https://${store}.example/produto/${sku}`, priceCash: 3000, inStock: true, specs, modelKey: `k${store}${sku}`, mpn, collectedAt: '' }) as Offer;

const NOW = new Date().toISOString();
function collect(db: Db, store: StoreId, offers: Offer[], category: 'gpu' | 'case' = 'gpu') {
  const ids = ensureTerms(db, [{ category, term: 'teste' }], 'seed');
  saveCollection(db, { store, category, termId: idOf(ids, { category, term: 'teste' }), offers, at: NOW, complete: true });
}

const keyOf = (db: Db, store: StoreId, sku: string) => db.prepare('SELECT product_key AS p, group_key AS g FROM listings WHERE store = ? AND store_sku = ?').get(store, sku) as { p: string | null; g: string | null };

/** A mesma placa em três lojas (a S2 com o "NAC" no fim do código) e uma placa diferente. */
function catalog() {
  const db = openDb(':memory:');
  collect(db, 's1', [offer('s1', '1', 'Placa de Vídeo Asus Dual RTX 5070 OC 12GB - DUAL-RTX5070-O12G', 'DUAL-RTX5070-O12G'), offer('s1', '9', 'Placa de Vídeo Zotac RTX 5070 Solid', 'ZT-B50700J-10P')]);
  collect(db, 's2', [offer('s2', '2', 'Placa de Video Asus Dual RTX 5070 OC, 12GB, DUAL-RTX5070-O12G-NAC', 'DUAL-RTX5070-O12G-NAC')]);
  collect(db, 's3', [offer('s3', '3', 'Placa de Vídeo Asus Dual NVIDIA GeForce RTX 5070 OC, 12GB, DUAL-RTX5070-O12G', 'DUAL-RTX5070-O12G')]);
  rebuildAllProductKeys(db);
  return db;
}

describe('chave de produto dos anúncios (banco)', () => {
  it('mesmo produto em lojas diferentes ganha a mesma chave (por categoria); recalcular sem mudança não regrava', () => {
    const db = catalog();
    expect(keyOf(db, 's1', '1')).toEqual({ p: 'gpu:DUALRTX5070O12G', g: 'gpu:DUALRTX5070O12G' });
    expect(keyOf(db, 's2', '2').p).toBe('gpu:DUALRTX5070O12G');
    expect(keyOf(db, 's3', '3').p).toBe('gpu:DUALRTX5070O12G');
    expect(keyOf(db, 's1', '9').p).toBe('gpu:ZTB50700J10P');
    expect(rebuildProductKeys(db, 'gpu')).toBe(0);
  });

  it('depois de uma coleta, recalcula a categoria (juntando as coletas seguidas); parar cancela', () => {
    vi.useFakeTimers();
    const db = openDb(':memory:');
    const stop = startProductKeys(() => db, { firstMs: 1_000, delayMs: 5_000 });
    collect(db, 's1', [offer('s1', '1', 'Placa Asus Dual RTX 5070, DUAL-RTX5070-O12G', 'DUAL-RTX5070-O12G')]);
    vi.advanceTimersByTime(1_000); // ao subir: tudo
    expect(keyOf(db, 's1', '1').p).toBe('gpu:DUALRTX5070O12G');
    vi.advanceTimersByTime(4_000); // o recálculo marcado pela coleta da s1
    collect(db, 's2', [offer('s2', '2', 'Placa Asus Dual RTX 5070, DUAL-RTX5070-O12G-NAC', 'DUAL-RTX5070-O12G-NAC')]);
    collect(db, 's3', [offer('s3', '3', 'Placa Asus Dual RTX 5070, DUAL-RTX5070-O12G', 'DUAL-RTX5070-O12G')]);
    vi.advanceTimersByTime(4_999);
    expect(keyOf(db, 's2', '2').p).toBeNull(); // ainda juntando
    vi.advanceTimersByTime(1);
    expect(keyOf(db, 's2', '2').p).toBe('gpu:DUALRTX5070O12G');
    expect(keyOf(db, 's3', '3').p).toBe('gpu:DUALRTX5070O12G');
    stop();
    collect(db, 's1', [offer('s1', '7', 'Placa Zotac RTX 5070 Solid, ZT-B50700J-10P', 'ZT-B50700J-10P')]);
    vi.advanceTimersByTime(60_000);
    expect(keyOf(db, 's1', '7').p).toBeNull(); // parado: não recalcula
  });
});

describe('ficha técnica compartilhada entre lojas (mesmo produto)', () => {
  const since = new Date(Date.now() - 86_400_000).toISOString();

  it('sem ficha própria, usa a de outro anúncio do mesmo produto, com a origem; com a própria (com medidas), a própria', () => {
    const db = catalog();
    saveSheet(db, 's1', '1', { specs: { gpuLength: 229 } });
    expect(productSheet(db, 's2', '2', since)).toMatchObject({ sheet: { specs: { gpuLength: 229 } }, from: { store: 's1', sku: '1' } });
    expect(productSheet(db, 's1', '1', since)).toEqual({ sheet: { specs: { gpuLength: 229 } } });
    expect(productSheet(db, 's1', '9', since)).toBeUndefined(); // outro produto: nada
    // Ficha própria só com o part number: a de outra loja (com medida) vale mais.
    saveSheet(db, 's3', '3', { specs: {}, mpn: 'DUAL-RTX5070-O12G' });
    expect(productSheet(db, 's3', '3', since)?.from).toEqual({ store: 's1', sku: '1' });
  });

  it('a rotina pula o produto que já tem ficha com medidas em outra loja', () => {
    const db = catalog();
    expect(nextSheets(db, 's2', since, since, 5).map((x) => x.sku)).toEqual(['2']);
    saveSheet(db, 's1', '1', { specs: { gpuLength: 229 } });
    expect(nextSheets(db, 's2', since, since, 5)).toEqual([]);
    expect(nextSheets(db, 's1', since, since, 5).map((x) => x.sku)).toEqual(['9']); // o outro produto continua
  });

  it('admin: status "de outra loja", de onde veio, os outros anúncios do mesmo produto e o andamento', () => {
    const db = catalog();
    saveSheet(db, 's1', '1', { specs: { gpuLength: 229 } });
    const s2 = listProducts(db, { store: 's2' }).items[0]!;
    expect(s2).toMatchObject({ sheetStatus: 'shared', sheet: { specs: { gpuLength: 229 } }, sheetFrom: { store: 's1', sku: '1' }, productKey: 'gpu:DUALRTX5070O12G' });
    expect(s2.siblings!.map((x) => `${x.store}:${x.sku}`).sort()).toEqual(['s1:1', 's3:3']);
    expect(listProducts(db, { sheet: 'shared' }).items.map((p) => p.sku).sort()).toEqual(['2', '3']);
    expect(listProducts(db, { sheet: 'ok' }).items.map((p) => p.sku)).toEqual(['1']);
    expect(listProducts(db, { sheet: 'missing' }).items.map((p) => p.sku)).toEqual(['9']);
    const st = sheetStoreStatus(db, [{ id: 's1', name: 'S1', canRead: true }, { id: 's2', name: 'S2', canRead: true }]);
    expect(st[0]).toMatchObject({ ok: 1, shared: 0, missing: 1, total: 2 });
    expect(st[1]).toMatchObject({ ok: 0, shared: 1, missing: 0, total: 1 });
  });
});
