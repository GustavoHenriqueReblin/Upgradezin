import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer, Specs, StoreId } from '@upgradezin/shared';
import { openDb, type Db } from '../db/db.ts';
import { listProducts } from '../admin/products.ts';
import { listSheetProducts, sheetStoreStatus } from '../admin/sheets.ts';
import { rebuildAllProductKeys, rebuildProductKeys, startProductKeys } from './identity.ts';
import { saveCollection } from './prices.ts';
import { nextSheets, productSheet, savePage } from './sheets.ts';

afterEach(() => vi.useRealTimers());

const offer = (store: StoreId, sku: string, title: string, mpn?: string, specs: Specs = { gpuModel: 'RTX 5070', vram: 12 }): Offer =>
  ({ store, storeSku: sku, title, url: `https://${store}.example/produto/${sku}`, priceCash: 3000, inStock: true, specs, modelKey: `k${store}${sku}`, mpn, collectedAt: '' }) as Offer;

const NOW = new Date().toISOString();
function collect(db: Db, store: StoreId, offers: Offer[], category: 'gpu' | 'case' = 'gpu') {
  saveCollection(db, { store, category, offers, at: NOW });
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

describe('ficha técnica juntada entre lojas (mesmo produto)', () => {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  // Fichas como as lojas escrevem: cada uma com parte dos campos.
  const LENGTH = ['GPU: GeForce RTX 5070', 'Dimensões: 229 x 120 x 50 mm'].join('\n');
  const MEMORY = ['Memória: 12 GB', 'Tipo de memória: GDDR7', 'Interface de memória: 192 bits', 'Boost: 2512 MHz', 'Consumo: 250 W'].join('\n');
  const FULL = [LENGTH, MEMORY].join('\n');

  it('junta as páginas campo a campo, com a origem de cada um; a página da própria loja vale primeiro', () => {
    const db = catalog();
    savePage(db, { store: 's1', sku: '1', category: 'gpu', text: LENGTH, at: '2026-11-20T00:00:00.000Z' });
    savePage(db, { store: 's3', sku: '3', category: 'gpu', text: MEMORY, at: '2026-11-21T00:00:00.000Z' });
    const s2 = productSheet(db, 's2', '2')!;
    expect(s2.values).toMatchObject({ chip: 'RTX 5070', lengthMm: 229, vramGb: 12, memType: 'GDDR7', busBits: 192, boostMhz: 2512, tdpW: 250 });
    expect(s2.origin.lengthMm).toEqual({ store: 's1', sku: '1' });
    expect(s2.origin.vramGb).toEqual({ store: 's3', sku: '3' });
    expect(s2.missing).toEqual([]);
    savePage(db, { store: 's2', sku: '2', category: 'gpu', text: 'Dimensões: 231 x 120 x 50 mm' });
    expect(productSheet(db, 's2', '2')!.values.lengthMm).toBe(231);
    expect(productSheet(db, 's1', '1')!.values.lengthMm).toBe(229);
    expect(productSheet(db, 's1', '9')).toBeUndefined(); // outro produto, nada lido
  });

  it('a rotina pula o produto com ficha completa; incompleta, a página das outras lojas continua na fila', () => {
    const db = catalog();
    expect(nextSheets(db, 's2', since, 5).map((x) => x.sku)).toEqual(['2']);
    savePage(db, { store: 's1', sku: '1', category: 'gpu', text: LENGTH });
    expect(nextSheets(db, 's2', since, 5).map((x) => x.sku)).toEqual(['2']); // faltam campos: a S2 pode ter
    savePage(db, { store: 's3', sku: '3', category: 'gpu', text: FULL });
    expect(nextSheets(db, 's2', since, 5)).toEqual([]);
    expect(nextSheets(db, 's1', since, 5).map((x) => x.sku)).toEqual(['9']); // o outro produto continua
  });

  it('admin: produtos com a ficha juntada, situação, filtros e o andamento por loja', () => {
    const db = catalog();
    savePage(db, { store: 's1', sku: '1', category: 'gpu', text: FULL });
    const page = listSheetProducts(db, { category: 'gpu' });
    expect(page.total).toBe(2);
    const dual = page.items.find((p) => p.key === 'gpu:DUALRTX5070O12G')!;
    expect(dual).toMatchObject({ state: 'complete', values: { chip: 'RTX 5070' }, missing: [] });
    expect(dual.listings.map((l) => `${l.store}:${l.sku}:${l.read}`).sort()).toEqual(['s1:1:true', 's2:2:false', 's3:3:false']);
    expect(listSheetProducts(db, { category: 'gpu', state: 'unread' }).items.map((p) => p.listings[0]!.sku)).toEqual(['9']);
    expect(listSheetProducts(db, { category: 'gpu', q: 'zotac' }).total).toBe(1);
    expect(listProducts(db, { store: 's2' }).items[0]!.siblings!.map((x) => `${x.store}:${x.sku}`).sort()).toEqual(['s1:1', 's3:3']);
    const st = sheetStoreStatus(db, [{ id: 's1', name: 'S1', canRead: true }, { id: 's2', name: 'S2', canRead: true }]);
    expect(st[0]).toMatchObject({ read: 1, queue: 1 }); // o 9 falta
    expect(st[1]).toMatchObject({ read: 0, queue: 0 }); // o produto dele já está completo
  });
});
