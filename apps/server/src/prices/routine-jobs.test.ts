import { afterEach, describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { fixture } from '../adapters/fixtures.ts';
import { usePageLoader } from '../browser.ts';
import { getDb } from '../db/instance.ts';
import { useBackoffStorage } from '../pace.ts';
import { useStoreStorage } from '../stores.ts';
import { saveCollection } from './prices.ts';
import { routineNextAt, setRoutineSettings, stopRoutine, tick, useRoutineStorage } from './routine.ts';
import { getSheet } from './sheets.ts';

afterEach(() => {
  usePageLoader(null);
  stopRoutine();
});

/** Uma placa de vídeo da S1 no catálogo, sem ficha lida. */
function gpuInCatalog(sku: string) {
  const offer = { store: 's1', storeSku: sku, title: 'Placa RTX 5060', url: `https://www.s1.example/produto/${sku}`, priceCash: 2000, inStock: true, specs: { gpuModel: 'RTX 5060' }, modelKey: `gpu:${sku}`, collectedAt: '' } as Offer;
  saveCollection(getDb(), { store: 's1', category: 'gpu', offers: [offer], at: new Date().toISOString() });
}

describe('rotina de preços: só páginas de categoria', () => {
  it('uma página por vez, seguindo a lista da categoria; nunca abre ficha (rotina própria) nem busca', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    gpuInCatalog('777'); // placa sem ficha no catálogo: a rotina de preços não lê
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    setRoutineSettings({ enabled: true, stores: ['s1'], modes: { s1: 'normal' } });
    for (let i = 0; i < 3; i++) await tick(routineNextAt('s1')!);
    const lists = urls.filter((u) => u.includes('/hardware/'));
    expect(lists.length).toBe(3);
    expect(urls.some((u) => u.includes('/produto/777'))).toBe(false);
    expect(urls.some((u) => u.includes('/busca/'))).toBe(false);
    expect(getSheet(getDb(), 's1', '777', new Date().toISOString())).toBeUndefined();
  });
});
