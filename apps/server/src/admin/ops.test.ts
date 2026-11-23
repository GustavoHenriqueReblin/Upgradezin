import { describe, expect, it, vi } from 'vitest';
import type { RoutineSettings, StoreInterval } from '@upgradezin/shared';
import { openDb } from '../db/db.ts';
import { backoffInfo, BlockedError, clearBackoff, DEFAULT_INTERVALS, PageLimitError, pageLimitUntil, pauseStore, registerBlock, registerSuccess, setStoreInterval, storeGap, storeInterval, takePage, useBackoffStorage, useIntervalStorage } from '../pace.ts';
import { attemptCounts, lastAttempt, listAttempts, onAttempt, pageAttempts, recordAttempt, type NewAttempt } from '../prices/attempts.ts';
import { attemptOutcome } from '../prices/collect.ts';
import { isLive, routineInfo, routineNextAt, routineSettings, setRoutineSettings, stopRoutine, tick, useRoutineStorage } from '../prices/routine.ts';
import { useStoreStorage } from '../stores.ts';
import { fullSweep, fullSweepAll, fullSweepOf, probePage, fullSweepSettings, readSheetNow, resumeRoutines, saveFullSweepSettings, stopFullSweep, storesState, useStoreIntervals } from './actions.ts';
import { setSheetRoutine, sheetRoutineSettings, stopSheetRoutine, useSheetRoutineStorage } from '../prices/sheet-routine.ts';
import { getMeta, setMeta } from '../db/db.ts';
import { usePageLoader } from '../browser.ts';
import { fixture, s1CpuListPage } from '../adapters/fixtures.ts';
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
    expect(routineSettings()).toEqual({ enabled: false, stores: ['s2'], live: { s1: true, s2: true, s3: true } });
    expect(routineInfo()).toMatchObject({ enabled: false, nextTickAt: null, busy: false });

    setRoutineSettings({ enabled: true, stores: ['s3', 's1', 'x9' as 's1'] });
    expect(routineSettings()).toEqual({ enabled: true, stores: ['s1', 's3'], live: { s1: true, s2: true, s3: true } }); // ordem das lojas, sem a inválida
    expect(saved.at(-1)).toEqual({ enabled: true, stores: ['s1', 's3'], live: { s1: true, s2: true, s3: true } });
    expect(routineInfo().nextTickAt).not.toBeNull(); // ligada: próxima rodada marcada

    setRoutineSettings({ enabled: false, stores: ['s1'] });
    expect(routineInfo().nextTickAt).toBeNull();
    stopRoutine();
  });

  it('busca ao vivo: guardada, não enviada fica como estava; modos e segundos antigos guardados são ignorados', () => {
    const saved: RoutineSettings[] = [];
    useRoutineStorage({ enabled: false, stores: [], live: { s3: false }, modes: { s2: 'reduced' }, seconds: { normal: 300 } } as never, (s) => saved.push(s));
    expect(routineSettings()).toEqual({ enabled: false, stores: [], live: { s1: true, s2: true, s3: false } });
    expect(isLive('s3')).toBe(false);
    setRoutineSettings({ enabled: false, stores: [], live: { s3: true } });
    expect(isLive('s3')).toBe(true);
    setRoutineSettings({ enabled: false, stores: [] });
    expect(routineSettings().live.s3).toBe(true); // não enviado: fica como estava
    expect(saved.at(-1)).toEqual({ enabled: false, stores: [], live: { s1: true, s2: true, s3: true } });
    stopRoutine();
  });

  it('intervalos da loja (listagens e fichas): padrão sem nada guardado; guardado vale; inválido fica como estava', () => {
    const saved: [string, string, StoreInterval][] = [];
    useIntervalStorage({ list: { s2: { minS: 26, maxS: 60 }, s3: { minS: 1, maxS: 5 } }, sheet: { s2: { minS: 10, maxS: 12 } } }, (store, kind, i) => saved.push([store, kind, i]));
    expect(storeInterval('s1', 'list')).toEqual(DEFAULT_INTERVALS.list);
    expect(storeInterval('s1', 'sheet')).toEqual(DEFAULT_INTERVALS.sheet);
    expect(storeInterval('s2', 'list')).toEqual({ minS: 26, maxS: 60 });
    expect(storeInterval('s2', 'sheet')).toEqual({ minS: 10, maxS: 12 });
    expect(storeInterval('s3', 'list')).toEqual(DEFAULT_INTERVALS.list); // 1 s: abaixo do mínimo, ignorado
    expect(setStoreInterval('s1', 'list', { minS: 40, maxS: 20 })).toEqual(DEFAULT_INTERVALS.list); // invertido: fica como estava
    expect(setStoreInterval('s1', 'list', { minS: 24, maxS: 35 })).toEqual({ minS: 24, maxS: 35 });
    expect(setStoreInterval('s1', 'sheet', { minS: 10, maxS: 15 })).toEqual({ minS: 10, maxS: 15 });
    expect(saved).toEqual([['s1', 'list', { minS: 24, maxS: 35 }], ['s1', 'sheet', { minS: 10, maxS: 15 }]]);
    for (let i = 0; i < 50; i++) {
      const g = storeGap('s1', 'list');
      expect(g).toBeGreaterThanOrEqual(24_000);
      expect(g).toBeLessThanOrEqual(35_000);
      const f = storeGap('s1', 'sheet');
      expect(f).toBeGreaterThanOrEqual(10_000);
      expect(f).toBeLessThanOrEqual(15_000);
    }
    expect(storesState(openDb(':memory:')).find((s) => s.id === 's1')?.listInterval).toEqual({ minS: 24, maxS: 35 });
    useIntervalStorage({}, () => {});
  });

  it('intervalos guardados de antes: o da varredura completa vira o de listagens, os segundos da rotina de fichas viram o de fichas; o novo guardado vale no lugar', () => {
    const db = openDb(':memory:');
    setMeta(db, 'full-sweep:s2', JSON.stringify({ minS: 26, maxS: 60, categories: ['psu'] }));
    setMeta(db, 'full-sweep:s3', JSON.stringify({ minS: 26, maxS: 60, categories: ['psu'] }));
    setMeta(db, 'interval:s3', JSON.stringify({ minS: 30, maxS: 90 }));
    setMeta(db, 'sheet-routine', JSON.stringify({ enabled: true, stores: ['s1'], seconds: 10 }));
    setMeta(db, 'sheet-interval:s3', JSON.stringify({ minS: 20, maxS: 30 }));
    useStoreIntervals(db);
    expect(storeInterval('s1', 'list')).toEqual(DEFAULT_INTERVALS.list);
    expect(storeInterval('s2', 'list')).toEqual({ minS: 26, maxS: 60 });
    expect(storeInterval('s3', 'list')).toEqual({ minS: 30, maxS: 90 });
    expect(storeInterval('s1', 'sheet')).toEqual({ minS: 10, maxS: 12 }); // 10 s + até 20%
    expect(storeInterval('s3', 'sheet')).toEqual({ minS: 20, maxS: 30 });
    setStoreInterval('s1', 'list', { minS: 24, maxS: 35 });
    setStoreInterval('s1', 'sheet', { minS: 10, maxS: 15 });
    expect(JSON.parse(getMeta(db, 'interval:s1')!)).toEqual({ minS: 24, maxS: 35 });
    expect(JSON.parse(getMeta(db, 'sheet-interval:s1')!)).toEqual({ minS: 10, maxS: 15 });
    useIntervalStorage({}, () => {});
  });

  it('loja em pausa na sua vez: não consulta e confere de novo em 1 min', async () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    pauseStore('s2', 15);
    setRoutineSettings({ enabled: true, stores: ['s2'] });
    const first = routineNextAt('s2')!;
    expect(first - Date.now()).toBeGreaterThan(5_000); // primeira vez 10 s depois de ligar
    expect(routineNextAt('s1')).toBeNull(); // fora da rotina
    await tick(first);
    const next = routineNextAt('s2')! - Date.now();
    expect(next).toBeGreaterThan(50_000);
    expect(next).toBeLessThanOrEqual(60_000);
    // No painel, a próxima consulta não vem antes do fim da pausa.
    const s2 = storesState(db).find((s) => s.id === 's2')!;
    expect(s2).toMatchObject({ listInterval: DEFAULT_INTERVALS.list, live: true, inRoutine: true, busy: false, queue: { running: false, priority: 0, routine: 0 } });
    expect(Date.parse(s2.nextAt!)).toBeGreaterThan(Date.now() + 14 * 60_000);
    setRoutineSettings({ enabled: false, stores: [] });
    stopRoutine();
    clearBackoff('s2');
  });
});

