import { afterEach, describe, expect, it, vi } from 'vitest';
import { s1 } from '../adapters/s1.ts';
import { getDb } from '../db/instance.ts';
import { openDb } from '../db/db.ts';
import { backoffInfo, SearchRedirectError, useBackoffStorage } from '../pace.ts';
import { useStoreStorage } from '../stores.ts';
import { listAttempts } from './attempts.ts';
import { collectTerm } from './collect.ts';
import { dueTerms, dueTermsSpread, ensureTerms, idOf, markFailedRun, redirectPathOf, saveCollection } from './prices.ts';

afterEach(() => vi.restoreAllMocks());

describe('termo que a busca da loja redireciona', () => {
  // Na s1, sem o intervalo mínimo das lojas lentas (o comportamento é o mesmo em qualquer loja).
  it('1ª vez: não é bloqueio, guarda o destino; da próxima vez abre o destino direto', async () => {
    const db = getDb();
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    const ids = ensureTerms(db, [{ category: 'cooler', term: 'Water Cooler' }], 'seed');
    const id = idOf(ids, { category: 'cooler', term: 'Water Cooler' });
    const term = { id, category: 'cooler' as const, term: 'Water Cooler' };
    const search = vi.spyOn(s1, 'search').mockRejectedValueOnce(new SearchRedirectError('s1', '/hardware/cooler-processador'));

    await expect(collectTerm('s1', term, new AbortController().signal, { origin: 'routine' })).rejects.toBeInstanceOf(SearchRedirectError);
    expect(backoffInfo('s1')).toBeNull(); // a loja não pausa
    expect(redirectPathOf(db, 's1', id)).toBe('/hardware/cooler-processador');
    expect(search.mock.calls[0]![0].path).toBeUndefined(); // 1ª vez: pela busca
    const [a] = listAttempts(db, { store: 's1' });
    expect(a).toMatchObject({ status: 'error', term: 'Water Cooler', origin: 'routine' });
    expect(a!.detail).toContain('/hardware/cooler-processador');

    // 2ª vez: abre o destino direto e coleta normalmente; o destino continua guardado.
    search.mockResolvedValueOnce([]);
    expect(await collectTerm('s1', term, new AbortController().signal, { origin: 'routine' })).toEqual([]);
    expect(search.mock.calls[1]![0]).toMatchObject({ q: 'Water Cooler', path: '/hardware/cooler-processador' });
    expect(db.prepare('SELECT status, redirect_path FROM term_runs WHERE term_id = ? AND store = ?').get(id, 's1')).toEqual({ status: 'ok', redirect_path: '/hardware/cooler-processador' });
  });

  it('a rotina pega o termo redirecionado de novo sem esperar o intervalo de falha; outra loja não é afetada', () => {
    const db = openDb(':memory:');
    const ids = ensureTerms(db, [{ category: 'cooler', term: 'Water Cooler' }, { category: 'cooler', term: 'Water Cooler 360mm' }], 'seed');
    const wc = idOf(ids, { category: 'cooler', term: 'Water Cooler' });
    const wc360 = idOf(ids, { category: 'cooler', term: 'Water Cooler 360mm' });
    markFailedRun(db, 's2', wc, '2026-11-20T23:50:00.000Z', 'redirect', '/hardware/cooler-processador');
    markFailedRun(db, 's2', wc360, '2026-11-20T23:50:00.000Z', 'blocked');
    // Falharam há 10 min; o intervalo de falha (tryBefore) vai até 23:00.
    const terms = (fn: typeof dueTerms, store: 's1' | 's2') => fn(db, store, '2026-11-21T00:00:00.000Z', '2026-11-20T23:00:00.000Z', 10).map((t) => t.term);
    for (const fn of [dueTerms, dueTermsSpread]) {
      expect(terms(fn, 's2')).toEqual(['Water Cooler']); // o bloqueado espera; o redirecionado não
      expect(terms(fn, 's1').sort()).toEqual(['Water Cooler', 'Water Cooler 360mm']);
    }
    // Um bloqueio depois não apaga o destino já conhecido.
    markFailedRun(db, 's2', wc, '2026-11-21T00:10:00.000Z', 'blocked');
    expect(redirectPathOf(db, 's2', wc)).toBe('/hardware/cooler-processador');
    saveCollection(db, { store: 's2', category: 'cooler', termId: wc, offers: [], at: '2026-11-21T00:20:00.000Z', complete: true });
    expect(redirectPathOf(db, 's2', wc)).toBe('/hardware/cooler-processador');
  });
});
