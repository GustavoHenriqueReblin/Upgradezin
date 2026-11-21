import { describe, expect, it } from 'vitest';
import { isLive, settleStatus } from './useSearch.ts';

describe('lojas ao vivo na busca', () => {
  it('na fila, consultando ou esperando verificação: a novidade do banco não passa por cima da busca', () => {
    expect(isLive({ store: 's1', state: 'queued' })).toBe(true);
    expect(isLive({ store: 's1', state: 'running', count: 3 })).toBe(true);
    expect(isLive({ store: 's2', state: 'needs-human' })).toBe(true);
  });

  it('terminada, do banco ou parada (ex. loja lenta deixada para a rotina): recebe a coleta nova na hora', () => {
    expect(isLive({ store: 's2', state: 'blocked', reason: 'hourly-limit', count: 0 })).toBe(false);
    expect(isLive({ store: 's1', state: 'done', count: 10, ms: 900 })).toBe(false);
    expect(isLive({ store: 's3', state: 'cached', count: 5 })).toBe(false);
    expect(isLive(undefined)).toBe(false);
  });

  it('busca interrompida: quem estava ao vivo vira cancelada', () => {
    expect(settleStatus({ s1: { store: 's1', state: 'running' }, s2: { store: 's2', state: 'done', count: 1, ms: 1 } })).toEqual({
      s1: { store: 's1', state: 'cancelled' },
      s2: { store: 's2', state: 'done', count: 1, ms: 1 },
    });
  });
});
