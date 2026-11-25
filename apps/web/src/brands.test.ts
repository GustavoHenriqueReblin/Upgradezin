import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImportPc, mergeBrands } from './components/ImportPc.tsx';

describe('marcas sugeridas na fonte do "Meu PC"', () => {
  it('junta as do banco com as comuns, na grafia da busca, sem repetir', () => {
    const list = mergeBrands(['Mancer', 'Kalkan', 'gamemax', 'BRX'], ['Corsair', 'GameMax', 'Mancer']);
    expect(list).toEqual(['BRX', 'Corsair', 'GameMax', 'Kalkan', 'Mancer']);
  });
  it('sem servidor, sobram as comuns', () => {
    expect(mergeBrands([])).toContain('Corsair');
  });
  it('usa o select compacto e mantém a edição de marcas fora da lista', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(ImportPc, {
      onClose: noop, onApply: noop,
      initial: { source: 'cpu-z', drives: [], monitors: [], psu: { title: 'Fonte', brand: 'Marca Local', specs: { watts: 550 } } },
    }));
    expect(html).toMatch(/<select[^>]+compact-picker[^>]*>[\s\S]*?<option value=":outra" selected="">Outra marca<\/option>/);
    expect(html).toMatch(/Nome da marca<input[^>]+value="Marca Local"/);
  });
});
