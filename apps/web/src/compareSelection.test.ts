import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let values: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it('guarda a seleção numa lista só, com limite por categoria', async () => {
  const { COMPARE_LIMIT, compareSelection, removeCompare, toggleCompare, clearCompare } = await import('./compareSelection.ts');
  for (let i = 0; i < COMPARE_LIMIT; i++) expect(toggleCompare('gpu', `gpu:${i}`)).toBe(true);
  expect(toggleCompare('gpu', 'gpu:extra')).toBe(false);
  expect(toggleCompare('cpu', 'cpu:1')).toBe(true);
  expect(compareSelection()).toHaveLength(COMPARE_LIMIT + 1);
  expect(JSON.parse(values.get('upgradezin.compare.v1')!)).toContainEqual({ key: 'cpu:1', category: 'cpu' });
  toggleCompare('gpu', 'gpu:0');
  removeCompare('cpu:1');
  expect(compareSelection().map((entry) => entry.key)).toEqual(['gpu:1', 'gpu:2', 'gpu:3', 'gpu:4']);
  toggleCompare('cpu', 'cpu:9');
  clearCompare('gpu');
  expect(compareSelection()).toEqual([{ key: 'cpu:9', category: 'cpu' }]);
  clearCompare();
  expect(compareSelection()).toEqual([]);
  expect(values.has('upgradezin.compare.v1')).toBe(false);
});

it('converte a seleção antiga por categoria e apaga as chaves antigas', async () => {
  values.set('upgradezin.compare.gpu', 'peca=gpu%3AA&peca=gpu%3AB');
  values.set('upgradezin.compare.cpu', 'peca=cpu%3A1');
  const { compareSelection } = await import('./compareSelection.ts');
  expect(compareSelection()).toEqual([
    { key: 'cpu:1', category: 'cpu' }, { key: 'gpu:A', category: 'gpu' }, { key: 'gpu:B', category: 'gpu' },
  ]);
  expect(values.has('upgradezin.compare.gpu')).toBe(false);
  expect(values.has('upgradezin.compare.cpu')).toBe(false);
});

it('junta um link compartilhado sem repetir peças e conta o que passou do limite', async () => {
  const { addToCompare, COMPARE_LIMIT, compareSelection, toggleCompare } = await import('./compareSelection.ts');
  toggleCompare('gpu', 'gpu:0');
  const shared = Array.from({ length: COMPARE_LIMIT + 1 }, (_, i) => ({ key: `gpu:${i}`, category: 'gpu' as const }));
  expect(addToCompare(shared)).toBe(1);
  expect(compareSelection()).toHaveLength(COMPARE_LIMIT);
});

it('ignora dado corrompido ou editado à mão', async () => {
  values.set('upgradezin.compare.v1', JSON.stringify([{ key: 'gpu:1', category: 'gpu' }, { key: 'x', category: 'nada' }, { key: 'gpu:1', category: 'gpu' }, 5]));
  const { compareSelection } = await import('./compareSelection.ts');
  expect(compareSelection()).toEqual([{ key: 'gpu:1', category: 'gpu' }]);
});
