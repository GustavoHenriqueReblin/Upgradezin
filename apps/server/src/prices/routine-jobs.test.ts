import { afterEach, describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { fixture, s1CpuListPage } from '../adapters/fixtures.ts';
import { usePageLoader } from '../browser.ts';
import { getDb } from '../db/instance.ts';
import { useBackoffStorage } from '../pace.ts';
import { useStoreStorage } from '../stores.ts';
import { saveCollection } from './prices.ts';
import { routineNextAt, setRoutineSettings, stopRoutine, tick, useRoutineStorage } from './routine.ts';
import { pageText } from './sheets.ts';

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
  it('cada vez lê uma categoria inteira (as páginas com estoque, uma atrás da outra) e a próxima vez, a categoria seguinte; nunca abre ficha (rotina própria) nem busca', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    gpuInCatalog('777'); // placa sem ficha no catálogo: a rotina de preços não lê
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: s1CpuListPage(url), url, title: '' };
    });
    setRoutineSettings({ enabled: true, stores: ['s1'] });
    await tick(routineNextAt('s1')!);
    // A lista da fixture tem 6 páginas, todas com itens em estoque: as 6 na mesma vez, em ordem.
    const first = urls.filter((u) => u.includes('/hardware/'));
    expect(first.map((u) => u.match(/page_number=(\d+)/)?.[1])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new Set(first.map((u) => u.split('?')[0])).size).toBe(1);
    const before = urls.length;
    await tick(routineNextAt('s1')!);
    const second = urls.slice(before).filter((u) => u.includes('/hardware/'));
    // Para no limite de páginas da rotina na hora (ROUTINE_PAGES_PER_HOUR, 12 aqui): continua na próxima vez.
    expect(second.length).toBe(5);
    expect(second[0]!.split('?')[0]).not.toBe(first[0]!.split('?')[0]); // a outra categoria da loja
    expect(urls.some((u) => u.includes('/produto/777'))).toBe(false);
    expect(urls.some((u) => u.includes('/busca/'))).toBe(false);
    expect(pageText(getDb(), 's1', '777')).toBeUndefined();
  });
});
