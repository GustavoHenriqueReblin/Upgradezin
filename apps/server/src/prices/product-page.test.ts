import { describe, expect, it } from 'vitest';
import type { Offer, StoreId } from '@upgradezin/shared';
import { openDb, type Db } from '../db/db.ts';
import { saveCollection } from './prices.ts';
import { productPage } from './product-page.ts';
import { savePage } from './sheets.ts';

const offer = (store: StoreId, sku: string, priceCash: number, inStock = true, image?: string): Offer =>
  ({ store, storeSku: sku, title: `Memória ${store} ${sku}`, url: `https://${store}.example/${sku}`, priceCash, inStock, specs: {}, modelKey: `m${sku}`, collectedAt: '', ...(image && { image }) }) as Offer;

const NOW = '2026-11-22T12:00:00.000Z';

function setup(): Db {
  const db = openDb(':memory:');
  saveCollection(db, { store: 's1', category: 'ram', offers: [offer('s1', 'a', 300, true)], at: '2026-11-20T12:00:00.000Z' });
  saveCollection(db, { store: 's2', category: 'ram', offers: [offer('s2', 'b', 250, true, 'https://s2.example/b.jpg')], at: NOW });
  saveCollection(db, { store: 's3', category: 'ram', offers: [offer('s3', 'c', 200, false), offer('s3', 'solo', 150, true)], at: NOW });
  db.exec("UPDATE listings SET product_key = 'ram:KF432C16BB' WHERE store_sku IN ('a', 'b', 'c'); UPDATE listings SET product_key = NULL WHERE store_sku = 'solo'");
  savePage(db, { store: 's1', sku: 'a', category: 'ram', text: 'Capacidade: 16GB (2 x 8GB)\nTipo: DDR4' });
  savePage(db, { store: 's2', sku: 'b', category: 'ram', text: 'Frequência: 3200 MHz' });
  return db;
}

describe('página do produto', () => {
  it('junta os anúncios da chave: ficha de todas as páginas, ofertas em estoque e mais baratas primeiro, título do visto há menos tempo', () => {
    const page = productPage(setup(), 'ram:KF432C16BB', ['s1', 's2', 's3'])!;
    expect(page).toMatchObject({ key: 'ram:KF432C16BB', category: 'ram', title: 'Memória s2 b', image: 'https://s2.example/b.jpg' });
    // Mais a marca que o título dá ("Memória s2 b").
    expect(page.values).toMatchObject({ capacityGb: 16, modules: 2, type: 'DDR4', mhz: 3200 });
    expect(page.offers.map((o) => [o.store, o.inStock])).toEqual([
      ['s2', true],
      ['s1', true],
      ['s3', false],
    ]);
    // Para quem usa, só o valor: nada de onde veio cada campo.
    expect(page).not.toHaveProperty('origin');
  });

  it('só as lojas ligadas; anúncio sem chave por "id:"; chave que não existe, nada', () => {
    const db = setup();
    expect(productPage(db, 'ram:KF432C16BB', ['s3'])!.offers.map((o) => o.store)).toEqual(['s3']);
    expect(productPage(db, 'ram:KF432C16BB', [])).toBeUndefined();
    const id = (db.prepare("SELECT id FROM listings WHERE store_sku = 'solo'").get() as { id: number }).id;
    expect(productPage(db, `id:${id}`, ['s3'])).toMatchObject({ title: 'Memória s3 solo', values: {} });
    // Anúncio com chave não abre por "id:" (a página dele é a da chave).
    const keyed = (db.prepare("SELECT id FROM listings WHERE store_sku = 'a'").get() as { id: number }).id;
    expect(productPage(db, `id:${keyed}`, ['s1'])).toBeUndefined();
    expect(productPage(db, 'ram:NAOEXISTE', ['s1'])).toBeUndefined();
  });
});
