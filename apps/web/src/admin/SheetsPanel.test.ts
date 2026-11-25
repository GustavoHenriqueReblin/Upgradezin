import { expect, it } from 'vitest';
import { sheetPct } from './SheetsPanel.tsx';

it('andamento das fichas: arredonda para baixo e só chega a 100% com a fila vazia', () => {
  expect(sheetPct(9_996, 4)).toBe(99); // antes arredondava para 100% com 4 na fila
  expect(sheetPct(1, 1_000_000)).toBe(0);
  expect(sheetPct(2, 1)).toBe(66);
  expect(sheetPct(500, 0)).toBe(100);
  expect(sheetPct(0, 0)).toBe(0);
});
