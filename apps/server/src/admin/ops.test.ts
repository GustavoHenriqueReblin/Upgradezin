import { describe, expect, it } from 'vitest';
import type { RoutineSettings } from '@upgradezin/shared';
import { openDb } from '../db/db.ts';
import { backoffInfo, BlockedError, clearBackoff, PageLimitError, pauseStore, registerBlock, registerSuccess, useBackoffStorage } from '../pace.ts';
import { attemptCounts, lastAttempt, listAttempts, onAttempt, pageAttempts, recordAttempt, type NewAttempt } from '../prices/attempts.ts';
import { attemptOutcome } from '../prices/collect.ts';
import { isLive, modeDelay, routineInfo, routineNextAt, routineSettings, setRoutineSettings, stopRoutine, tick, useRoutineStorage } from '../prices/routine.ts';
import { useStoreStorage } from '../stores.ts';
import { readSheetNow, storesState, sweepNow } from './actions.ts';
import { usePageLoader } from '../browser.ts';
import { fixture } from '../adapters/fixtures.ts';
import { getDb } from '../db/instance.ts';
import { sweepState } from '../prices/sweep.ts';
import { saveCollection } from '../prices/prices.ts';

describe('pausa manual e tirar pausa', () => {
  it('pausa sem bloqueio antes: próximo bloqueio começa em 15 min (não sobe a escada)', () => {
    const saved: unknown[] = [];
    useBackoffStorage([], (_s, b) => saved.push(b));
    const now = Date.now();
    const b = pauseStore('s3', 60, now);
    expect(b).toMatchObject({ step: -1, reason: 'paused', until: now + 3_600_000 });
    expect(backoffInfo('s3')?.reason).toBe('paused');
    expect(saved.at(-1)).toMatchObject({ reason: 'paused' });
    clearBackoff('s3');
    registerBlock('s3', 'unavailable');
    expect(backoffInfo('s3')?.step).toBe(0);
    registerSuccess('s3');
  });

  it('pausa depois de bloqueio mantém o degrau; tirar a pausa apaga e grava', () => {
    const saved: unknown[] = [];
    useBackoffStorage([], (_s, b) => saved.push(b));
    registerBlock('s2', 'unavailable');
    registerBlock('s2', 'unavailable');
    expect(pauseStore('s2', 30).step).toBe(1);
    expect(clearBackoff('s2')).toBe(true);
    expect(backoffInfo('s2')).toBeNull();
    expect(saved.at(-1)).toBeNull();
    expect(clearBackoff('s2')).toBe(false); // já sem pausa
  });
});

describe('resultado da consulta (attemptOutcome)', () => {
  it('ok, bloqueio, parcial, limite e erro', () => {
    expect(attemptOutcome(undefined, 30)).toEqual({ status: 'ok' });
    expect(attemptOutcome(new BlockedError('s2', 'unavailable', 'Página sem dados'), 0)).toEqual({ status: 'blocked', reason: 'unavailable', detail: 'Página sem dados' });
    expect(attemptOutcome(new BlockedError('s2', 'unavailable', 'x'), 12).status).toBe('partial');
    expect(attemptOutcome(new PageLimitError('s1', 0), 0).status).toBe('limit');
    expect(attemptOutcome(new Error('timeout'), 5)).toEqual({ status: 'error', detail: 'timeout' });
  });
});

const att = (p: Partial<NewAttempt>): NewAttempt => ({ store: 's2', at: '2026-11-20T20:00:00.000Z', kind: 'term', origin: 'routine', status: 'ok', count: 30, ms: 2500, ...p });

