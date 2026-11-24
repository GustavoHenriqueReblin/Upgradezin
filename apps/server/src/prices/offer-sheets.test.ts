import { describe, expect, it } from 'vitest';
import type { Offer, StoreId } from '@upgradezin/shared';
import { openDb } from '../db/db.ts';
import { applySheets, forgetSheetIndex } from './offer-sheets.ts';
import { matchingListings, recentOffers, saveCollection } from './prices.ts';
import { savePage } from './sheets.ts';

const ram = (store: StoreId, sku: string, specs: Offer['specs'], title = `Memória ${sku}`): Offer =>
  ({ store, storeSku: sku, title, url: `https://${store}.example/${sku}`, priceCash: 100, inStock: true, specs, modelKey: `m${sku}`, collectedAt: '' }) as Offer;

describe('ficha nas ofertas do site', () => {
  it('a busca escolhe e devolve pela ficha (não pelo título); sem ficha, fica o título', () => {
    forgetSheetIndex();
    const db = openDb(':memory:');
    const now = Date.now();
    const at = new Date(now).toISOString();
    // Título errado: diz DDR4 8GB, a ficha da loja diz DDR5 16GB.
    saveCollection(db, { store: 's1', category: 'ram', at, offers: [ram('s1', '1', { memory: 'ddr4', ramCapacity: 8 }), ram('s1', '2', { memory: 'ddr4', ramCapacity: 8 }, 'Memória Kingston Fury Beast, 8GB, 3200MHz, DDR4, CL16')] });
    savePage(db, { store: 's1', sku: '1', category: 'ram', text: 'Capacidade: 16GB\nTipo: DDR5\nFrequência: 6000 MHz', at });
    const since = new Date(now - 3_600_000).toISOString();

    expect(matchingListings(db, 's1', 'ram', ['DDR5 16GB'], since).map((o) => o.storeSku)).toEqual(['1']);
    const [one] = matchingListings(db, 's1', 'ram', ['DDR5 16GB'], since);
    expect(one!.sheet).toMatchObject({ type: 'DDR5', capacityGb: 16, mhz: 6000 });
    expect(one!.productKey).toMatch(/^(id:\d+|ram:.+)$/); // a chave da página do produto
    expect(one!.specs).toMatchObject({ memory: 'ddr5', ramCapacity: 16, ramSpeed: 6000 });
    // O 2 não tem página: a ficha é o que o título diz.
    expect(matchingListings(db, 's1', 'ram', ['DDR4 8GB'], since).map((o) => o.storeSku)).toEqual(['2']);
    expect(recentOffers(db, 'ram', since).find((o) => o.storeSku === '2')!.sheet).toMatchObject({ type: 'DDR4', capacityGb: 8, mhz: 3200, cl: 16 });
    // Anúncio que o banco não conhece (busca ao vivo, ainda não gravado): sem ficha, como veio.
    const unknown = ram('s2', '9', { memory: 'ddr4' });
    expect(applySheets(db, 'ram', [unknown])).toEqual([unknown]);
    // Aplicar de novo não muda nada (a busca ao vivo aplica em cima do que já veio do banco).
    expect(applySheets(db, 'ram', [one!])).toEqual([one]);
  });
});
