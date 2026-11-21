import type { Offer } from '@upgradezin/shared';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/db.ts';
import { recordAttempt } from '../prices/attempts.ts';
import { ensureTerms, idOf, saveCollection } from '../prices/prices.ts';
import { attemptTimeline, coverage, deleteTerm, listTerms, perfGaps, prioritizeTerm } from './data.ts';

const offer = (sku: string, store: Offer['store'] = 's2'): Offer =>
  ({ store, storeSku: sku, title: `Placa ${sku}`, url: `https://x.example/${sku}`, priceCash: 1000, inStock: true, specs: {}, modelKey: `m${sku}`, collectedAt: '' }) as Offer;

describe('cobertura', () => {
  it('anúncios por loja e categoria, frescor e termos coletados', () => {
    const db = openDb(':memory:');
    const T = [{ category: 'gpu' as const, term: 'NVIDIA GeForce' }, { category: 'gpu' as const, term: 'AMD Radeon' }];
    const ids = ensureTerms(db, T, 'seed');
    const now = Date.parse('2026-11-20T20:00:00.000Z');
    saveCollection(db, { store: 's2', category: 'gpu', termId: idOf(ids, T[0]!), offers: [offer('1'), offer('2')], at: '2026-11-20T19:00:00.000Z', complete: true });
    saveCollection(db, { store: 's2', category: 'gpu', termId: idOf(ids, T[1]!), offers: [offer('3')], at: '2026-11-10T19:00:00.000Z', complete: true });
    expect(coverage(db, now)).toEqual([
      { store: 's2', category: 'gpu', listings: 3, seen24h: 2, seen7d: 2, terms: 2, termsOk: 2, lastOkAt: '2026-11-20T19:00:00.000Z', sheets: 0 },
    ]);
  });
});

describe('modelos sem índice de desempenho', () => {
  it('lista os processadores e placas à venda que a tabela não conhece, do mais anunciado ao menos', () => {
    const db = openDb(':memory:');
    const ids = ensureTerms(db, [{ category: 'gpu', term: 'AMD Radeon' }], 'seed');
    const termId = idOf(ids, { category: 'gpu', term: 'AMD Radeon' });
    const gpu = (sku: string, gpuModel?: string) => ({ ...offer(sku), title: `Placa ${gpuModel ?? 'genérica'}`, specs: gpuModel ? { gpuModel } : {} });
    const now = Date.parse('2026-11-20T20:00:00.000Z');
    saveCollection(db, { store: 's2', category: 'gpu', termId, offers: [gpu('1', 'RX 9050'), gpu('2', 'RX 9050'), gpu('3', 'RTX 3060'), gpu('4')], at: '2026-11-20T19:00:00.000Z', complete: true });
    // Visto há mais de 14 dias: não conta.
    saveCollection(db, { store: 's2', category: 'gpu', termId, offers: [gpu('5', 'RX 7650 GRE')], at: '2026-10-01T19:00:00.000Z', complete: false });
    expect(perfGaps(db, now)).toEqual([
      { category: 'gpu', model: 'RX 9050', listings: 2, example: 'Placa RX 9050', store: 's2' },
      { category: 'gpu', model: '', listings: 1, example: 'Placa genérica', store: 's2' },
    ]);
  });
});

describe('termos', () => {
  it('lista com a última coleta por loja, filtra, apaga só pesquisados e dá prioridade', () => {
    const db = openDb(':memory:');
    const seed = ensureTerms(db, [{ category: 'gpu', term: 'NVIDIA GeForce' }], 'seed');
    ensureTerms(db, [{ category: 'gpu', term: 'Zotac RTX 3050 100%' }], 'text', '2026-11-20T10:00:00.000Z');
    saveCollection(db, { store: 's1', category: 'gpu', termId: idOf(seed, { category: 'gpu', term: 'NVIDIA GeForce' }), offers: [offer('1', 's1')], at: '2026-11-20T11:00:00.000Z', complete: true });

    const all = listTerms(db);
    expect(all.map((t) => [t.term, t.origin])).toEqual([
      ['NVIDIA GeForce', 'seed'],
      ['Zotac RTX 3050 100%', 'text'],
    ]);
    expect(all[0]!.runs).toEqual([{ store: 's1', lastOkAt: '2026-11-20T11:00:00.000Z', lastTryAt: '2026-11-20T11:00:00.000Z', status: 'ok', count: 1 }]);
    expect(listTerms(db, { origin: 'text' }).map((t) => t.term)).toEqual(['Zotac RTX 3050 100%']);
    expect(listTerms(db, { q: 'zotac' })).toHaveLength(1);
    expect(listTerms(db, { q: '100%' })).toHaveLength(1); // % é literal, não curinga
    expect(listTerms(db, { q: '%' })).toHaveLength(1);
    expect(listTerms(db, { category: 'cpu' })).toEqual([]);

    const [s, t] = all;
    expect(prioritizeTerm(db, s!.id, '2026-11-20T21:00:00.000Z')).toBe(true);
    expect(listTerms(db)[0]!.lastRequestedAt).toBe('2026-11-20T21:00:00.000Z');
    expect(deleteTerm(db, s!.id)).toBe('seed');
    expect(deleteTerm(db, t!.id)).toBe('deleted');
    expect(deleteTerm(db, t!.id)).toBe('not-found');
    expect(prioritizeTerm(db, 999)).toBe(false);
  });
});

describe('linha do tempo das consultas', () => {
  it('conta por hora: ok, bloqueio e outros', () => {
    const db = openDb(':memory:');
    const a = (at: string, status: 'ok' | 'blocked' | 'error') => recordAttempt(db, { store: 's2', at, kind: 'term', origin: 'routine', status, count: 0, ms: 1 });
    a('2026-11-20T18:05:00.000Z', 'ok');
    a('2026-11-20T18:40:00.000Z', 'blocked');
    a('2026-11-20T19:10:00.000Z', 'error');
    a('2026-11-18T19:10:00.000Z', 'ok'); // fora da janela
    expect(attemptTimeline(db, 24, Date.parse('2026-11-20T20:00:00.000Z'))).toEqual([
      { store: 's2', hour: '2026-11-20T18:00:00.000Z', ok: 1, blocked: 1, other: 0 },
      { store: 's2', hour: '2026-11-20T19:00:00.000Z', ok: 0, blocked: 0, other: 1 },
    ]);
  });
});