describe('registro de consultas', () => {
  it('grava, lista do mais recente, filtra, avisa quem escuta', () => {
    const db = openDb(':memory:');
    const heard: number[] = [];
    const off = onAttempt((a) => heard.push(a.id));
    recordAttempt(db, att({ at: '2026-11-20T20:00:00.000Z', category: 'psu', term: '750W' }));
    recordAttempt(db, att({ at: '2026-11-20T20:20:00.000Z', status: 'blocked', reason: 'unavailable', detail: 'x'.repeat(300), count: 0 }));
    recordAttempt(db, att({ store: 's1', at: '2026-11-20T20:30:00.000Z', origin: 'search' }));
    off();
    expect(heard).toEqual([1, 2, 3]);
    expect(listAttempts(db).map((a) => a.id)).toEqual([3, 2, 1]);
    expect(listAttempts(db, { store: 's2', status: 'blocked' })).toHaveLength(1);
    expect(listAttempts(db, { store: 's2', status: 'blocked' })[0]!.detail).toHaveLength(200); // cortado
    expect(listAttempts(db, { origin: 'search' }).map((a) => a.store)).toEqual(['s1']);
    expect(listAttempts(db, { before: 3, limit: 1 }).map((a) => a.id)).toEqual([2]);
    expect(listAttempts(db, { since: '2026-11-20T20:10:00.000Z' })).toHaveLength(2);
    // Admin, paginado: mais recentes primeiro, com o total dos filtros.
    expect(pageAttempts(db, { pageSize: 2 })).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(pageAttempts(db, { pageSize: 2 }).items.map((a) => a.id)).toEqual([3, 2]);
    expect(pageAttempts(db, { pageSize: 2, page: 2 }).items.map((a) => a.id)).toEqual([1]);
    expect(pageAttempts(db, { store: 's2', status: 'blocked' })).toMatchObject({ total: 1, pageSize: 50 });
    expect(listAttempts(db)[2]).toEqual({ id: 1, ...att({ category: 'psu', term: '750W' }) });
  });

  it('última coleta boa, último bloqueio e contagem por resultado', () => {
    const db = openDb(':memory:');
    recordAttempt(db, att({ at: '2026-11-20T19:00:00.000Z' }));
    recordAttempt(db, att({ at: '2026-11-20T20:00:00.000Z', status: 'blocked' }));
    recordAttempt(db, att({ at: '2026-11-20T21:00:00.000Z' }));
    expect(lastAttempt(db, 's2', ['ok'])?.at).toBe('2026-11-20T21:00:00.000Z');
    expect(lastAttempt(db, 's2', ['blocked'])?.at).toBe('2026-11-20T20:00:00.000Z');
    expect(lastAttempt(db, 's1', ['ok'])).toBeNull();
    expect(attemptCounts(db, 's2', '2026-11-20T19:30:00.000Z')).toEqual({ ok: 1, blocked: 1 });
  });
});

