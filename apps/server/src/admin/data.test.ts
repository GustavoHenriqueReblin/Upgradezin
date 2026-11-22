import type { Offer } from '@upgradezin/shared';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/db.ts';
import { recordAttempt } from '../prices/attempts.ts';
import { saveCollection } from '../prices/prices.ts';
import { recordSweepPage } from '../prices/sweep.ts';
import { attemptTimeline, coverage, perfGaps } from './data.ts';

const offer = (sku: string, store: Offer['store'] = 's2'): Offer =>
  ({ store, storeSku: sku, title: `Placa ${sku}`, url: `https://x.example/${sku}`, priceCash: 1000, inStock: true, specs: {}, modelKey: `m${sku}`, collectedAt: '' }) as Offer;

describe('cobertura', () => {
  it('anúncios por loja e categoria, em estoque, frescor e a leitura da categoria (volta em andamento, última completa)', () => {
    const db = openDb(':memory:');
    const now = Date.parse('2026-11-20T20:00:00.000Z');
    saveCollection(db, { store: 's2', category: 'gpu', offers: [offer('1'), { ...offer('2'), inStock: false }], at: '2026-11-20T19:00:00.000Z' });
    saveCollection(db, { store: 's2', category: 'gpu', offers: [offer('3')], at: '2026-11-10T19:00:00.000Z' });
    // Placa de vídeo: uma volta completa; processador: na página 2 do 1º caminho e ainda sem anúncio.
    recordSweepPage(db, { store: 's2', category: 'gpu', path: 0, paths: 1, page: 1, totalPages: 1, maxPages: 40, inStock: 0, offers: [], at: '2026-11-20T18:30:00.000Z' });
    recordSweepPage(db, { store: 's2', category: 'cpu', path: 0, paths: 2, page: 1, totalPages: 5, maxPages: 40, inStock: 30, offers: [], at: '2026-11-20T19:40:00.000Z' });
    const paths = (store: string, category: string) => (store === 's2' && (category === 'gpu' || category === 'cpu') ? (category === 'cpu' ? 2 : 1) : 0);
    expect(coverage(db, paths, now)).toEqual([
      { store: 's2', category: 'cpu', listings: 0, inStock: 0, seen24h: 0, seen7d: 0, paths: 2, sweeping: { path: 1, page: 2 }, sweptAt: null, lastOkAt: null, sheets: 0 },
      // O fim da volta (18h30) marcou o "3", visto antes dela, como sem estoque; o "1" foi visto depois.
      { store: 's2', category: 'gpu', listings: 3, inStock: 1, seen24h: 2, seen7d: 2, paths: 1, sweeping: null, sweptAt: '2026-11-20T18:30:00.000Z', lastOkAt: '2026-11-20T19:00:00.000Z', sheets: 0 },
    ]);
  });
});

describe('modelos sem índice de desempenho', () => {
  it('lista os processadores e placas à venda que a tabela não conhece, do mais anunciado ao menos', () => {
    const db = openDb(':memory:');
    const gpu = (sku: string, gpuModel?: string) => ({ ...offer(sku), title: `Placa ${gpuModel ?? 'genérica'}`, specs: gpuModel ? { gpuModel } : {} });
    const now = Date.parse('2026-11-20T20:00:00.000Z');
    saveCollection(db, { store: 's2', category: 'gpu', offers: [gpu('1', 'RX 9040'), gpu('2', 'RX 9040'), gpu('3', 'RTX 3060'), gpu('4')], at: '2026-11-20T19:00:00.000Z' });
    // Visto há mais de 14 dias: não conta.
    saveCollection(db, { store: 's2', category: 'gpu', offers: [gpu('5', 'RX 7650 GRE')], at: '2026-10-01T19:00:00.000Z' });
    expect(perfGaps(db, now)).toEqual([
      { category: 'gpu', model: 'RX 9040', listings: 2, example: 'Placa RX 9040', store: 's2' },
      { category: 'gpu', model: '', listings: 1, example: 'Placa genérica', store: 's2' },
    ]);
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
