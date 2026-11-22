import { describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { openDb } from '../db/db.ts';
import { withStore } from '../pace.ts';
import { hasListing, listingBrands, markOutOfStock, matchingListings, priceHistory, saveCollection, titleMatches } from './prices.ts';

const offer = (sku: string, priceCash: number, patch: Partial<Offer> = {}): Offer => ({
  store: 's1',
  storeSku: sku,
  title: `Fonte Teste ${sku} 750W`,
  url: `https://www.s1.example/produto/${sku}`,
  priceCash,
  inStock: true,
  seller: 'S1',
  marketplace: false,
  openbox: false,
  specs: { watts: 750 },
  modelKey: `psu:teste-${sku}`,
  collectedAt: '2026-11-19T10:00:00.000Z',
  ...patch,
});

function setup() {
  return { db: openDb(':memory:') };
}

describe('preços no banco', () => {
  it('histórico: um ponto só quando preço, cupom, oferta ou estoque mudam', () => {
    const { db } = setup();
    const save = (at: string, o: Offer) => saveCollection(db, { store: 's1', category: 'psu', offers: [o], at });
    save('2026-11-19T01:00:00.000Z', offer('1', 400));
    save('2026-11-19T02:00:00.000Z', offer('1', 400));
    save('2026-11-19T03:00:00.000Z', offer('1', 400, { coupon: { code: 'X', percent: 10 } }));
    save('2026-11-19T04:00:00.000Z', offer('1', 380, { coupon: { code: 'X', percent: 10 } }));
    save('2026-11-19T05:00:00.000Z', offer('1', 380, { coupon: { code: 'X', percent: 10 }, inStock: false }));
    expect(priceHistory(db, 's1', '1')).toEqual([
      { at: '2026-11-19T01:00:00.000Z', priceCash: 400, effectiveCash: 400, inStock: true },
      { at: '2026-11-19T03:00:00.000Z', priceCash: 400, effectiveCash: 360, inStock: true },
      { at: '2026-11-19T04:00:00.000Z', priceCash: 380, effectiveCash: 342, inStock: true },
      { at: '2026-11-19T05:00:00.000Z', priceCash: 380, effectiveCash: 342, inStock: false },
    ]);
  });

  it('guarda o código de barras e o part number que a loja mostra', () => {
    const { db } = setup();
    saveCollection(db, { store: 's1', category: 'psu', offers: [offer('1', 400, { mpn: 'test-psu-750' }), offer('2', 400)], at: '2026-11-19T10:00:00.000Z' });
    expect(db.prepare('SELECT store_sku, mpn FROM listings ORDER BY store_sku').all()).toEqual([
      { store_sku: '1', mpn: 'test-psu-750' },
      { store_sku: '2', mpn: null },
    ]);
    expect(hasListing(db, 's1', '1')).toBe(true);
    expect(hasListing(db, 's2', '1')).toBe(false);
  });

  it('fim de volta: o que estava em estoque e não apareceu desde o começo dela passa a "sem estoque", com ponto no histórico', () => {
    const { db } = setup();
    saveCollection(db, { store: 's1', category: 'psu', offers: [offer('1', 400), offer('2', 500), offer('3', 600, { inStock: false })], at: '2026-11-19T10:00:00.000Z' });
    saveCollection(db, { store: 's1', category: 'cpu', offers: [offer('9', 900)], at: '2026-11-19T10:00:00.000Z' }); // outra categoria
    saveCollection(db, { store: 's1', category: 'psu', offers: [offer('1', 390)], at: '2026-11-19T12:00:00.000Z' }); // a volta seguinte só viu o 1
    expect(markOutOfStock(db, 's1', 'psu', '2026-11-19T12:00:00.000Z', '2026-11-19T12:30:00.000Z')).toBe(1); // o 2 (o 3 já estava sem estoque)
    const offerOf = (sku: string) => JSON.parse((db.prepare('SELECT offer FROM listings WHERE store_sku = ?').get(sku) as { offer: string }).offer) as Offer;
    expect(offerOf('2').inStock).toBe(false);
    expect(offerOf('1').inStock).toBe(true);
    expect(offerOf('9').inStock).toBe(true);
    expect(priceHistory(db, 's1', '2').map((p) => [p.at, p.priceCash, p.inStock])).toEqual([
      ['2026-11-19T10:00:00.000Z', 500, true],
      ['2026-11-19T12:30:00.000Z', 500, false],
    ]);
    // De novo: nada muda.
    expect(markOutOfStock(db, 's1', 'psu', '2026-11-19T12:00:00.000Z', '2026-11-19T13:00:00.000Z')).toBe(0);
    // Voltou ao estoque: a próxima volta grava em estoque de novo.
    saveCollection(db, { store: 's1', category: 'psu', offers: [offer('2', 480)], at: '2026-11-20T10:00:00.000Z' });
    expect(offerOf('2').inStock).toBe(true);
    expect(priceHistory(db, 's1', '2').at(-1)).toMatchObject({ priceCash: 480, inStock: true });
  });

});

describe('fila por loja', () => {
  it('uma consulta por vez na mesma loja; lojas diferentes em paralelo', async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => async () => {
      log.push(`${name}+`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${name}-`);
    };
    const signal = new AbortController().signal;
    await Promise.all([withStore('s1', signal, job('a', 20)), withStore('s1', signal, job('b', 5)), withStore('s2', signal, job('c', 5))]);
    expect(log.indexOf('a-')).toBeLessThan(log.indexOf('b+'));
    expect(log.indexOf('c+')).toBeLessThan(log.indexOf('a-'));
  });
});

describe('pausa por bloqueio guardada', () => {
  it('carrega a pausa salva e grava/apaga a cada mudança', async () => {
    const { useBackoffStorage, backoffInfo, registerBlock, registerSuccess } = await import('../pace.ts');
    const saved: Record<string, unknown> = {};
    const until = Date.now() + 600_000;
    useBackoffStorage([['s3', { until, step: 0, reason: 'denied' }]], (store, b) => (saved[store] = b));
    expect(backoffInfo('s3')).toMatchObject({ until, reason: 'denied' });
    registerBlock('s3', 'needs-human');
    expect(saved.s3).toMatchObject({ step: 1, reason: 'needs-human' });
    registerSuccess('s3');
    expect(saved.s3).toBeNull();
    expect(backoffInfo('s3')).toBeNull();
  });
});

describe('resumo do histórico', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();

  it('menor preço em 30 dias: conta o preço que já valia no começo da janela e ignora sem estoque', async () => {
    const { withHistoryStats, listingsHistory } = await import('./prices.ts');
    const { db } = setup();
    const save = (at: string, o: Offer) => saveCollection(db, { store: 's1', category: 'psu', offers: [o], at });
    save(ago(60), offer('1', 300)); // fora da janela
    save(ago(40), offer('1', 420)); // valia quando a janela começou
    save(ago(20), offer('1', 250, { inStock: false })); // sem estoque: não conta
    save(ago(10), offer('1', 450));
    save(ago(1), offer('1', 440));
    const [o] = withHistoryStats(db, [offer('1', 440)], now);
    expect(o!.history).toEqual({ min30: 420, since: ago(60) });

    // Anúncio sem histórico: fica como está.
    expect(withHistoryStats(db, [offer('9', 100)], now)[0]!.history).toBeUndefined();

    const [h] = listingsHistory(db, [{ store: 's1', sku: '1' }]);
    expect(h!.points.map((p) => p.effectiveCash)).toEqual([300, 420, 250, 450, 440]);
    expect(h!.lastSeenAt).toBe(ago(1));
  });
});

describe('anúncios do banco que batem com o termo (matchingListings)', () => {
  it('buscar "AM4" traz os processadores AM4 do banco pelas specs; velho demais fica de fora', () => {
    const db = openDb(':memory:');
    const cpu = (sku: string, title: string, socket: 'AM4' | 'AM5', at: string) =>
      offer(sku, 1900, { store: 's2', title, specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', socket }, modelKey: `cpu:${sku}`, collectedAt: at });
    const run = (offers: Offer[], at: string) => saveCollection(db, { store: 's2', category: 'cpu', offers, at });
    run([cpu('old', 'Processador AMD Ryzen 7 1700, AM4', 'AM4', '2026-11-10T00:00:00.000Z')], '2026-11-10T00:00:00.000Z');
    run(
      [
        cpu('x3d', 'Processador AMD Ryzen 7 5800X3D, AM4', 'AM4', '2026-11-20T12:00:00.000Z'),
        cpu('7700', 'Processador AMD Ryzen 7 7700, AM5', 'AM5', '2026-11-20T12:00:00.000Z'),
      ],
      '2026-11-20T12:00:00.000Z',
    );
    const found = matchingListings(db, 's2', 'cpu', ['AM4'], '2026-11-17T12:00:00.000Z');
    expect(found.map((o) => o.storeSku)).toEqual(['x3d']);
    expect(matchingListings(db, 's1', 'cpu', ['AM4'], '2026-11-17T12:00:00.000Z')).toEqual([]);
    expect(matchingListings(db, 's2', 'cpu', ['AM4', 'AM5'], '2026-11-17T12:00:00.000Z').map((o) => o.storeSku).sort()).toEqual(['7700', 'x3d']);
  });
});

describe('texto livre no banco (titleMatches)', () => {
  it('todas as palavras no título, sem acento nem maiúsculas; só a loja e a categoria; velho demais fica de fora', () => {
    const db = openDb(':memory:');
    const at = '2026-11-20T12:00:00.000Z';
    saveCollection(db, {
      store: 's1',
      category: 'cooler',
      at,
      offers: [
        offer('a', 300, { title: 'Water Cooler Rise Mode Gamer Black, 240mm' }),
        offer('b', 200, { title: 'Air Cooler Rise Mode Glacier' }),
        offer('c', 250, { title: 'Water Cooler Gamdias Aura' }),
      ],
    });
    saveCollection(db, { store: 's1', category: 'cooler', offers: [offer('d', 100, { title: 'Water Cooler Rise Mode antigo' })], at: '2026-10-01T00:00:00.000Z' });
    const find = (text: string, store: 's1' | 's2' = 's1') => titleMatches(db, store, 'cooler', text, '2026-11-17T00:00:00.000Z').map((o) => o.storeSku).sort();
    expect(find('rise mode')).toEqual(['a', 'b']);
    expect(find('WATER rise')).toEqual(['a']);
    expect(find('glácier')).toEqual(['b']);
    expect(find('rise mode', 's2')).toEqual([]);
    expect(find('   ')).toEqual([]);
  });
});

describe('marcas dos anúncios (listingBrands)', () => {
  it('marcas da categoria vistas no período, sem repetir, sem "Outros"/"Genérica", em ordem alfabética', () => {
    const db = openDb(':memory:');
    const at = '2026-11-20T12:00:00.000Z';
    saveCollection(db, {
      store: 's1', category: 'psu', at,
      offers: [offer('1', 400, { brand: 'Mancer' }), offer('2', 500, { brand: 'Corsair' }), offer('3', 450, { brand: 'Corsair' }), offer('4', 300, { brand: 'Genérica' }), offer('5', 350, { brand: 'Gamemax' }), offer('6', 380)],
    });
    expect(listingBrands(db, 'psu', '2026-11-01T00:00:00.000Z')).toEqual(['Corsair', 'Gamemax', 'Mancer']);
    expect(listingBrands(db, 'psu', '2026-11-21T00:00:00.000Z')).toEqual([]); // nada visto desde então
    expect(listingBrands(db, 'gpu', '2026-11-01T00:00:00.000Z')).toEqual([]);
  });
});

describe('aviso de coleta nova (telas abertas)', () => {
  it('gravar uma coleta avisa quem escuta, com loja e categoria; coleta vazia não avisa', async () => {
    const { onCollected } = await import('./events.ts');
    const db = openDb(':memory:');
    const got: unknown[] = [];
    const off = onCollected((e) => got.push(e));
    saveCollection(db, { store: 's2', category: 'psu', offers: [offer('1', 400, { store: 's2' })], at: '2026-11-20T20:30:00.000Z' });
    saveCollection(db, { store: 's2', category: 'psu', offers: [], at: '2026-11-20T20:31:00.000Z' });
    off();
    saveCollection(db, { store: 's1', category: 'psu', offers: [offer('2', 500)], at: '2026-11-20T20:32:00.000Z' });
    expect(got).toEqual([{ store: 's2', category: 'psu', at: '2026-11-20T20:30:00.000Z' }]);
  });

  it('marcar "sem estoque" no fim da volta também avisa (a tela troca a lista); sem nada a marcar, não', async () => {
    const { onCollected } = await import('./events.ts');
    const db = openDb(':memory:');
    saveCollection(db, { store: 's2', category: 'psu', offers: [offer('1', 400, { store: 's2' })], at: '2026-11-20T10:00:00.000Z' });
    const got: unknown[] = [];
    const off = onCollected((e) => got.push(e));
    markOutOfStock(db, 's2', 'psu', '2026-11-20T12:00:00.000Z', '2026-11-20T12:30:00.000Z');
    markOutOfStock(db, 's2', 'psu', '2026-11-20T12:00:00.000Z', '2026-11-20T13:00:00.000Z');
    off();
    expect(got).toEqual([{ store: 's2', category: 'psu', at: '2026-11-20T12:30:00.000Z' }]);
  });
});
