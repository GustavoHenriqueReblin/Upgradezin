import { afterEach, describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { s1 } from '../adapters/s1.ts';
import { fixture } from '../adapters/fixtures.ts';
import { usePageLoader } from '../browser.ts';
import { openDb } from '../db/db.ts';
import { getDb } from '../db/instance.ts';
import { useBackoffStorage } from '../pace.ts';
import { routineNextAt, setRoutineSettings, stopRoutine, tick, useRoutineStorage } from './routine.ts';
import { storeConfig, useStoreStorage } from '../stores.ts';
import { dueTerms, ensureTerms, priceHistory } from './prices.ts';
import { nextSweep, recordSweepFailure, recordSweepPage, sweepState } from './sweep.ts';

const offer = (sku: string, priceCash: number): Offer => ({
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
});

const H = 3_600_000;
const T0 = Date.parse('2026-11-20T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const page = (db: ReturnType<typeof openDb>, category: 'psu' | 'cpu', p: number, totalPages: number, offers: Offer[], at: number, maxPages = 25) =>
  recordSweepPage(db, { store: 's1', category, page: p, totalPages, maxPages, offers, at: iso(at) });

describe('varredura de categoria', () => {
  it('lê a volta página por página e só recomeça depois do intervalo', () => {
    const db = openDb(':memory:');
    const next = (at: number) => nextSweep(db, 's1', ['psu'], at, 24 * H, H);
    expect(next(T0)).toEqual({ category: 'psu', page: 1 });
    page(db, 'psu', 1, 3, [offer('1', 400)], T0);
    expect(next(T0)).toEqual({ category: 'psu', page: 2 });
    page(db, 'psu', 2, 3, [offer('2', 500)], T0 + 1);
    page(db, 'psu', 3, 3, [offer('3', 600)], T0 + 2);
    expect(sweepState(db, 's1', 'psu')).toEqual({ page: 1, doneAt: iso(T0 + 2) });
    expect(next(T0 + 23 * H)).toBeNull();
    expect(next(T0 + 25 * H)).toEqual({ category: 'psu', page: 1 });
  });

  it('para no teto de páginas mesmo com mais páginas na loja', () => {
    const db = openDb(':memory:');
    page(db, 'psu', 1, 40, [], T0, 2);
    page(db, 'psu', 2, 40, [], T0 + 1, 2);
    expect(sweepState(db, 's1', 'psu').doneAt).toBe(iso(T0 + 1));
  });

  it('ordem: volta em andamento, depois nunca varrida, depois a mais antiga', () => {
    const db = openDb(':memory:');
    page(db, 'cpu', 1, 1, [], T0); // cpu completa em T0
    expect(nextSweep(db, 's1', ['cpu', 'psu'], T0 + 30 * H, 24 * H, H)?.category).toBe('psu'); // psu nunca varrida
    page(db, 'psu', 1, 2, [], T0 + 30 * H); // psu em andamento
    expect(nextSweep(db, 's1', ['cpu', 'psu'], T0 + 30 * H, 24 * H, H)).toEqual({ category: 'psu', page: 2 });
  });

  it('falha: a categoria espera e retoma da mesma página', () => {
    const db = openDb(':memory:');
    page(db, 'psu', 1, 3, [], T0);
    recordSweepFailure(db, 's1', 'psu', iso(T0));
    expect(nextSweep(db, 's1', ['psu'], T0 + 0.5 * H, 24 * H, H)).toBeNull();
    expect(nextSweep(db, 's1', ['psu'], T0 + 2 * H, 24 * H, H)).toEqual({ category: 'psu', page: 2 });
  });

  it('cada página grava histórico do anúncio, e o termo da varredura fica fora da fila de termos', () => {
    const db = openDb(':memory:');
    ensureTerms(db, [{ category: 'psu', term: '750W' }], 'seed');
    page(db, 'psu', 1, 1, [offer('9', 400)], T0);
    page(db, 'psu', 1, 1, [offer('9', 380)], T0 + 25 * H);
    expect(priceHistory(db, 's1', '9').map((p) => p.priceCash)).toEqual([400, 380]);
    expect(dueTerms(db, 's1', iso(T0 + 100 * H), iso(T0 + 100 * H), 10).map((t) => t.term)).toEqual(['750W']);
  });
});

describe('varredura: configuração e adapter da S1', () => {
  afterEach(() => usePageLoader(null));

  it('STORE_S1_SWEEP só aceita caminho do próprio site e categoria conhecida', () => {
    expect(storeConfig('s1').sweep).toEqual({ cpu: '/hardware/processadores', psu: '/hardware/fontes' });
    expect(storeConfig('s2').sweep).toEqual({});
  });

  it('lê a página da categoria com paginação e devolve o total de páginas', async () => {
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    const r = await s1.sweepPage!({ category: 'cpu', url: 'https://www.s1.example/hardware/processadores', page: 3, signal: new AbortController().signal });
    expect(urls[0]).toMatch(/^https:\/\/www\.s1\.example\/hardware\/processadores\?page_number=3&page_size=120/);
    expect(r.totalPages).toBeGreaterThanOrEqual(1);
    expect(r.offers.length).toBeGreaterThan(0);
    expect(r.offers.every((o) => o.store === 's1' && o.specs.cpuLine)).toBe(true);
  });
});

describe('ficha técnica guardada', () => {
  it('guarda e regrava; com dados vale para sempre; página sem ficha também fica guardada', async () => {
    const { getSheet, saveSheet } = await import('./sheets.ts');
    const db = openDb(':memory:');
    saveSheet(db, 's1', '7', { specs: { gpuLength: 300 }, mpn: 'ABC-123' }, '2026-11-20T00:00:00.000Z');
    expect(getSheet(db, 's1', '7', '2026-11-21T00:00:00.000Z')).toEqual({ specs: { gpuLength: 300 }, mpn: 'ABC-123' }); // a ficha do produto não muda
    saveSheet(db, 's1', '7', { specs: { gpuLength: 305 } });
    expect(getSheet(db, 's1', '7', '2026-11-21T00:00:00.000Z')?.specs.gpuLength).toBe(305);
    saveSheet(db, 's1', '8', { specs: {} });
    expect(getSheet(db, 's1', '8', '2026-01-01T00:00:00.000Z')).toEqual({ specs: {} });
  });
  it('S1: a ficha vem de product.technicalInformation.text; página sem o campo = sem ficha', async () => {
    const { s1SheetFromHtml } = await import('../adapters/s1.ts');
    const page = (product: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product } } })}</script>`;
    expect(s1SheetFromHtml(page({ technicalInformation: { text: '<p>Dimensões: 269 x 131 x 40 mm</p>' } }))).toBe('<p>Dimensões: 269 x 131 x 40 mm</p>');
    expect(s1SheetFromHtml(page({}))).toBeNull();
    expect(s1SheetFromHtml('<html></html>')).toBeNull();
  });
  it('S1: junta a descrição (medidas que só estão nela, em marcas menores e alguns gabinetes); as informações técnicas vêm primeiro', async () => {
    const { s1SheetFromHtml } = await import('../adapters/s1.ts');
    const { parseSpecSheet } = await import('@upgradezin/shared');
    const page = (product: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product } } })}</script>`;
    // Como num anúncio real (nov/2026): as informações técnicas só com garantia e modelo; a ficha na descrição.
    const html = s1SheetFromHtml(
      page({
        technicalInformation: { text: '<p><strong>Garantia do Fornecedor</strong></p><p>3 Meses</p><p><strong>Modelo</strong></p><p>XYZ-RX580</p>' },
        description: ':<br><br><b>Marca:</b> Exemplo<br><b>Interface de Alimentação:</b> 6 pinos<br><b>Dimensões (sem suporte):</b> 227 x 117 x 45 mm<br>',
      }),
    )!;
    expect(html.indexOf('Garantia')).toBeLessThan(html.indexOf('Dimensões'));
    expect(parseSpecSheet('gpu', html).specs.gpuLength).toBe(227);
    expect(s1SheetFromHtml(page({ technicalInformation: { text: ' ' }, description: '<p>Dimensões: 300 x 120 x 50 mm</p>' }))).toBe('<p>Dimensões: 300 x 120 x 50 mm</p>');
    expect(s1SheetFromHtml(page({ technicalInformation: { text: '' }, description: '' }))).toBeNull();
  });
});

describe('varredura na rotina', () => {
  afterEach(() => {
    usePageLoader(null);
    stopRoutine();
  });

  it('alterna com os termos: varredura, termo, varredura, termo', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    setRoutineSettings({ enabled: true, stores: ['s1'], modes: { s1: 'normal' } });
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const before = urls.length;
      await tick(routineNextAt('s1')!);
      const url = urls[before]!; // primeira página aberta nesta vez (a busca da S1 pode abrir um produto depois)
      kinds.push(url.includes('/busca/') ? 'termo' : url.includes('/hardware/') ? 'varredura' : url);
    }
    expect(kinds).toEqual(['varredura', 'termo', 'varredura', 'termo']);
  });
});
