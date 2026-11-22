import { describe, expect, it } from 'vitest';
import { sheetEta, shortDuration, splitSeconds, sheetSummary, specPairs, countdown, modeHint, queueLabel, routineStores, mergeLines, attemptLabel, attemptResult, attemptWhat, formatDuration, formatWhen, loginError, pauseLabel, previewBackground } from './format.ts';

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
  const zero = { newListings: 0, newerListings: 0, newPricePoints: 0, newerSheets: 0 };
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

describe('rotina: contagem e modos', () => {
  it('contagem regressiva com a hora do fim', () => {
    const at = new Date(2026, 10, 20, 22, 32, 0).getTime();
    expect(countdown(at, at - (8 * 60 + 22) * 1000)).toBe('00:08:22 (22:32)');
    expect(countdown(at, at - 3_725_000)).toBe('01:02:05 (22:32)');
    expect(countdown(new Date(at).toISOString(), at + 5000)).toBe('00:00:00 (22:32)'); // passou: zero
  });
  it('fila da loja em texto', () => {
    expect(queueLabel({ priority: 0, routine: 0 })).toBe('vazia');
    expect(queueLabel({ priority: 1, routine: 0 })).toBe('1 busca do site esperando');
    expect(queueLabel({ priority: 2, routine: 3 })).toBe('2 buscas do site e 3 da rotina esperando');
    expect(queueLabel({ priority: 0, routine: 1 })).toBe('1 da rotina esperando');
  });

  it('texto de cada modo com os segundos do servidor', () => {
    const s = { normal: 15, reduced: 20, slow: 60 };
    expect(modeHint('normal', s)).toBe('rotina: 1 termo a cada 15 s');
    expect(modeHint('reduced', s)).toBe('rotina: 1 termo a cada 20 s');
    expect(modeHint('slow', s)).toBe('rotina: 1 termo a cada 1 min');
    expect(modeHint('slow', { ...s, slow: 90 })).toContain('1 min 30 s');
  });
});

describe('ficha técnica e specs na aba Produtos', () => {
  it('resumo do que a ficha trouxe', () => {
    expect(sheetSummary({ specs: { gpuLength: 228, gpu16Pin: false }, mpn: 'DUAL-RTX5060' })).toBe('placa 228 mm · sem 12V-2x6 · part number DUAL-RTX5060');
    expect(sheetSummary({ specs: { caseMaxGpu: 360, caseMaxCooler: 165, caseRadiators: [240, 360] } })).toBe('placa até 360 mm · cooler até 165 mm · radiadores 240/360 mm');
    expect(sheetSummary({ specs: {} })).toBe('sem medidas');
    expect(sheetSummary(undefined)).toBe('');
  });
  it('specs do título como campo e valor, sem os vazios', () => {
    expect(specPairs({ socket: 'AM5', igpu: true, coolerSockets: ['AM4', 'AM5'], ramModules: undefined, coolerBrands: [] })).toEqual([
      ['socket', 'AM5'],
      ['igpu', 'sim'],
      ['coolerSockets', 'AM4, AM5'],
    ]);
  });

  it('intervalo da rotina de fichas: texto curto com horas, unidade exata e quanto falta', () => {
    expect(shortDuration(45)).toBe('45 s');
    expect(shortDuration(180)).toBe('3 min');
    expect(shortDuration(3600)).toBe('1 h');
    expect(shortDuration(5400)).toBe('1 h 30 min');
    expect(shortDuration(86_400)).toBe('24 h');
    expect(splitSeconds(90)).toEqual({ value: 90, unit: 1 });
    expect(splitSeconds(180)).toEqual({ value: 3, unit: 60 });
    expect(splitSeconds(7200)).toEqual({ value: 2, unit: 3600 });
    expect(sheetEta(10, 60)).toBe('menos de 1 h');
    expect(sheetEta(100, 180)).toBe('cerca de 6 h'); // 100 × 3 min × 1,1 = 5,5 h
    expect(sheetEta(2460, 180)).toBe('cerca de 6 dias');
  });
});
