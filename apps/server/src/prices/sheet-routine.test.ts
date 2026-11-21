import { afterEach, describe, expect, it } from 'vitest';
import type { Offer, SheetRoutineSettings } from '@upgradezin/shared';
import { fixture } from '../adapters/fixtures.ts';
import { usePageLoader } from '../browser.ts';
import { getDb } from '../db/instance.ts';
import { clearBackoff, pauseStore, useBackoffStorage } from '../pace.ts';
import { useStoreStorage } from '../stores.ts';
import { ensureTerms, idOf, saveCollection } from './prices.ts';
import { routineNextAt, setRoutineSettings, stopRoutine } from './routine.ts';
import { setSheetRoutine, sheetDelay, sheetNextAt, sheetRoutineSettings, sheetTick, stopSheetRoutine, useSheetRoutineStorage } from './sheet-routine.ts';
import { getSheet } from './sheets.ts';

afterEach(() => {
  usePageLoader(null);
  setSheetRoutine({ enabled: false, stores: [] });
  stopSheetRoutine();
  stopRoutine();
});

/** Placas de vídeo da S1 no catálogo, sem ficha lida. */
function gpusInCatalog(...skus: string[]) {
  const db = getDb();
  const ids = ensureTerms(db, [{ category: 'gpu', term: 'NVIDIA GeForce' }], 'seed');
  const offers = skus.map((sku) => ({ store: 's1', storeSku: sku, title: 'Placa RTX 5060', url: `https://www.s1.example/produto/${sku}`, priceCash: 2000, inStock: true, specs: { gpuModel: 'RTX 5060' }, modelKey: `gpu:${sku}`, collectedAt: '' }) as Offer);
  saveCollection(db, { store: 's1', category: 'gpu', termId: idOf(ids, { category: 'gpu', term: 'NVIDIA GeForce' }), offers, at: new Date().toISOString(), complete: true });
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
    const now = new Date().toISOString();
    expect(getSheet(getDb(), 's1', '501', now)?.specs.gpuLength).toBeGreaterThan(200);
    expect(getSheet(getDb(), 's1', '502', now)?.specs.gpuLength).toBeGreaterThan(200);
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

  it('intervalo: os segundos mais até 20%', () => {
    expect(sheetDelay(180, 0)).toBe(180_000);
    expect(sheetDelay(3600, 1)).toBe(4_320_000);
  });
});
