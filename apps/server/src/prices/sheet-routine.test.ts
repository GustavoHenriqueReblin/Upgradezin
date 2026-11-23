import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer, SheetRoutineSettings } from '@upgradezin/shared';
import { fixture } from '../adapters/fixtures.ts';
import { usePageLoader } from '../browser.ts';
import { getDb } from '../db/instance.ts';
import { clearBackoff, pauseStore, useBackoffStorage } from '../pace.ts';
import { useStoreStorage } from '../stores.ts';
import { saveCollection } from './prices.ts';
import { routineNextAt, setRoutineSettings, stopRoutine } from './routine.ts';
import { PAGE_ERROR_SKIP_MS } from './page-errors.ts';
import { productPage } from './product-page.ts';
import { recentOffers } from './prices.ts';
import { setSheetRoutine, sheetDelay, sheetNextAt, sheetRoutineSettings, sheetTick, stopSheetRoutine, useSheetRoutineStorage } from './sheet-routine.ts';
import { productSheet } from './sheets.ts';

afterEach(() => {
  usePageLoader(null);
  setSheetRoutine({ enabled: false, stores: [] });
  stopSheetRoutine();
  stopRoutine();
});

/** Placas de vídeo da S1 no catálogo, sem ficha lida. */
function gpusInCatalog(...skus: string[]) {
  const db = getDb();
  const offers = skus.map((sku) => ({ store: 's1', storeSku: sku, title: 'Placa RTX 5060', url: `https://www.s1.example/produto/${sku}`, priceCash: 2000, inStock: true, specs: { gpuModel: 'RTX 5060' }, modelKey: `gpu:${sku}`, collectedAt: '' }) as Offer);
  saveCollection(db, { store: 's1', category: 'gpu', offers, at: new Date().toISOString() });
}

