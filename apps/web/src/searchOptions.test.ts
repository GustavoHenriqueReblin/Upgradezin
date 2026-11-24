import { describe, expect, it } from 'vitest';
import { countOf, numbersOf } from './searchOptions.ts';

describe('opções do formulário com a contagem', () => {
  const c = { watts: { 650: 10, 750: 20, 1600: 4, 735: 1 }, capacity: { 'ddr5:32': 5, 'ddr5:24': 3, 'ddr4:16': 9 } };
  it('sem contagem (carregando ou falhou): a lista fixa', () => {
    expect(numbersOf(null, 'watts', [650, 750, 850], [])).toEqual([650, 750, 850]);
    expect(countOf(null, 'watts', 650)).toBeUndefined();
  });
  it('com contagem: some o que não tem produto, entra valor novo com uns produtos (não o avulso), fica o escolhido', () => {
    expect(numbersOf(c, 'watts', [650, 750, 850], [])).toEqual([650, 750, 1600]);
    expect(numbersOf(c, 'watts', [650, 750, 850], [850])).toEqual([650, 750, 850, 1600]);
    expect(countOf(c, 'watts', 850)).toBe(0);
    // Por tipo de memória.
    expect(numbersOf(c, 'capacity', [16, 32], [], 'ddr5:')).toEqual([24, 32]);
  });
});
