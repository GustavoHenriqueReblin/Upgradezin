import { describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { openDb } from '../db/db.ts';
import { withStore } from '../pace.ts';
import { dueTerms, ensureTerms, idOf, listingBrands, markFailedRun, matchingListings, priceHistory, readResult, saveCollection } from './prices.ts';

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

const T750 = { category: 'psu' as const, term: '750W' };
const T850 = { category: 'psu' as const, term: '850W' };

function setup() {
  const db = openDb(':memory:');
  const ids = ensureTerms(db, [T750, T850], 'seed', '2026-11-19T00:00:00.000Z');
  return { db, t750: idOf(ids, T750), t850: idOf(ids, T850) };
}

describe('preços no banco', () => {
  it('termos: sem duplicar (maiúsculas não importam) e "user" marca o pedido', () => {
    const { db, t750 } = setup();
    const ids = ensureTerms(db, [{ category: 'psu', term: '750w' }], 'user', '2026-11-19T12:00:00.000Z');
    expect(idOf(ids, { category: 'psu', term: '750w' })).toBe(t750);
    expect(db.prepare('SELECT origin, last_requested_at FROM search_terms WHERE id = ?').get(t750)).toEqual({
      origin: 'user',
      last_requested_at: '2026-11-19T12:00:00.000Z',
    });
    expect((db.prepare('SELECT count(*) n FROM search_terms').get() as { n: number }).n).toBe(2);
  });

  it('sem coleta completa, o termo não tem resultado', () => {
    const { db, t750 } = setup();
    expect(readResult(db, 's1', t750)).toEqual({ offers: [] });
    saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [offer('1', 400)], at: '2026-11-19T10:00:00.000Z', complete: false });
    expect(readResult(db, 's1', t750)).toEqual({ offers: [] });
  });

  it('resultado = anúncios da última coleta completa (o que sumiu da loja sai)', () => {
    const { db, t750 } = setup();
    saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [offer('1', 400), offer('2', 500)], at: '2026-11-19T10:00:00.000Z', complete: true });
    saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [offer('2', 480)], at: '2026-11-19T22:00:00.000Z', complete: true });
    const r = readResult(db, 's1', t750);
    expect(r.at).toBe('2026-11-19T22:00:00.000Z');
    expect(r.offers.map((o) => [o.storeSku, o.priceCash])).toEqual([['2', 480]]);
    // Outra loja, mesmo termo: separado.
    expect(readResult(db, 's2', t750)).toEqual({ offers: [] });
  });

  it('coleta incompleta depois de uma completa: soma o que leu, sem perder o resto', () => {
    const { db, t750 } = setup();
    saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [offer('1', 400), offer('2', 500)], at: '2026-11-19T10:00:00.000Z', complete: true });
    saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [offer('2', 450)], at: '2026-11-19T11:00:00.000Z', complete: false });
    const r = readResult(db, 's1', t750);
    expect(r.at).toBe('2026-11-19T10:00:00.000Z');
    expect(Object.fromEntries(r.offers.map((o) => [o.storeSku, o.priceCash]))).toEqual({ '1': 400, '2': 450 });
  });

  it('histórico: um ponto só quando preço, cupom, oferta ou estoque mudam', () => {
    const { db, t750 } = setup();
    const save = (at: string, o: Offer) => saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [o], at, complete: true });
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
    const { db, t750 } = setup();
    saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [offer('1', 400, { mpn: 'test-psu-750' }), offer('2', 400)], at: '2026-11-19T10:00:00.000Z', complete: true });
    expect(db.prepare('SELECT store_sku, mpn FROM listings ORDER BY store_sku').all()).toEqual([
      { store_sku: '1', mpn: 'test-psu-750' },
      { store_sku: '2', mpn: null },
    ]);
  });

  it('rotina: pesquisado e ainda não coletado primeiro, depois nunca coletados, depois os mais antigos; respeita a espera após falha', () => {
    const { db, t750, t850 } = setup();
    const ids = ensureTerms(db, [{ category: 'psu', term: '650W' }], 'user', '2026-11-19T09:00:00.000Z');
    const t650 = idOf(ids, { category: 'psu', term: '650W' });
    const due = (okBefore: string, tryBefore = okBefore) => dueTerms(db, 's1', okBefore, tryBefore, 10).map((t) => t.term);

    expect(due('2026-11-19T12:00:00.000Z')).toEqual(['650W', '750W', '850W']);

    saveCollection(db, { store: 's1', category: 'psu', termId: t650, offers: [], at: '2026-11-19T10:00:00.000Z', complete: true });
    saveCollection(db, { store: 's1', category: 'psu', termId: t850, offers: [], at: '2026-11-19T08:00:00.000Z', complete: true });
    // 750W nunca coletado vem antes. 650W foi coletado depois do corte das 9h.
    expect(due('2026-11-19T09:00:00.000Z')).toEqual(['750W', '850W']);
    // 650W já foi coletado depois de pesquisado: vale a idade, e o mais antigo (850W) vem antes.
    expect(due('2026-11-19T12:00:00.000Z')).toEqual(['750W', '850W', '650W']);

    // Falhou agora: fica de fora até passar a espera.
    markFailedRun(db, 's1', t750, '2026-11-19T11:30:00.000Z', 'blocked');
    expect(due('2026-11-19T12:00:00.000Z', '2026-11-19T11:00:00.000Z')).toEqual(['850W', '650W']);
    expect(due('2026-11-19T12:00:00.000Z', '2026-11-19T12:00:00.000Z')).toEqual(['750W', '850W', '650W']);
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
    const { db, t750 } = setup();
    const save = (at: string, o: Offer) => saveCollection(db, { store: 's1', category: 'psu', termId: t750, offers: [o], at, complete: true });
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
  it('buscar "AM4" traz o processador AM4 que só apareceu na coleta de "Ryzen 7"; velho demais fica de fora', () => {
    const db = openDb(':memory:');
    const ids = ensureTerms(db, [{ category: 'cpu', term: 'Ryzen 7' }], 'seed');
    const cpu = (sku: string, title: string, socket: 'AM4' | 'AM5', at: string) =>
      offer(sku, 1900, { store: 's2', title, specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', socket }, modelKey: `cpu:${sku}`, collectedAt: at });
    const run = (offers: Offer[], at: string) =>
      saveCollection(db, { store: 's2', category: 'cpu', termId: idOf(ids, { category: 'cpu', term: 'Ryzen 7' }), offers, at, complete: true });
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

describe('marcas dos anúncios (listingBrands)', () => {
  it('marcas da categoria vistas no período, sem repetir, sem "Outros"/"Genérica", em ordem alfabética', () => {
    const db = openDb(':memory:');
    const ids = ensureTerms(db, [T750], 'seed');
    const at = '2026-11-20T12:00:00.000Z';
    saveCollection(db, {
      store: 's1', category: 'psu', termId: idOf(ids, T750), at, complete: true,
      offers: [offer('1', 400, { brand: 'Mancer' }), offer('2', 500, { brand: 'Corsair' }), offer('3', 450, { brand: 'Corsair' }), offer('4', 300, { brand: 'Genérica' }), offer('5', 350, { brand: 'Gamemax' }), offer('6', 380)],
    });
    expect(listingBrands(db, 'psu', '2026-11-01T00:00:00.000Z')).toEqual(['Corsair', 'Gamemax', 'Mancer']);
    expect(listingBrands(db, 'psu', '2026-11-21T00:00:00.000Z')).toEqual([]); // nada visto desde então
    expect(listingBrands(db, 'gpu', '2026-11-01T00:00:00.000Z')).toEqual([]);
  });
});

describe('ordem da rotina: categorias espalhadas (dueTerms)', () => {
  it('pesquisado primeiro; depois a categoria há mais tempo sem coleta; dentro dela, o termo nunca coletado', () => {
    const db = openDb(':memory:');
    const ids = ensureTerms(db, [
      { category: 'cpu', term: 'Ryzen 5' }, { category: 'cpu', term: 'Ryzen 7' }, { category: 'cpu', term: 'Core i5' },
      { category: 'case', term: 'Gabinete' },
    ], 'seed', '2026-11-20T00:00:00.000Z');
    const id = (category: 'cpu' | 'case', term: string) => idOf(ids, { category, term });
    const run = (termId: number, at: string) => saveCollection(db, { store: 's2', category: 'cpu', termId, offers: [], at, complete: true });
    run(id('cpu', 'Ryzen 5'), '2026-11-20T10:00:00.000Z');
    run(id('cpu', 'Ryzen 7'), '2026-11-20T11:00:00.000Z');
    const due = (limit = 4) => dueTerms(db, 's2', '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z', limit).map((t) => t.term);
    // Gabinete (categoria nunca coletada) antes de processador; em processador, o nunca coletado (Core i5) primeiro.
    expect(due()).toEqual(['Gabinete', 'Core i5', 'Ryzen 5', 'Ryzen 7']);
    // Alguém pesquisou Ryzen 7 depois da última coleta dele: vai para o topo.
    ensureTerms(db, [{ category: 'cpu', term: 'Ryzen 7' }], 'user', '2026-11-20T12:00:00.000Z');
    expect(due(1)).toEqual(['Ryzen 7']);
    // Vários pedidos acumulados: o mais recente primeiro (quem está esperando agora), mesmo com
    // categoria nunca coletada pedida antes (Gabinete, de manhã).
    ensureTerms(db, [{ category: 'case', term: 'Gabinete' }], 'user', '2026-11-20T09:00:00.000Z');
    ensureTerms(db, [{ category: 'cpu', term: 'Core i5' }], 'user', '2026-11-20T13:00:00.000Z');
    expect(due(3)).toEqual(['Core i5', 'Ryzen 7', 'Gabinete']);
  });
});

describe('texto livre pesquisado (origem "text")', () => {
  it('conta como pedido, não muda a origem de um termo existente e sai da rotina sem buscas recentes', () => {
    const db = openDb(':memory:');
    ensureTerms(db, [{ category: 'gpu', term: 'NVIDIA GeForce' }], 'seed', '2026-11-01T00:00:00.000Z');
    ensureTerms(db, [{ category: 'gpu', term: 'NVIDIA GeForce' }, { category: 'gpu', term: 'Zotac RTX 3050 Twin Edge OC' }], 'text', '2026-11-20T12:00:00.000Z');
    const rows = db.prepare('SELECT term, origin, last_requested_at FROM search_terms ORDER BY id').all();
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { term: 'NVIDIA GeForce', origin: 'seed', last_requested_at: '2026-11-20T12:00:00.000Z' },
      { term: 'Zotac RTX 3050 Twin Edge OC', origin: 'text', last_requested_at: '2026-11-20T12:00:00.000Z' },
    ]);
    const due = (textSince: string) => dueTerms(db, 's2', '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z', 10, textSince).map((t) => t.term);
    // Pesquisado há pouco: entra na rotina.
    expect(due('2026-11-13T12:00:00.000Z')).toContain('Zotac RTX 3050 Twin Edge OC');
    // Ninguém pesquisa desde antes do corte: a rotina esquece o texto; o termo do formulário fica.
    expect(due('2026-11-20T13:00:00.000Z')).toEqual(['NVIDIA GeForce']);
  });
});

describe('aviso de coleta nova (telas abertas)', () => {
  it('gravar uma coleta avisa quem escuta, com loja e categoria; coleta vazia não avisa', async () => {
    const { onCollected } = await import('./events.ts');
    const db = openDb(':memory:');
    const ids = ensureTerms(db, [T750], 'seed');
    const got: unknown[] = [];
    const off = onCollected((e) => got.push(e));
    saveCollection(db, { store: 's2', category: 'psu', termId: idOf(ids, T750), offers: [offer('1', 400, { store: 's2' })], at: '2026-11-20T20:30:00.000Z', complete: true });
    saveCollection(db, { store: 's2', category: 'psu', termId: idOf(ids, T750), offers: [], at: '2026-11-20T20:31:00.000Z', complete: true });
    off();
    saveCollection(db, { store: 's1', category: 'psu', termId: idOf(ids, T750), offers: [offer('2', 500)], at: '2026-11-20T20:32:00.000Z', complete: true });
    expect(got).toEqual([{ store: 's2', category: 'psu', at: '2026-11-20T20:30:00.000Z' }]);
  });
});