describe('varredura completa e painel das lojas', () => {
  it('recusa loja em pausa, loja sem página de categoria e loja desconhecida, sem ir à loja nem mexer na rotina', () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    pauseStore('s1', 60);
    expect(fullSweep(db, 's1')).toMatchObject({ ok: false, error: expect.stringContaining('pausa') });
    clearBackoff('s1');
    expect(fullSweep(db, 's2')).toMatchObject({ ok: false, error: expect.stringContaining('Nenhuma página') });
    expect(fullSweep(db, 's9' as 's1')).toMatchObject({ ok: false });
    expect(fullSweepOf('s1')).toBeNull();
  });

  it('pausa a rotina de preços e a de fichas, lê todas as categorias da loja até o fim (esgotados também), uma depois da outra, e volta cada rotina a como estava', async () => {
    const db = getDb();
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    useSheetRoutineStorage(null, () => {});
    setRoutineSettings({ enabled: true, stores: ['s3'] });
    setSheetRoutine({ enabled: true, stores: ['s3'] });
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: s1CpuListPage(url), url, title: '' };
    });
    try {
      expect(fullSweep(db, 's1')).toMatchObject({ ok: true });
      expect(routineSettings().enabled).toBe(false);
      expect(sheetRoutineSettings().enabled).toBe(false);
      expect(JSON.parse(getMeta(db, 'sweep-paused')!)).toEqual({ routine: true, sheets: true }); // sobrevive a um reinício
      expect(fullSweepOf('s1')).toMatchObject({ category: 'cpu', index: 0, total: 2 });
      expect(storesState(db).find((x) => x.id === 's1')?.fullSweep).toMatchObject({ total: 2 });
      expect(fullSweep(db, 's1')).toMatchObject({ ok: false, error: expect.stringContaining('já está rodando') });
      for (let i = 0; i < 500 && fullSweepOf('s1'); i++) await new Promise((r) => setTimeout(r, 10));
      expect(fullSweepOf('s1')).toBeNull();
      // As duas categorias da loja (processadores e fontes), cada uma até a última página da lista (6).
      expect(sweepState(db, 's1', 'cpu').doneAt).toBeTruthy();
      expect(sweepState(db, 's1', 'psu').doneAt).toBeTruthy();
      expect(urls.filter((u) => u.includes('/hardware/processadores')).length).toBe(6);
      expect(urls.filter((u) => u.includes('/hardware/fontes')).length).toBe(6);
      expect(listAttempts(db, { limit: 5 }).some((x) => x.kind === 'sweep' && x.origin === 'admin')).toBe(true);
      expect(routineSettings().enabled).toBe(true);
      expect(sheetRoutineSettings().enabled).toBe(true);
      expect(getMeta(db, 'sweep-paused')).toBeUndefined();
    } finally {
      usePageLoader(null);
      setRoutineSettings({ enabled: false, stores: [] });
      stopRoutine();
      setSheetRoutine({ enabled: false });
      stopSheetRoutine();
    }
  });

  it('configuração: sem nada guardado, o intervalo da loja e todas as categorias com página; só as marcadas são lidas; nenhuma marcada recusa', async () => {
    const db = getDb();
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    useSheetRoutineStorage(null, () => {});
    db.prepare("DELETE FROM meta WHERE key LIKE 'full-sweep:%'").run();
    expect(fullSweepSettings(db, 's1')).toEqual({ categories: ['cpu', 'psu'] });
    expect(storesState(db).find((x) => x.id === 's1')).toMatchObject({ sweepCategories: ['cpu', 'psu'], fullSweepSettings: { categories: ['cpu', 'psu'] } });
    // Categoria sem página na loja (gpu) não entra.
    expect(saveFullSweepSettings(db, 's1', { categories: ['psu', 'gpu'] })).toEqual({ categories: ['psu'] });
    const urls: string[] = [];
    usePageLoader(async (_store, url) => {
      urls.push(url);
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    try {
      expect(fullSweep(db, 's1')).toMatchObject({ ok: true });
      expect(fullSweepOf('s1')).toMatchObject({ category: 'psu', total: 1 });
      for (let i = 0; i < 500 && fullSweepOf('s1'); i++) await new Promise((r) => setTimeout(r, 10));
      expect(urls.length).toBe(6);
      expect(urls.every((u) => u.includes('/hardware/fontes'))).toBe(true);
      saveFullSweepSettings(db, 's1', { categories: [] });
      expect(fullSweep(db, 's1')).toMatchObject({ ok: false, error: expect.stringContaining('Nenhuma categoria marcada') });
    } finally {
      usePageLoader(null);
      db.prepare("DELETE FROM meta WHERE key LIKE 'full-sweep:%'").run();
    }
  });

  it('parar: interrompe a varredura, a categoria do meio volta ao normal e as rotinas voltam a como estavam', async () => {
    const db = getDb();
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    useSheetRoutineStorage(null, () => {});
    setRoutineSettings({ enabled: true, stores: ['s3'] });
    setSheetRoutine({ enabled: false, stores: ['s3'] });
    saveFullSweepSettings(db, 's1', { categories: ['cpu', 'psu'] });
    let pages = 0;
    usePageLoader(async (_store, url) => {
      pages++;
      await new Promise((r) => setTimeout(r, 30)); // página lenta: dá tempo de parar no meio
      return { html: fixture('s1-cpu.html'), url, title: '' };
    });
    try {
      expect(stopFullSweep('s1')).toBe(false); // nada rodando
      expect(fullSweep(db, 's1')).toMatchObject({ ok: true });
      for (let i = 0; i < 200 && pages < 2; i++) await new Promise((r) => setTimeout(r, 5));
      expect(stopFullSweep('s1')).toBe(true);
      for (let i = 0; i < 300 && fullSweepOf('s1'); i++) await new Promise((r) => setTimeout(r, 10));
      expect(fullSweepOf('s1')).toBeNull();
      expect(pages).toBeLessThan(6); // não terminou nem a primeira categoria
      expect(sweepState(db, 's1', 'cpu').full).toBeUndefined(); // a rotina não continua a volta completa
      expect(sweepState(db, 's1', 'cpu')).toMatchObject({ page: 1 });
      expect(routineSettings().enabled).toBe(true);
      expect(sheetRoutineSettings().enabled).toBe(false);
      expect(getMeta(db, 'sweep-paused')).toBeUndefined();
    } finally {
      usePageLoader(null);
      setRoutineSettings({ enabled: false, stores: [] });
      stopRoutine();
      db.prepare("DELETE FROM meta WHERE key LIKE 'full-sweep:%'").run();
    }
  });

  it('reinício no meio da varredura: ao subir, cada rotina volta a como estava antes dela', () => {
    const db = openDb(':memory:');
    useRoutineStorage(null, () => {});
    useSheetRoutineStorage(null, () => {});
    setRoutineSettings({ enabled: false, stores: ['s3'] });
    setSheetRoutine({ enabled: false, stores: ['s3'] });
    setMeta(db, 'sweep-paused', JSON.stringify({ routine: true, sheets: false }));
    expect(resumeRoutines(db)).toEqual({ routine: true, sheets: false });
    expect(routineSettings().enabled).toBe(true);
    expect(sheetRoutineSettings().enabled).toBe(false);
    expect(getMeta(db, 'sweep-paused')).toBeUndefined();
    expect(resumeRoutines(db)).toBeNull();
    setRoutineSettings({ enabled: false, stores: [] });
    stopRoutine();
  });

  it('madrugada: varredura completa em todas as lojas que leem página de categoria; a loja que recusa não impede as outras', async () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    pauseStore('s3', 60);
    usePageLoader(async (_store, url) => ({ html: fixture('s1-cpu.html'), url, title: '' }));
    try {
      const r = fullSweepAll(db);
      expect(r.find((x) => x.store === 's3')?.result).toMatchObject({ ok: false, error: expect.stringContaining('pausa') });
      expect(r.find((x) => x.store === 's1')?.result).toMatchObject({ ok: true });
      for (let i = 0; i < 500 && fullSweepOf('s1'); i++) await new Promise((res) => setTimeout(res, 10));
      expect(fullSweepOf('s1')).toBeNull();
    } finally {
      clearBackoff('s3');
      usePageLoader(null);
    }
  });

  it('rotina desligada antes: continua desligada no fim', async () => {
    const db = getDb();
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    useRoutineStorage(null, () => {});
    setRoutineSettings({ enabled: false, stores: [] });
    usePageLoader(async (_store, url) => ({ html: fixture('s1-cpu.html'), url, title: '' }));
    try {
      expect(fullSweep(db, 's1')).toMatchObject({ ok: true });
      for (let i = 0; i < 500 && fullSweepOf('s1'); i++) await new Promise((r) => setTimeout(r, 10));
      expect(fullSweepOf('s1')).toBeNull();
      expect(routineSettings().enabled).toBe(false);
    } finally {
      usePageLoader(null);
    }
  });

  it('testar página: abre a página pedida direto, espera o resultado, grava as ofertas sem mexer na volta da categoria; bloqueio vem no resultado sem pausar a loja; recusa pausa e página fora do limite', async () => {
    const db = getDb();
    useStoreStorage(db);
    useBackoffStorage([], () => {});
    const urls: string[] = [];
    let block = false;
    // Os testes de antes gastaram as páginas da hora da loja: duas horas depois, a conta recomeça.
    const later = Date.now() + 2 * 3_600_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => later);
    // Intervalo entre as páginas: o da loja (o menor possível, para o teste).
    useIntervalStorage({ list: { s1: { minS: 2, maxS: 2 } } }, () => {});
    const waits: number[] = [];
    const realTimeout = globalThis.setTimeout;
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if ((ms ?? 0) >= 1000) waits.push(ms!);
      return realTimeout(fn, ms && ms >= 1000 ? 0 : ms);
    }) as typeof setTimeout);
    usePageLoader(async (_store, url) => {
      urls.push(url);
      if (block) throw new BlockedError('s1', 'unavailable', 'Página de manutenção: teste');
      return { html: fixture('s1-psu.html'), url, title: '' };
    });
    try {
      const before = JSON.stringify(sweepState(db, 's1', 'psu'));
      const ok = await probePage(db, 's1', 'psu', { page: 2 });
      expect(ok).toMatchObject({ ok: true, results: [{ status: 'ok' }] });
      if (!ok.ok) throw new Error();
      expect(ok.results[0]!.count).toBeGreaterThan(0);
      expect(ok.results[0]!.url).toContain('page=2');
      const lists = () => urls.filter((u) => u.includes('/hardware/'));
      expect(lists()).toEqual([expect.stringContaining('/hardware/fontes?page_number=2')]); // só a página pedida, sem a 1 antes
      expect(JSON.stringify(sweepState(db, 's1', 'psu'))).toBe(before); // a volta da categoria fica como estava
      expect(listAttempts(db, { limit: 1 })[0]).toMatchObject({ kind: 'sweep', origin: 'admin', category: 'psu', page: 2, status: 'ok' });
      // Endereço próprio, 3 páginas seguidas, cada uma direto pelo endereço (com o parâmetro), com o
      // intervalo da loja (2 s) antes de cada uma.
      waits.length = 0;
      const own = await probePage(db, 's1', 'psu', { page: 1, pages: 3, path: '/hardware/fontes?product_category=6444' });
      expect(own).toMatchObject({ ok: true, results: [{ status: 'ok' }, { status: 'ok' }, { status: 'ok' }] });
      expect(lists().slice(-3).every((u) => u.includes('product_category=6444'))).toBe(true);
      expect(lists().slice(-2).map((u) => new URL(u).searchParams.get('page_number'))).toEqual(['2', '3']);
      expect(waits).toEqual([2000, 2000, 2000]);
      block = true;
      // Para na primeira que não abre.
      const no = await probePage(db, 's1', 'psu', { page: 2, pages: 3 });
      expect(no).toMatchObject({ ok: true, results: [{ status: 'blocked', count: 0, detail: expect.stringContaining('manutenção') }] });
      expect(backoffInfo('s1')).toBeNull(); // uma página pedida à mão: não pausa a loja
      expect(listAttempts(db, { limit: 1 })[0]).toMatchObject({ status: 'blocked', origin: 'admin' });
      const n = lists().length;
      expect(await probePage(db, 's1', 'psu', { page: 0 })).toMatchObject({ ok: false });
      expect(await probePage(db, 's1', 'psu', { page: 1, pages: 6 })).toMatchObject({ ok: false });
      expect(await probePage(db, 's1', 'psu', { page: 1, path: '//outro.example/x' })).toMatchObject({ ok: false });
      expect(await probePage(db, 's1', 'psu', { page: 51 })).toMatchObject({ ok: false });
      expect(await probePage(db, 's9' as 's1', 'psu', { page: 2 })).toMatchObject({ ok: false });
      pauseStore('s1', 60);
      expect(await probePage(db, 's1', 'psu', { page: 2 })).toMatchObject({ ok: false, error: expect.stringContaining('pausa') });
      clearBackoff('s1');
      while (!pageLimitUntil('s1')) takePage('s1');
      expect(await probePage(db, 's1', 'psu', { page: 2 })).toMatchObject({ ok: false, error: expect.stringContaining('Limite de páginas') });
      expect(lists().length).toBe(n);
    } finally {
      useIntervalStorage({}, () => {});
      timers.mockRestore();
      clock.mockRestore();
      clearBackoff('s1');
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
