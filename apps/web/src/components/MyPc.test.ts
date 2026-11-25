import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCpuzReport } from '@upgradezin/shared';
import amd from '../../../../packages/shared/fixtures/cpuz/amd-am4-rx6600.txt?raw';
import { MyPcButton, pcOrigin } from './MyPc.tsx';
import { CountBadge } from './HeaderActions.tsx';

const pc = parseCpuzReport(amd)!;
const noop = () => {};

it('mostra o PC guardado no modal, com Identificar gargalo só quando a tela permite', () => {
  const full = renderToStaticMarkup(createElement(MyPcButton, { pc, onAnalyze: noop, onImport: noop }));
  expect(full).toContain('aria-label="Meu PC"');
  expect(full).toContain(pc.cpu!.title);
  expect(full).toContain('Identificar gargalo');
  expect(full).toContain('Trocar relatório');
  expect(renderToStaticMarkup(createElement(MyPcButton, { pc, onForget: noop }))).toContain('Esquecer meu PC');
  const viewer = renderToStaticMarkup(createElement(MyPcButton, { pc }));
  expect(viewer).toContain(pc.cpu!.title);
  expect(viewer).not.toContain('Identificar gargalo');
  expect(viewer).not.toContain('Trocar relatório');
  expect(viewer).not.toContain('Esquecer meu PC');
});

it('sem PC, convida a importar o relatório ou marcar as peças', () => {
  const html = renderToStaticMarkup(createElement(MyPcButton, { pc: null, onImport: noop, onManual: noop }));
  expect(html).toContain('Meu PC (não informado)');
  expect(html).toContain('Você ainda não informou seu PC');
  expect(html).toContain('Importar meu PC');
  expect(html).not.toContain('bg-emerald-500');
  expect(renderToStaticMarkup(createElement(MyPcButton, { pc: null, onForget: noop }))).not.toContain('Esquecer meu PC');
});

it('diz de onde vieram as peças do PC', () => {
  expect(pcOrigin({ ...pc, importedAt: Date.UTC(2026, 10, 25, 15) })).toBe('Importado do CPU-Z em 25/11/2026.');
  expect(pcOrigin(pc)).toBe('Importado do CPU-Z.');
  expect(pcOrigin({ source: 'manual', drives: [], monitors: [] })).toBe('Peças marcadas como Já tenho na montagem.');
});

it('a contagem dos atalhos some quando zera e limita números grandes', () => {
  expect(renderToStaticMarkup(createElement(CountBadge, { count: 0 }))).toBe('');
  expect(renderToStaticMarkup(createElement(CountBadge, { count: 3 }))).toContain('>3<');
  expect(renderToStaticMarkup(createElement(CountBadge, { count: 120 }))).toContain('99+');
});
