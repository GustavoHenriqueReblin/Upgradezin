import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer, StoreStatusEvent, StoreId } from '@upgradezin/shared';
import { s1 } from './adapters/s1.ts';
import { s3 } from './adapters/s3.ts';
import { getDb } from './db/instance.ts';
import { BlockedError, clearBackoff, SearchRedirectError, useBackoffStorage } from './pace.ts';
import { saveCollection } from './prices/prices.ts';
import { setRoutineSettings, stopRoutine, useRoutineStorage } from './prices/routine.ts';
import { forgetTextSearches, runSearch, storedList } from './search.ts';
import { useStoreStorage } from './stores.ts';

afterEach(() => {
  vi.restoreAllMocks();
  stopRoutine();
  forgetTextSearches();
});

const psu = (store: StoreId, sku: string, title: string, watts: number): Offer =>
  ({ store, storeSku: sku, title, url: `https://www.${store}.example/${sku}`, priceCash: 400, inStock: true, specs: { watts }, modelKey: `psu:${sku}`, collectedAt: new Date().toISOString() }) as Offer;

function prepare(live: Partial<Record<StoreId, boolean>>) {
  useStoreStorage(getDb());
  useBackoffStorage([], () => {});
  useRoutineStorage(null, () => {});
  setRoutineSettings({ enabled: false, stores: [], live });
  saveCollection(getDb(), { store: 's1', category: 'psu', offers: [psu('s1', 'a', 'Fonte Corsair RM1000e 1000W', 1000), psu('s1', 'b', 'Fonte Rise Mode Zeus 750W', 750)], at: new Date().toISOString() });
}

const run = async (terms: string[], text = false) => {
  const events: StoreStatusEvent[] = [];
  const lists = new Map<StoreId, Offer[]>();
  await runSearch(
    { category: 'psu', terms, stores: ['s1', 's3'], text },
    { onStatus: (e) => events.push(e), onOffers: (store, offers, partial) => !partial && lists.set(store, offers) },
    new AbortController().signal,
  );
  return { events, lists };
};

describe('busca do site', () => {
  it('termos do formulário: só o banco (pelas specs), nenhuma loja consultada', async () => {
    prepare({ s1: true, s3: true });
    const a = vi.spyOn(s1, 'search').mockResolvedValue([]);
    const b = vi.spyOn(s3, 'search').mockResolvedValue([]);
    const { events, lists } = await run(['1000W']);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(lists.get('s1')!.map((o) => o.storeSku)).toEqual(['a']);
    expect(events.map((e) => e.state)).toEqual(['cached', 'cached']);
    expect(storedList('s1', 'psu', ['1000W']).map((o) => o.storeSku)).toEqual(['a']);
  });

  it('texto livre: o banco (título) e a busca da loja só onde a busca ao vivo está ligada; não repete logo em seguida', async () => {
    prepare({ s1: true, s3: false });
    const live = vi.spyOn(s1, 'search').mockResolvedValue([psu('s1', 'c', 'Fonte Rise Mode Zeus 850W', 850)]);
    const off = vi.spyOn(s3, 'search').mockResolvedValue([]);
    const { events, lists } = await run(['750W', 'Rise Mode'], true);
    expect(live).toHaveBeenCalledOnce();
    expect(off).not.toHaveBeenCalled();
    expect(events.filter((e) => e.store === 's3').map((e) => e.state)).toEqual(['cached']);
    expect(events.filter((e) => e.store === 's1').map((e) => e.state)).toContain('done');
    // 750W pelas specs (b), "Rise Mode" pelo título (b) e o que a loja trouxe (c, gravado no banco).
    expect(lists.get('s1')!.map((o) => o.storeSku).sort()).toEqual(['b', 'c']);
    expect(storedList('s1', 'psu', ['Rise Mode']).map((o) => o.storeSku).sort()).toEqual(['b', 'c']);
    // Mesmo texto de novo, logo depois: vale o banco.
    await run(['Rise Mode'], true);
    expect(live).toHaveBeenCalledOnce();
  });

  it('texto que a loja leva para a página de uma categoria: fica com o banco, sem erro', async () => {
    prepare({ s1: true, s3: false });
    vi.spyOn(s1, 'search').mockRejectedValue(new SearchRedirectError('s1', '/hardware/fontes'));
    const { events, lists } = await run(['Rise Mode'], true);
    expect(events.filter((e) => e.store === 's1').map((e) => e.state).at(-1)).toBe('done');
    // O que o banco tem para o texto (o banco de teste é o mesmo do arquivo: inclui o que o teste anterior gravou).
    expect(lists.get('s1')!.map((o) => o.storeSku).sort()).toEqual(storedList('s1', 'psu', ['Rise Mode']).map((o) => o.storeSku).sort());
    expect(lists.get('s1')!.map((o) => o.storeSku)).toContain('b');
  });

  it('loja bloqueia no meio da busca por texto: avisa o bloqueio e mantém o que o banco já tinha', async () => {
    prepare({ s1: true, s3: false });
    vi.spyOn(s1, 'search').mockRejectedValue(new BlockedError('s1', 'denied', 'Acesso negado'));
    try {
      const { events, lists } = await run(['Rise Mode'], true);
      expect(events.filter((e) => e.store === 's1').at(-1)).toMatchObject({ state: 'blocked', reason: 'denied' });
      expect(lists.get('s1')!.map((o) => o.storeSku).sort()).toEqual(storedList('s1', 'psu', ['Rise Mode']).map((o) => o.storeSku).sort());
      expect(lists.get('s1')!.map((o) => o.storeSku)).toContain('b');
    } finally {
      clearBackoff('s1');
    }
  });
});
