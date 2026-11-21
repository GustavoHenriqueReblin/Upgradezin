import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreStatusEvent } from '@upgradezin/shared';
import { s1 } from './adapters/s1.ts';
import { s3 } from './adapters/s3.ts';
import { getDb } from './db/instance.ts';
import { useBackoffStorage } from './pace.ts';
import { setRoutineSettings, stopRoutine, useRoutineStorage } from './prices/routine.ts';
import { runSearch } from './search.ts';
import { useStoreStorage } from './stores.ts';

afterEach(() => {
  vi.restoreAllMocks();
  stopRoutine();
});

describe('busca ao vivo por loja (admin)', () => {
  it('loja com busca ao vivo desligada não é consultada: a busca mostra só o banco; as outras vão na hora', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    setRoutineSettings({ enabled: false, stores: [], live: { s1: true, s3: false } });
    const live = vi.spyOn(s1, 'search').mockResolvedValue([]);
    const off = vi.spyOn(s3, 'search').mockResolvedValue([]);
    const events: StoreStatusEvent[] = [];

    // Termo novo (nunca coletado): com busca ao vivo, a loja seria consultada de qualquer jeito.
    await runSearch({ category: 'psu', terms: ['1000W'], stores: ['s1', 's3'] }, { onStatus: (e) => events.push(e), onOffers: () => {} }, new AbortController().signal);

    expect(live).toHaveBeenCalledOnce();
    expect(off).not.toHaveBeenCalled();
    expect(events.filter((e) => e.store === 's3').map((e) => e.state)).toEqual(['cached']);
    expect(events.filter((e) => e.store === 's1').map((e) => e.state)).toContain('done');
  });
});
