import { afterEach, describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { s1 } from '../adapters/s1.ts';
import { s2 } from '../adapters/s2.ts';
import { mapS3Card, parseS3ListCards, parseS3More, s3, s3MoreUrl } from '../adapters/s3.ts';
import { fixture } from '../adapters/fixtures.ts';
import { usePageLoader } from '../browser.ts';
import { openDb } from '../db/db.ts';
import { getDb } from '../db/instance.ts';
import { useBackoffStorage } from '../pace.ts';
import { routineNextAt, setRoutineSettings, stopRoutine, sweepPathCounts, tick, useRoutineStorage } from './routine.ts';
import { storeConfig, sweepPaths, useStoreStorage } from '../stores.ts';
import { priceHistory, saveCollection } from './prices.ts';
import { clearFullSweeps, FULL_SWEEP_MAX_PAGES, nextSweep, recordSweepFailure, recordSweepPage, restartSweep, sweepState, type SweepPageRun } from './sweep.ts';

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

const H = 3_600_000;
const T0 = Date.parse('2026-11-20T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
type Db = ReturnType<typeof openDb>;
/** Uma página lida: por padrão, um caminho só, teto alto e a página com itens em estoque. */
const page = (db: Db, category: 'psu' | 'cpu', p: number, totalPages: number, offers: Offer[], at: number, more: Partial<SweepPageRun> = {}) =>
  recordSweepPage(db, { store: 's1', category, path: 0, paths: 1, page: p, totalPages, maxPages: 25, inStock: 10, offers, at: iso(at), ...more });
const inStockOf = (db: Db, sku: string) => (JSON.parse((db.prepare('SELECT offer FROM listings WHERE store_sku = ?').get(sku) as { offer: string }).offer) as Offer).inStock;

describe('rotina de preços pelas páginas de categoria', () => {
  it('lê a volta página por página e só recomeça depois do intervalo', () => {
    const db = openDb(':memory:');
    const next = (at: number) => nextSweep(db, 's1', { psu: 1 }, at, 24 * H, H);
    expect(next(T0)).toEqual({ category: 'psu', path: 0, page: 1 });
    page(db, 'psu', 1, 3, [offer('1', 400)], T0);
    expect(next(T0)).toEqual({ category: 'psu', path: 0, page: 2 });
    page(db, 'psu', 2, 3, [offer('2', 500)], T0 + 1);
    expect(page(db, 'psu', 3, 3, [offer('3', 600)], T0 + 2)).toMatchObject({ listEnded: true, roundDone: true });
    expect(sweepState(db, 's1', 'psu')).toEqual({ page: 1, doneAt: iso(T0 + 2) });
    expect(next(T0 + 23 * H)).toBeNull();
    expect(next(T0 + 25 * H)).toEqual({ category: 'psu', path: 0, page: 1 });
  });

  it('a lista acaba na primeira página sem nada em estoque (as lojas listam os em estoque primeiro)', () => {
    const db = openDb(':memory:');
    page(db, 'psu', 1, 20, [offer('1', 400)], T0);
    expect(page(db, 'psu', 2, 20, [], T0 + 1, { inStock: 0 })).toMatchObject({ roundDone: true });
    expect(sweepState(db, 's1', 'psu').doneAt).toBe(iso(T0 + 1));
  });

  it('só cria anúncio do que está em estoque; o esgotado só atualiza o anúncio que já existe', () => {
    const db = openDb(':memory:');
    saveCollection(db, { store: 's1', category: 'psu', offers: [offer('velho', 300)], at: iso(T0 - H) });
    const r = page(db, 'psu', 1, 1, [offer('novo', 400), offer('esgotado-novo', 500, { inStock: false }), offer('velho', 300, { inStock: false })], T0);
    expect(r.saved).toBe(2);
    expect(db.prepare('SELECT store_sku FROM listings ORDER BY store_sku').all().map((x) => (x as { store_sku: string }).store_sku)).toEqual(['novo', 'velho']);
    expect(inStockOf(db, 'velho')).toBe(false);
  });

  it('volta completa ("varrer agora"): passa da página sem estoque até o fim da lista e grava anúncio novo esgotado; depois, a rotina volta ao normal', () => {
    const db = openDb(':memory:');
    restartSweep(db, 's1', 'psu', { full: true });
    expect(sweepState(db, 's1', 'psu')).toEqual({ page: 1, full: true });
    page(db, 'psu', 1, 3, [offer('a', 400)], T0);
    // Página só de esgotados: a volta normal acabaria aqui; a completa segue, e o modo fica no estado
    // (uma página que a rotina leia no meio da volta segue a mesma regra).
    expect(page(db, 'psu', 2, 3, [offer('esgotado-novo', 500, { inStock: false })], T0 + 1, { inStock: 0 })).toMatchObject({ saved: 1, listEnded: false, roundDone: false });
    expect(sweepState(db, 's1', 'psu')).toMatchObject({ path: 0, page: 3, full: true });
    expect(page(db, 'psu', 3, 3, [offer('esgotado-2', 600, { inStock: false })], T0 + 2, { inStock: 0 })).toMatchObject({ roundDone: true, outOfStock: 0 });
    expect(['a', 'esgotado-novo', 'esgotado-2'].map((sku) => inStockOf(db, sku))).toEqual([true, false, false]);
    expect(sweepState(db, 's1', 'psu')).toEqual({ page: 1, doneAt: iso(T0 + 2) });
    // Volta seguinte (rotina): de novo só até acabar o estoque, sem criar anúncio esgotado.
    page(db, 'psu', 1, 3, [offer('a', 400)], T0 + 25 * H);
    expect(page(db, 'psu', 2, 3, [offer('outro-esgotado', 700, { inStock: false })], T0 + 25 * H + 1, { inStock: 0 })).toMatchObject({ saved: 0, roundDone: true });
  });

  it('ao subir o servidor, a volta completa que ficou no meio volta ao normal (a rotina não a continua)', () => {
    const db = openDb(':memory:');
    page(db, 'cpu', 1, 1, [offer('a', 400)], T0); // cpu: volta normal completa
    restartSweep(db, 's1', 'psu', { full: true });
    page(db, 'psu', 1, 5, [offer('b', 500)], T0 + 1);
    expect(sweepState(db, 's1', 'psu')).toMatchObject({ full: true, page: 2 });
    expect(clearFullSweeps(db)).toBe(1);
    expect(sweepState(db, 's1', 'psu')).toEqual({ page: 1 });
    expect(sweepState(db, 's1', 'cpu')).toEqual({ page: 1, doneAt: iso(T0) });
    expect(clearFullSweeps(db)).toBe(0);
  });

  it('volta completa: teto de páginas próprio, maior que o da rotina', () => {
    const db = openDb(':memory:');
    restartSweep(db, 's1', 'psu', { full: true });
    expect(page(db, 'psu', 25, 300, [], T0, { inStock: 0 })).toMatchObject({ listEnded: false });
    expect(page(db, 'psu', FULL_SWEEP_MAX_PAGES, 300, [], T0 + 1, { inStock: 0 })).toMatchObject({ roundDone: true, outOfStock: 0 });
  });

  it('fim da volta: o que estava em estoque e não apareceu nela vira "sem estoque"; voltou ao estoque, a volta seguinte grava de novo', () => {
    const db = openDb(':memory:');
    page(db, 'psu', 1, 1, [offer('a', 400), offer('b', 500)], T0);
    expect(inStockOf(db, 'b')).toBe(true);
    // Volta seguinte: o "b" não está mais entre os em estoque.
    expect(page(db, 'psu', 1, 1, [offer('a', 390)], T0 + 25 * H)).toMatchObject({ roundDone: true, outOfStock: 1 });
    expect(inStockOf(db, 'b')).toBe(false);
    expect(inStockOf(db, 'a')).toBe(true);
    page(db, 'psu', 1, 1, [offer('a', 390), offer('b', 450)], T0 + 50 * H);
    expect(inStockOf(db, 'b')).toBe(true);
    expect(priceHistory(db, 's1', 'b').map((p) => [p.priceCash, p.inStock])).toEqual([[500, true], [500, false], [450, true]]);
  });

  it('vários caminhos na mesma categoria: um depois do outro; o fim da volta só vem no último, e conta o que todos viram', () => {
    const db = openDb(':memory:');
    const two = { paths: 2 };
    page(db, 'psu', 1, 2, [offer('a', 400)], T0, two);
    page(db, 'psu', 2, 2, [offer('b', 500)], T0 + 1, two);
    expect(sweepState(db, 's1', 'psu')).toMatchObject({ path: 1, page: 1, startedAt: iso(T0) });
    expect(nextSweep(db, 's1', { psu: 2 }, T0 + 2, 24 * H, H)).toEqual({ category: 'psu', path: 1, page: 1 });
    expect(page(db, 'psu', 1, 1, [offer('c', 600)], T0 + 2, { ...two, path: 1 })).toMatchObject({ roundDone: true, outOfStock: 0 });
    expect(['a', 'b', 'c'].map((sku) => inStockOf(db, sku))).toEqual([true, true, true]);
    // Caminho tirado da configuração no meio da volta: recomeça do primeiro.
    page(db, 'psu', 1, 1, [offer('a', 400)], T0 + 30 * H, two);
    expect(nextSweep(db, 's1', { psu: 1 }, T0 + 30 * H, 24 * H, H)).toEqual({ category: 'psu', path: 0, page: 1 });
  });

  it('teto de páginas ainda com itens em estoque: termina a volta sem marcar nada como esgotado (o resto não foi lido)', () => {
    const db = openDb(':memory:');
    page(db, 'psu', 1, 1, [offer('a', 400), offer('b', 500)], T0);
    page(db, 'psu', 1, 40, [], T0 + 25 * H, { maxPages: 2 });
    expect(page(db, 'psu', 2, 40, [], T0 + 25 * H + 1, { maxPages: 2 })).toMatchObject({ roundDone: true, outOfStock: 0 });
    expect(inStockOf(db, 'a')).toBe(true);
  });

  it('volta começada antes de guardar o início (estado antigo): o fim dela não marca nada como esgotado', async () => {
    const db = openDb(':memory:');
    page(db, 'cpu', 1, 1, [offer('a', 400), offer('b', 500)], T0);
    const { setMeta } = await import('../db/db.ts');
    setMeta(db, 'sweep:s1:cpu', JSON.stringify({ page: 5, doneAt: iso(T0) })); // como ficou do código anterior
    expect(page(db, 'cpu', 5, 5, [offer('z', 900)], T0 + 25 * H)).toMatchObject({ roundDone: true, outOfStock: 0 });
    expect(inStockOf(db, 'a')).toBe(true);
    // A volta seguinte já guarda o início e marca normalmente.
    expect(page(db, 'cpu', 1, 1, [offer('a', 400), offer('z', 900)], T0 + 50 * H)).toMatchObject({ outOfStock: 1 });
    expect(inStockOf(db, 'b')).toBe(false);
  });

  it('ordem: volta em andamento, depois nunca lida, depois a mais antiga; "varrer agora" recomeça do começo', () => {
    const db = openDb(':memory:');
    page(db, 'cpu', 1, 1, [], T0); // cpu completa em T0
    expect(nextSweep(db, 's1', { cpu: 1, psu: 1 }, T0 + 30 * H, 24 * H, H)?.category).toBe('psu'); // psu nunca lida
    page(db, 'psu', 1, 2, [], T0 + 30 * H); // psu em andamento
    expect(nextSweep(db, 's1', { cpu: 1, psu: 1 }, T0 + 30 * H, 24 * H, H)).toEqual({ category: 'psu', path: 0, page: 2 });
    restartSweep(db, 's1', 'cpu');
    expect(sweepState(db, 's1', 'cpu')).toEqual({ page: 1 });
    expect(nextSweep(db, 's1', { cpu: 1 }, T0 + 1, 24 * H, H)).toEqual({ category: 'cpu', path: 0, page: 1 });
  });

  it('falha: a categoria espera e retoma da mesma página', () => {
    const db = openDb(':memory:');
    page(db, 'psu', 1, 3, [], T0);
    recordSweepFailure(db, 's1', 'psu', iso(T0));
    expect(nextSweep(db, 's1', { psu: 1 }, T0 + 0.5 * H, 24 * H, H)).toBeNull();
    expect(nextSweep(db, 's1', { psu: 1 }, T0 + 2 * H, 24 * H, H)).toEqual({ category: 'psu', path: 0, page: 2 });
  });
});

describe('páginas de categoria: configuração e adapters', () => {
  afterEach(() => usePageLoader(null));

  it('só caminho do próprio site e categoria conhecida; vários caminhos separados por espaço', () => {
    expect(storeConfig('s1').sweep).toEqual({ cpu: '/hardware/processadores', psu: '/hardware/fontes' });
    expect(sweepPaths('s1', 'cpu')).toEqual(['/hardware/processadores']);
    expect(sweepPaths('s1', 'gpu')).toEqual([]);
    expect(sweepPathCounts('s1')).toEqual({ cpu: 1, psu: 1 });
    expect(sweepPathCounts('s2')).toEqual({});
  });

  it('S1: página da categoria com paginação, total de páginas e quantos em estoque', async () => {
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    const r = await s1.sweepPage!({ category: 'cpu', url: 'https://www.s1.example/hardware/processadores', page: 3, signal: new AbortController().signal });
    expect(urls[0]).toMatch(/^https:\/\/www\.s1\.example\/hardware\/processadores\?page_number=3&page_size=120/);
    expect(r.totalPages).toBeGreaterThanOrEqual(1);
    expect(r.offers.length).toBeGreaterThan(0);
    expect(r.inStock).toBeGreaterThan(0);
    expect(r.offers.every((o) => o.store === 's1' && o.specs.cpuLine)).toBe(true);
  });

  it('S2: conta os em estoque da página (os sem estoque não contam)', async () => {
    usePageLoader(async (_store, url) => ({ html: fixture('s2-psu.html'), url, title: '' }));
    const r = await s2.sweepPage!({ category: 'psu', url: 'https://www.s2.example/hardware/fonte', page: 1, signal: new AbortController().signal });
    expect(r.inStock).toBe(4); // 5 itens na página, 1 OUT_OF_STOCK
  });

  it('S3: cards da página de categoria (sem data-tss-*): preço, esgotado, marca do título; o "ver mais" é o JSON da página seguinte', async () => {
    const cards = parseS3ListCards(fixture('s3-category-cpu.html'));
    expect(cards.map((c) => c.stock)).toEqual(['1', '1', '1', '0', '0']);
    expect(cards[0]).toMatchObject({ id: '20813', brand: 'AMD', price: '1199.99' });
    const o = mapS3Card(cards[0]!, '2026-11-21T00:00:00.000Z', 'cpu')!;
    expect(o).toMatchObject({ store: 's3', storeSku: '20813', brand: 'AMD', priceCash: 1199.99, inStock: true, url: 'https://www.s3.example/produto/20813/processador-amd-ryzen-7-5700x-34ghz-46ghz-turbo-8-cores-16-threads-am4-sem-cooler-100-100000926wof' });
    expect(o.specs.cpuLine).toBe('Ryzen 7');
    expect(mapS3Card(cards[3]!, '2026-11-21T00:00:00.000Z', 'cpu')).toBeNull(); // esgotado não tem preço
    expect(s3MoreUrl('https://www.s3.example/hardware/placas-mae', 2)).toBe(
      'https://www.s3.example/hardware/placas-mae?app=true&url=%2Fhardware%2Fplacas-mae&more=true&filter%5Bmarca%5D=&filter%5Border%5D=&filter%5Bpg%5D=2&filter%5Bstr%5D=',
    );
    expect(parseS3More('<html><body>Página normal</body></html>')).toBeNull();

    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture(url.includes('more=true') ? 's3-category-more.html' : 's3-category-cpu.html'), url, title: '' };
    });
    const signal = new AbortController().signal;
    const p1 = await s3.sweepPage!({ category: 'cpu', url: 'https://www.s3.example/hardware/processadores', page: 1, signal });
    expect(p1).toMatchObject({ totalPages: 2, inStock: 3 }); // tem o botão "ver mais"
    expect(p1.offers).toHaveLength(3);
    const p2 = await s3.sweepPage!({ category: 'motherboard', url: 'https://www.s3.example/hardware/placas-mae', page: 2, signal });
    expect(p2).toMatchObject({ totalPages: 2, inStock: 2 }); // última: sem o botão
    expect(p2.offers.map((x) => x.brand)).toEqual(['MSI', 'ASRock']);
    expect(urls[1]).toContain('filter%5Bpg%5D=2');
  });
});

