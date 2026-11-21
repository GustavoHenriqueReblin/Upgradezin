import { describe, expect, it } from 'vitest';
import { parseColors, publicStores } from './stores.ts';

describe('lojas do .env', () => {
  it('cor: aceita sem # e ignora valor inválido', () => {
    const byId = Object.fromEntries(publicStores().map((s) => [s.id, s.color]));
    expect(byId).toEqual({ s1: '#ff6500', s2: undefined, s3: undefined });
  });

  it('degradê: lista de cores separadas por vírgula, até 3; uma inválida anula tudo', () => {
    expect(parseColors('#FFC300, #e30613')).toEqual(['#ffc300', '#e30613']);
    expect(parseColors('abc,def,123,456')).toEqual(['#abc', '#def', '#123']);
    expect(parseColors('#fff,red')).toEqual([]);
    expect(parseColors('')).toEqual([]);
    expect(publicStores().find((s) => s.id === 's1')?.colors).toBeUndefined();
  });
});
