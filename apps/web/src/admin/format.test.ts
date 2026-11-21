import { describe, expect, it } from 'vitest';
import { countdown, modeHint, matchesNever, neverCollectedIn, routineStores, mergeLines, attemptLabel, attemptResult, attemptWhat, formatDuration, formatWhen, loginError, pauseLabel, previewBackground } from './format.ts';

describe('formatação do admin', () => {
  it('duração', () => {
    expect(formatDuration(40)).toBe('40 s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(2 * 3600 + 15 * 60)).toBe('2 h 15 min');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDuration(3 * 86_400 + 4 * 3600 + 59)).toBe('3 d 4 h');
    expect(formatDuration(-5)).toBe('0 s');
  });
  it('quando: só a hora se for hoje', () => {
    const now = new Date(2026, 10, 20, 22, 0);
    expect(formatWhen(new Date(2026, 10, 20, 21, 5).toISOString(), now)).toBe('21:05');
    expect(formatWhen(new Date(2026, 10, 19, 21, 5).toISOString(), now)).toBe('19/11 21:05');
  });
  it('mensagem do login', () => {
    expect(loginError(401)).toBe('Usuário ou senha incorretos.');
    expect(loginError(429)).toContain('Muitas tentativas');
    expect(loginError(500)).toBe('Não foi possível entrar agora.');
  });
});

describe('prévia da cor da loja', () => {
  it('lisa, degradê ou inválida', () => {
    expect(previewBackground('#FF6500')).toBe('#ff6500');
    expect(previewBackground('ffc300, #e30613')).toBe('linear-gradient(135deg, #ffc300, #e30613)');
    expect(previewBackground('vermelho')).toBeNull();
    expect(previewBackground('')).toBeNull();
  });
});

describe('textos das consultas e pausas', () => {
  const base = { id: 1, store: 's2' as const, at: '2026-11-20T20:00:00.000Z', origin: 'routine' as const, ms: 100 };
  it('o que foi consultado e como terminou', () => {
    expect(attemptLabel({ ...base, kind: 'term', category: 'psu', term: '750W', status: 'ok', count: 36 })).toBe('Fonte "750W": 36 ofertas (rotina)');
    expect(attemptLabel({ ...base, kind: 'sweep', category: 'cooler', page: 13, status: 'blocked', count: 0, origin: 'search' })).toBe('varredura de Cooler, pág. 13: bloqueio (busca)');
    expect(attemptResult({ ...base, kind: 'term', status: 'partial', count: 12 })).toBe('parcial (12 ofertas)');
    expect(attemptResult({ ...base, kind: 'sheet', term: '123', status: 'ok', count: 0 })).toBe('sem ficha');
    expect(attemptWhat({ ...base, kind: 'sheet', term: '123', status: 'ok', count: 1 })).toBe('ficha 123');
  });
  it('pausa manual e por bloqueio', () => {
    const until = new Date(new Date().setHours(21, 30, 0, 0)).toISOString();
    expect(pauseLabel({ until, step: -1, reason: 'paused' })).toBe('pausada até 21:30');
    expect(pauseLabel({ until, step: 0, reason: 'unavailable' })).toBe('bloqueada até 21:30');
    expect(pauseLabel({ until, step: 2, reason: 'unavailable' })).toBe('bloqueada até 21:30, 3º degrau');
  });
});

describe('relatório do merge', () => {
  const zero = { newListings: 0, newerListings: 0, newPricePoints: 0, newTerms: 0, newerRuns: 0, newerSheets: 0 };
  it('só o que entra; nada vira uma linha', () => {
    expect(mergeLines({ ...zero, newListings: 297, newPricePoints: 2172 })).toEqual(['297 anúncio(s) novo(s)', '2172 ponto(s) de histórico de preço']);
    expect(mergeLines(zero)).toEqual(['nada: este servidor já tem tudo o que o banco enviado tem']);
  });
});

describe('lojas da rotina', () => {
  it('desligada: nenhuma, mesmo com lojas guardadas', () => {
    expect(routineStores({ enabled: true, stores: ['s1', 's3'] })).toEqual(['s1', 's3']);
    expect(routineStores({ enabled: false, stores: ['s1'] })).toEqual([]);
  });
});

describe('termos nunca coletados', () => {
  const stores = ['s1', 's2', 's3'];
  const t = (runs: [string, string | null][]) => ({ runs: runs.map(([store, lastOkAt]) => ({ store, lastOkAt })) });
  it('lojas sem coleta boa (tentativa bloqueada não conta)', () => {
    expect(neverCollectedIn(t([['s1', '2026-11-20'], ['s2', null]]), stores)).toEqual(['s2', 's3']);
  });
  it('filtro: em nenhuma loja, em alguma, ou todos', () => {
    const never = t([['s2', null]]);
    const partial = t([['s1', '2026-11-20']]);
    const full = t([['s1', 'a'], ['s2', 'b'], ['s3', 'c']]);
    expect([never, partial, full].map((x) => matchesNever(x, stores, 'none'))).toEqual([true, false, false]);
    expect([never, partial, full].map((x) => matchesNever(x, stores, 'some'))).toEqual([true, true, false]);
    expect([never, partial, full].map((x) => matchesNever(x, stores, ''))).toEqual([true, true, true]);
  });
});

describe('rotina: contagem e modos', () => {
  it('contagem regressiva com a hora do fim', () => {
    const at = new Date(2026, 10, 20, 22, 32, 0).getTime();
    expect(countdown(at, at - (8 * 60 + 22) * 1000)).toBe('00:08:22 (22:32)');
    expect(countdown(at, at - 3_725_000)).toBe('01:02:05 (22:32)');
    expect(countdown(new Date(at).toISOString(), at + 5000)).toBe('00:00:00 (22:32)'); // passou: zero
  });
  it('texto de cada modo com os minutos do servidor', () => {
    const m = { normal: 5, reduced: 5, slow: 10 };
    expect(modeHint('reduced', m)).toBe('1 termo a cada 5 min');
    expect(modeHint('slow', m)).toBe('1 termo a cada 10 min');
    expect(modeHint('normal', m)).toContain('a cada 5 min');
  });
});