describe('ficha técnica da S1', () => {
  it('S1: a ficha vem de product.technicalInformation.text; página sem o campo = sem ficha', async () => {
    const { s1SheetFromHtml } = await import('../adapters/s1.ts');
    const page = (product: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product } } })}</script>`;
    expect(s1SheetFromHtml(page({ technicalInformation: { text: '<p>Dimensões: 269 x 131 x 40 mm</p>' } }))).toBe('<p>Dimensões: 269 x 131 x 40 mm</p>');
    expect(s1SheetFromHtml(page({}))).toBeNull();
    expect(s1SheetFromHtml('<html></html>')).toBeNull();
  });
  it('S1: junta a descrição (medidas que só estão nela, em marcas menores e alguns gabinetes); as informações técnicas vêm primeiro', async () => {
    const { s1SheetFromHtml } = await import('../adapters/s1.ts');
    const { readSheet, sheetText } = await import('@upgradezin/shared');
    const page = (product: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product } } })}</script>`;
    // Como num anúncio real (nov/2026): as informações técnicas só com garantia e modelo; a ficha na descrição.
    const html = s1SheetFromHtml(
      page({
        technicalInformation: { text: '<p><strong>Garantia do Fornecedor</strong></p><p>3 Meses</p><p><strong>Modelo</strong></p><p>XYZ-RX580</p>' },
        description: ':<br><br><b>Marca:</b> Exemplo<br><b>Interface de Alimentação:</b> 6 pinos<br><b>Dimensões (sem suporte):</b> 227 x 117 x 45 mm<br>',
      }),
    )!;
    expect(html.indexOf('Garantia')).toBeLessThan(html.indexOf('Dimensões'));
    expect(readSheet('gpu', sheetText(html))).toMatchObject({ brand: 'Exemplo', lengthMm: 227 });
    expect(s1SheetFromHtml(page({ technicalInformation: { text: ' ' }, description: '<p>Dimensões: 300 x 120 x 50 mm</p>' }))).toBe('<p>Dimensões: 300 x 120 x 50 mm</p>');
    expect(s1SheetFromHtml(page({ technicalInformation: { text: '' }, description: '' }))).toBeNull();
  });
});

describe('rotina de preços', () => {
  afterEach(() => {
    usePageLoader(null);
    stopRoutine();
  });

  it('cada vez da loja lê uma categoria pela página dela (nunca uma busca), em qualquer modo', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    restartSweep(getDb(), 's1', 'cpu');
    restartSweep(getDb(), 's1', 'psu');
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    setRoutineSettings({ enabled: true, stores: ['s1'] });
    for (let i = 0; i < 2; i++) {
      const before = urls.length;
      await tick(routineNextAt('s1')!);
      expect(urls[before]).toContain('/hardware/'); // primeira página aberta nesta vez (a S1 pode abrir um produto depois, pelo cupom)
    }
    expect(urls.some((u) => u.includes('/busca/'))).toBe(false);
  });
});
