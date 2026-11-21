import { afterEach, describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { fixture } from '../adapters/fixtures.ts';
import { usePageLoader } from '../browser.ts';
import { getDb } from '../db/instance.ts';
import { useBackoffStorage } from '../pace.ts';
import { useStoreStorage } from '../stores.ts';
import { ensureTerms, idOf, saveCollection } from './prices.ts';
import { routineNextAt, setRoutineSettings, stopRoutine, tick, useRoutineStorage } from './routine.ts';
import { getSheet } from './sheets.ts';

afterEach(() => {
  usePageLoader(null);
  stopRoutine();
});

/** Uma placa de vídeo da S1 no catálogo, sem ficha lida. */
function gpuInCatalog(sku: string) {
  const db = getDb();
  const ids = ensureTerms(db, [{ category: 'gpu', term: 'NVIDIA GeForce' }], 'seed');
  const offer = { store: 's1', storeSku: sku, title: 'Placa RTX 5060', url: `https://www.s1.example/produto/${sku}`, priceCash: 2000, inStock: true, specs: { gpuModel: 'RTX 5060' }, modelKey: `gpu:${sku}`, collectedAt: '' } as Offer;
  saveCollection(db, { store: 's1', category: 'gpu', termId: idOf(ids, { category: 'gpu', term: 'NVIDIA GeForce' }), offers: [offer], at: new Date().toISOString(), complete: true });
}

describe('rotina: rodízio entre varredura, termo e ficha técnica', () => {
  it('uma coisa por vez, em rodízio; a ficha lida fica guardada', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    gpuInCatalog('777');
    const urls: string[] = [];
    // Página da ficha: o __NEXT_DATA__ da S1 com o campo da ficha; o resto, uma listagem.
    const sheetPage = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product: { technicalInformation: { text: '<p>Dimensões: 240 x 120 x 40 mm</p>' } } } } })}</script>`;
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: url.includes('/produto/777') ? sheetPage : fixture('s1-cpu.html'), url, title: '' };
    });
    setRoutineSettings({ enabled: true, stores: ['s1'], modes: { s1: 'normal' } });
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const before = urls.length;
      await tick(routineNextAt('s1')!);
      const url = urls[before]!; // primeira página aberta nesta vez
      kinds.push(url.includes('/produto/') ? 'ficha' : url.includes('/busca/') ? 'termo' : url.includes('/hardware/') ? 'varredura' : url);
    }
    expect(kinds).toEqual(['varredura', 'termo', 'ficha', 'varredura']);
    expect(getSheet(getDb(), 's1', '777', new Date().toISOString())?.specs.gpuLength).toBe(240);
  });

  it('fichas paradas no admin: o rodízio fica só entre varredura e termo', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    gpuInCatalog('999');
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    setRoutineSettings({ enabled: true, stores: ['s1'], modes: { s1: 'normal' }, sheets: { enabled: false } });
    const kinds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const before = urls.length;
      await tick(routineNextAt('s1')!);
      kinds.push(urls[before]!.includes('/produto/') ? 'ficha' : urls[before]!.includes('/busca/') ? 'termo' : 'varredura');
    }
    expect(kinds).toEqual(['varredura', 'termo', 'varredura']);
    setRoutineSettings({ enabled: false, stores: [], sheets: { enabled: true } });
  });

  it('modo reduzido: só termos (sem varredura nem fichas)', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    gpuInCatalog('888');
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    setRoutineSettings({ enabled: true, stores: ['s1'], modes: { s1: 'reduced' } });
    const before = urls.length;
    await tick(routineNextAt('s1')!);
    expect(urls[before]).toContain('/busca/');
  });
});