describe('rotina pelo admin', () => {
  it('o guardado vale no lugar do .env; mudar guarda, limpa lojas inválidas e reinicia', () => {
    const saved: unknown[] = [];
    useRoutineStorage({ enabled: false, stores: ['s2'] }, (s) => saved.push(s));
    expect(routineSettings()).toEqual({ enabled: false, stores: ['s2'], modes: { s1: 'normal', s2: 'slow', s3: 'slow' }, live: { s1: true, s2: true, s3: true }, seconds: { normal: 15, reduced: 20, slow: 60 } }); // sem modos guardados: o padrão (ROUTINE_SLOW_STORES do .env começa no lento)
    expect(routineInfo()).toMatchObject({ enabled: false, nextTickAt: null, busy: false });

    setRoutineSettings({ enabled: true, stores: ['s3', 's1', 'x9' as 's1'] });
    expect(routineSettings()).toEqual({ enabled: true, stores: ['s1', 's3'], modes: { s1: 'normal', s2: 'slow', s3: 'slow' }, live: { s1: true, s2: true, s3: true }, seconds: { normal: 15, reduced: 20, slow: 60 } }); // ordem das lojas, sem a inválida
    expect(saved.at(-1)).toEqual({ enabled: true, stores: ['s1', 's3'], modes: { s1: 'normal', s2: 'slow', s3: 'slow' }, live: { s1: true, s2: true, s3: true }, seconds: { normal: 15, reduced: 20, slow: 60 } });
    expect(routineInfo().nextTickAt).not.toBeNull(); // ligada: próxima rodada marcada

    setRoutineSettings({ enabled: false, stores: ['s1'] });
    expect(routineInfo().nextTickAt).toBeNull();
    stopRoutine();
  });

  it('modo por loja: muda só o enviado, inválido volta ao padrão, e guardado vale', () => {
    const saved: RoutineSettings[] = [];
    useRoutineStorage({ enabled: false, stores: [], modes: { s2: 'reduced' } }, (s) => saved.push(s));
    expect(routineSettings().modes).toEqual({ s1: 'normal', s2: 'reduced', s3: 'slow' });
    setRoutineSettings({ enabled: false, stores: [], modes: { s3: 'normal' } });
    expect(routineSettings().modes).toEqual({ s1: 'normal', s2: 'reduced', s3: 'normal' }); // s2 ficou como estava
    expect(saved.at(-1)?.modes.s3).toBe('normal');
    setRoutineSettings({ enabled: false, stores: [], modes: { s1: 'turbo' as 'slow' } });
    expect(routineSettings().modes.s1).toBe('normal');
    expect(routineInfo().seconds).toEqual({ normal: 15, reduced: 20, slow: 60 });
    stopRoutine();
  });

  it('busca ao vivo e segundos dos modos: independentes do modo, guardados, inválido fica como estava', () => {
    const saved: RoutineSettings[] = [];
    useRoutineStorage({ enabled: false, stores: [], live: { s3: false }, seconds: { normal: 300 } }, (s) => saved.push(s));
    expect(routineSettings().live).toEqual({ s1: true, s2: true, s3: false });
    expect(isLive('s3')).toBe(false);
    expect(routineSettings().seconds).toEqual({ normal: 300, reduced: 20, slow: 60 });
    setRoutineSettings({ enabled: false, stores: [], modes: { s3: 'slow' }, live: { s3: true }, seconds: { slow: 1, reduced: 45 } });
    expect(isLive('s3')).toBe(true);
    expect(routineSettings().seconds).toEqual({ normal: 300, reduced: 45, slow: 60 }); // 1 s: abaixo do mínimo, ficou o de antes
    setRoutineSettings({ enabled: false, stores: [] });
    expect(routineSettings().live.s3).toBe(true); // não enviado: fica como estava
    expect(saved.at(-1)?.seconds.reduced).toBe(45);
    stopRoutine();
  });

  it('intervalo dos modos: os segundos mais até 20%', () => {
    expect(modeDelay(15, 0)).toBe(15_000);
    expect(modeDelay(60, 1)).toBe(72_000);
  });

  it('loja em pausa na sua vez: não consulta e confere de novo em 1 min', async () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    pauseStore('s2', 15);
    setRoutineSettings({ enabled: true, stores: ['s2'], modes: { s2: 'reduced' } });
    const first = routineNextAt('s2')!;
    expect(first - Date.now()).toBeGreaterThan(5_000); // primeira vez 10 s depois de ligar
    expect(routineNextAt('s1')).toBeNull(); // fora da rotina
    await tick(first);
    const next = routineNextAt('s2')! - Date.now();
    expect(next).toBeGreaterThan(50_000);
    expect(next).toBeLessThanOrEqual(60_000);
    // No painel, a próxima consulta não vem antes do fim da pausa.
    const s2 = storesState(db).find((s) => s.id === 's2')!;
    expect(s2).toMatchObject({ mode: 'reduced', live: true, inRoutine: true, busy: false, queue: { running: false, priority: 0, routine: 0 } });
    expect(Date.parse(s2.nextAt!)).toBeGreaterThan(Date.now() + 14 * 60_000);
    setRoutineSettings({ enabled: false, stores: [] });
    stopRoutine();
    clearBackoff('s2');
  });
});

