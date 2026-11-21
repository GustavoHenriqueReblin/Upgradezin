import { describe, expect, it } from 'vitest';
import { mergeBrands } from './components/ImportPc.tsx';

describe('marcas sugeridas na fonte do "Meu PC"', () => {
  it('junta as do banco com as comuns, na grafia da busca, sem repetir', () => {
    const list = mergeBrands(['Mancer', 'Kalkan', 'gamemax', 'BRX'], ['Corsair', 'GameMax', 'Mancer']);
    expect(list).toEqual(['BRX', 'Corsair', 'GameMax', 'Kalkan', 'Mancer']);
  });
  it('sem servidor, sobram as comuns', () => {
    expect(mergeBrands([])).toContain('Corsair');
  });
});
