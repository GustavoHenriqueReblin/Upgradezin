import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const portal = vi.hoisted(() => vi.fn((node: unknown, _target: unknown) => node));
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), createPortal: portal }));

afterEach(() => {
  vi.unstubAllGlobals();
  portal.mockClear();
});

it('abre a importação direto no body, fora do cabeçalho com backdrop-blur', async () => {
  const body = {};
  vi.stubGlobal('document', { body });
  const { ImportPc } = await import('./ImportPc.tsx');
  const html = renderToStaticMarkup(createElement(ImportPc, { onClose: () => {}, onApply: () => {} }));
  expect(portal).toHaveBeenCalledTimes(1);
  expect(portal.mock.calls[0]![1]).toBe(body);
  expect(html).toContain('Importar meu PC');
});

it('sem document (servidor), renderiza no lugar', async () => {
  const { ImportPc } = await import('./ImportPc.tsx');
  const html = renderToStaticMarkup(createElement(ImportPc, { onClose: () => {}, onApply: () => {} }));
  expect(portal).not.toHaveBeenCalled();
  expect(html).toContain('role="dialog"');
});