/** Página de produto da S1 com a ficha (comprimento da placa em mm). */
const sheetPage = (mm: number) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product: { technicalInformation: { text: `<p>Dimensões: ${mm} x 120 x 40 mm</p>` } } } } })}</script>`;

function setup() {
  useStoreStorage(getDb());
  useBackoffStorage([], () => {});
  const urls: string[] = [];
  usePageLoader(async (_store, url) => {
    urls.push(url);
    return { html: url.includes('/produto/') ? sheetPage(200 + urls.length) : fixture('s1-cpu.html'), url, title: '' };
  });
  return urls;
}

describe('rotina de fichas técnicas (separada da coleta)', () => {
  it('configuração: do .env (desligada, todas as lojas, 180 s), guardada; inválido fica como estava', () => {
    const saved: SheetRoutineSettings[] = [];
    useSheetRoutineStorage(null, (s) => saved.push(s));
    expect(sheetRoutineSettings()).toEqual({ enabled: false, stores: ['s1', 's2', 's3'], seconds: 180 });
    setSheetRoutine({ seconds: 3600 });
    expect(sheetRoutineSettings()).toEqual({ enabled: false, stores: ['s1', 's2', 's3'], seconds: 3600 }); // o resto fica
    setSheetRoutine({ stores: ['s3', 'x9' as 's1', 's1'], seconds: 5 });
    expect(sheetRoutineSettings()).toEqual({ enabled: false, stores: ['s1', 's3'], seconds: 3600 }); // ordem, sem a inválida; 5 s é pouco
    setSheetRoutine({ seconds: 86_401 });
    expect(sheetRoutineSettings().seconds).toBe(3600);
    expect(saved.at(-1)).toEqual({ enabled: false, stores: ['s1', 's3'], seconds: 3600 });
    // O guardado vale no lugar do .env; o que falta, o padrão.
    useSheetRoutineStorage({ enabled: true, seconds: 600 }, () => {});
    expect(sheetRoutineSettings()).toEqual({ enabled: true, stores: ['s1', 's2', 's3'], seconds: 600 });
    useSheetRoutineStorage(null, () => {});
  });

  it('com a coleta desligada: lê uma ficha por vez, no intervalo do admin, e guarda', async () => {
    const urls = setup();
    gpusInCatalog('501', '502');
    setRoutineSettings({ enabled: false, stores: ['s1'] });
    setSheetRoutine({ enabled: true, stores: ['s1'], seconds: 600 });
    expect(routineNextAt('s1')).toBeNull(); // a coleta continua parada
    const first = sheetNextAt('s1')!;
    expect(first - Date.now()).toBeGreaterThan(5_000); // primeira 10 s depois de ligar
    await sheetTick(first);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/produto\/50[12]$/);
    const wait = sheetNextAt('s1')! - Date.now();
    expect(wait).toBeGreaterThan(590_000); // 600 s + até 20%
    expect(wait).toBeLessThanOrEqual(720_000);
    await sheetTick(Date.now()); // antes da hora: nada
    expect(urls).toHaveLength(1);
    await sheetTick(sheetNextAt('s1')!);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes('/produto/'))).toBe(true); // nenhuma busca nem varredura
    expect(productSheet(getDb(), 's1', '501')?.values.lengthMm).toBeGreaterThan(200);
    expect(productSheet(getDb(), 's1', '502')?.values.lengthMm).toBeGreaterThan(200);
  });

  it('só nas lojas marcadas; desligada, para; loja em pausa espera', async () => {
    const urls = setup();
    gpusInCatalog('601');
    setSheetRoutine({ enabled: true, stores: ['s2'], seconds: 60 });
    expect(sheetNextAt('s1')).toBeNull(); // fora da rotina de fichas
    setSheetRoutine({ stores: ['s1'] });
    pauseStore('s1', 15);
    await sheetTick(sheetNextAt('s1')!);
    expect(urls).toHaveLength(0);
    expect(sheetNextAt('s1')! - Date.now()).toBeGreaterThan(50_000); // confere de novo em 1 min
    clearBackoff('s1');
    setSheetRoutine({ enabled: false });
    expect(sheetNextAt('s1')).toBeNull();
  });

  it('página que dá erro (ex.: a loja redireciona o endereço para ele mesmo) sai da fila por 6 h; a rotina segue para o próximo; na 2ª falha a oferta sai do app, e volta quando a página abre', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    const db = getDb();
    db.exec('DELETE FROM page_errors');
    const inApp = () => recentOffers(db, 'gpu', '2000-01-01').some((o) => o.storeSku === '701');
    let broken = true;
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      if (url.endsWith('/701') && broken) throw new Error('extensão: Frame with ID 0 is showing error page');
      return { html: sheetPage(250), url, title: '' };
    });
    gpusInCatalog('702');
    gpusInCatalog('701'); // achado por último: vem primeiro na fila
    setSheetRoutine({ enabled: true, stores: ['s1'], seconds: 60 });
    await sheetTick(sheetNextAt('s1')!);
    expect(urls.at(-1)).toMatch(/\/701$/);
    await sheetTick(sheetNextAt('s1')!);
    expect(urls.at(-1)).toMatch(/\/702$/); // não tenta a 701 de novo
    await sheetTick(sheetNextAt('s1')!);
    expect(urls.filter((u) => u.endsWith('/701'))).toHaveLength(1); // a 701 continua de fora (o resto da fila segue)
    expect(inApp()).toBe(true); // uma falha só (pode ser a rede): a oferta continua no app
    // Passado o tempo, tenta de novo: 2ª falha seguida, a oferta sai do app.
    const later = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ms);
    let spy = later(PAGE_ERROR_SKIP_MS + 1_000);
    try {
      await sheetTick(sheetNextAt('s1')!);
    } finally {
      spy.mockRestore();
    }
    expect(urls.filter((u) => u.endsWith('/701'))).toHaveLength(2);
    expect(inApp()).toBe(false);
    const l = db.prepare("SELECT id, product_key FROM listings WHERE store = 's1' AND store_sku = '701'").get() as { id: number; product_key: string | null };
    const key = l.product_key ?? `id:${l.id}`;
    expect(productPage(db, key, ['s1'])).toBeUndefined(); // nem na página do produto
    // A página voltou a abrir: a ficha é lida, o registro some e a oferta volta.
    broken = false;
    spy = later(2 * PAGE_ERROR_SKIP_MS + 2_000);
    try {
      await sheetTick(sheetNextAt('s1')!);
    } finally {
      spy.mockRestore();
    }
    expect(urls.filter((u) => u.endsWith('/701'))).toHaveLength(3);
    expect(inApp()).toBe(true);
    expect(db.prepare('SELECT count(*) AS n FROM page_errors').get()).toEqual({ n: 0 });
  });

  it('intervalo: os segundos mais até 20%', () => {
    expect(sheetDelay(180, 0)).toBe(180_000);
    expect(sheetDelay(3600, 1)).toBe(4_320_000);
  });
});
