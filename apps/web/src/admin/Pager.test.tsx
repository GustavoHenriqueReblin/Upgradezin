import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Pager } from './Pager.tsx';

it('mostra a faixa parcial na última página e permite voltar', () => {
  const html = renderToStaticMarkup(<Pager page={2} pageSize={50} total={51} onPage={() => {}} />);
  expect(html.replaceAll(/<!--.*?-->/g, '')).toContain('51–51 de 51');
  expect(html.replaceAll(/<!--.*?-->/g, '')).toContain('página 2 de 2');
  expect(html).toMatch(/aria-label="Página anterior" class=/);
  expect(html).toMatch(/aria-label="Próxima página" disabled=""/);
});