describe('varrer agora e painel das lojas', () => {
  it('recusa loja em pausa, categoria sem página na loja e loja desconhecida, sem ir à loja', () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    pauseStore('s1', 60);
    expect(sweepNow(db, 's1', 'cpu')).toMatchObject({ ok: false, error: expect.stringContaining('pausa') });
    clearBackoff('s1');
    expect(sweepNow(db, 's1', 'gpu')).toMatchObject({ ok: false, error: expect.stringContaining('Sem página') });
    expect(sweepNow(db, 's9' as 's1', 'cpu')).toMatchObject({ ok: false });
  });

  it('lê a categoria inteira do começo, na frente da rotina; a mesma categoria não roda duas vezes ao mesmo tempo', async () => {
    const db = getDb();
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    try {
      expect(sweepNow(db, 's1', 'cpu')).toMatchObject({ ok: true });
      expect(sweepNow(db, 's1', 'cpu')).toMatchObject({ ok: false, error: expect.stringContaining('já está sendo lida') });
      for (let i = 0; i < 300 && !sweepState(db, 's1', 'cpu').doneAt; i++) await new Promise((r) => setTimeout(r, 10));
      expect(sweepState(db, 's1', 'cpu').doneAt).toBeTruthy();
      expect(urls[0]).toContain('/hardware/processadores?page_number=1');
      expect(listAttempts(db, { limit: 5 }).some((a) => a.kind === 'sweep' && a.origin === 'admin')).toBe(true);
    } finally {
      usePageLoader(null);
    }
  });

  it('"Ler ficha": qualquer categoria; recusa produto fora do catálogo, loja desligada e loja em pausa', () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    saveCollection(db, {
      store: 's1',
      category: 'cpu',
      offers: [{ store: 's1', storeSku: 'p1', title: 'Ryzen 5 5600', url: 'https://www.s1.example/produto/p1', priceCash: 800, inStock: true, specs: {}, modelKey: 'p1', collectedAt: '' } as never],
      at: new Date().toISOString(),
    });
    expect(readSheetNow(db, 's1', 'nao-existe')).toMatchObject({ ok: false, error: expect.stringContaining('não encontrado') });
    expect(readSheetNow(db, 's9' as 's1', 'p1')).toMatchObject({ ok: false });
    pauseStore('s1', 60);
    saveCollection(db, {
      store: 's1',
      category: 'gpu',
      offers: [{ store: 's1', storeSku: 'g1', title: 'RTX 5060', url: 'https://www.s1.example/produto/g1', priceCash: 2000, inStock: true, specs: {}, modelKey: 'g1', collectedAt: '' } as never],
      at: new Date().toISOString(),
    });
    expect(readSheetNow(db, 's1', 'g1')).toMatchObject({ ok: false, error: expect.stringContaining('pausa') });
    clearBackoff('s1');
  });

  it('painel: pausa, rotina, últimas consultas e contagem do dia', () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    useRoutineStorage({ enabled: true, stores: ['s2'] }, () => {});
    const now = Date.now();
    recordAttempt(db, att({ at: new Date(now - 60_000).toISOString() }));
    recordAttempt(db, att({ at: new Date(now - 30_000).toISOString(), status: 'blocked', reason: 'unavailable' }));
    pauseStore('s2', 15, now);
    const s2 = storesState(db, now).find((s) => s.id === 's2')!;
    expect(s2).toMatchObject({ name: 'Loja S2', enabled: true, inRoutine: true, pause: { reason: 'paused', step: -1 }, last24h: { ok: 1, blocked: 1 } });
    expect(s2.lastOk?.status).toBe('ok');
    expect(s2.lastBlock?.reason).toBe('unavailable');
    expect(storesState(db, now).find((s) => s.id === 's1')).toMatchObject({ inRoutine: false, pause: null, lastOk: null });
    clearBackoff('s2');
  });
});
