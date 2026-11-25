import { readFileSync } from 'node:fs';
import { createElement, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { BudgetView } from './components/BudgetView.tsx';
import { BuildView } from './components/BuildView.tsx';
import { PcAnalysis } from './components/PcAnalysis.tsx';
import { parseCpuzReport } from '@upgradezin/shared';
import amd from '../../../packages/shared/fixtures/cpuz/amd-am4-rx6600.txt?raw';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
}));

it('mantém as ações principais da montagem manual e da identificação de gargalo', () => {
  const noop = () => {};
  const edit = { onOpen: noop, onRemove: noop, onQty: noop, onClear: noop, onImport: noop, onOwned: noop };
  const build = renderToStaticMarkup(createElement(BuildView, { build: {}, edit }));
  expect(build).toContain('>Montar Peça por Peça</h2>');
  expect(build).toContain('aria-label="Escolher Processador"');
  expect(build).toMatch(/<button[^>]+aria-label="Escolher Processador"[^>]+class="[^"]*bg-accent-500/);
  expect(build).toContain('Importar Meu PC');
  const analysis = renderToStaticMarkup(createElement(PcAnalysis, { pc: null, onImport: noop, onUpgrade: noop, onToBuild: noop, onForget: noop }));
  expect(analysis).toContain('>Identificar Gargalo</h2>');
  expect(analysis).toContain('Relatório do CPU-Z');
  expect(analysis).toContain('Importar Meu PC');
});

it('liga o título da peça à página do catálogo quando alguma oferta tem a chave do produto', () => {
  const offer = { store: 's1', storeSku: 'cpu-1', title: 'Processador de teste', url: 'https://s1.example/produto', priceCash: 500, inStock: true,
    modelKey: 'cpu', collectedAt: '2026-11-24T12:00:00Z', seller: 'S1', marketplace: false, openbox: false, specs: {} } as const;
  const build = renderToStaticMarkup(createElement(BuildView, { build: {
    cpu: { key: 'cpu', title: offer.title, specs: {}, offers: [
      offer, { ...offer, store: 's2', priceCash: 520, productKey: 'cpu:teste' },
    ] },
    ram: { key: 'pc:ram', title: 'Memória importada', specs: {}, offers: [], current: true },
  } }));
  expect(build).toMatch(/<a href="\/produto\/cpu%3Ateste"[^>]*>Processador de teste<\/a>/);
  expect(build).toContain('title="Memória importada">Memória importada</div>');
});

it('aplica a altura compartilhada às ações, inclusive aos links com estilo de botão', () => {
  const styles = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  expect(styles).toContain('--button-height: 2.5rem');
  expect(styles).toMatch(/:is\(button,[^\n]+\.button-link\):not\(\[data-button-layout\]\)\s*\{\s*min-block-size: var\(--button-height\)/);
});

it('reserva a largura total para os contêineres principais do admin', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('./admin/Admin.tsx', import.meta.url), 'utf8');
  const main = admin.match(/<main[^>]+className="([^"]+)"/)?.[1];
  const header = admin.match(/<header[^>]*>\s*<div[^>]+className="([^"]+)"/)?.[1];
  for (const classes of [main, header]) {
    expect(classes?.split(' ')).toContain('w-full');
    expect(classes).not.toMatch(/max-w-/);
  }
  expect(app).toMatch(/<main[^>]+className="[^"]*\bmax-w-7xl\b/);
  expect(renderToStaticMarkup(createElement(BuildView, { build: {} }))).toMatch(/^<div class="[^"]*\bmax-w-4xl\b/);
});

it('mostra o orçamento em largura total e começa com as sugestões recolhidas', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(PcAnalysis, {
    pc: parseCpuzReport(amd)!, onImport: noop, onUpgrade: noop, onToBuild: noop, onForget: noop, onBudget: noop,
  }));
  expect(html).toMatch(/<button[^>]*class="[^"]*w-full[^"]*border-accent-500\/35[^"]*"[^>]*>[\s\S]*?Tem um Valor em Mente\?/);
  expect(html).toMatch(/<details class="[^"]*"><summary[^>]*>O Que Fazer/);
  expect(html).not.toContain('<h4');
  expect(html.match(/<li class="flex min-h-10 items-center gap-3 px-4 text-sm">/g)).toHaveLength(5);
  expect(html).toMatch(/<span class="text-right font-semibold text-accent-700 dark:text-accent-400">Placa de vídeo limita<\/span>/);
  expect(html.match(/class="bg-accent-500\/35"/g)).toHaveLength(1);
});

it('preenche o orçamento salvo sem enviar o pedido ao abrir a tela', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify({ text: { full: '4.500' }, ran: { full: true } }),
    setItem: vi.fn(),
  });
  const effects = vi.mocked(useEffect);
  effects.mockClear();
  try {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(BudgetView, { mode: 'full', onMode: noop, pc: null, build: {}, onImport: noop, onToBuild: noop }));
    for (const [effect] of effects.mock.calls) effect();
    expect(html).toContain('value="4.500,00"');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('exibe os dois tipos de recomendação com PC Comprável Agora como padrão', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(BudgetView, { mode: 'full', onMode: noop, pc: null, build: {}, onImport: noop, onToBuild: noop }));
  const inputs = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  const radios = inputs.filter((input) => input.includes('name="budget-price-mode"'));
  expect(radios).toHaveLength(2);
  expect(radios[0]).toContain('name="budget-price-mode"');
  expect(radios[0]).toContain('value="buyable"');
  expect(radios[0]).toContain('checked=""');
  expect(radios[1]).toContain('value="ideal"');
  expect(radios[1]).not.toContain('checked=""');
  expect(html).toMatch(/<button[^>]+aria-pressed="true"[^>]*>Full HD<\/button>/);
  expect(radios[0]).toContain('aria-describedby="budget-price-buyable-help"');
  expect(radios[1]).toContain('aria-describedby="budget-price-ideal-help"');
  const profiles = inputs.filter((input) => input.includes('name="budget-profile"'));
  expect(profiles).toHaveLength(3);
  expect(profiles[0]).toContain('value="games"');
  expect(profiles[0]).toContain('checked=""');
  expect(profiles[1]).toContain('value="mixed"');
  expect(profiles[1]).not.toContain('checked=""');
});

it('usa o mesmo estilo nos três atalhos da tela inicial', () => {
  vi.stubGlobal('location', { pathname: '/' });
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  try {
    const html = renderToStaticMarkup(createElement(App));
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);
    const classes = (label: string) => {
      const button = buttons.find((item) => item.includes(`>${label}</span>`));
      expect(button).toBeDefined();
      return [button!.match(/^<button[^>]* class="([^"]+)"/)?.[1], button!.match(/<svg[^>]* class="([^"]+)"/)?.[1]?.replace(/lucide lucide-[\w-]+ /, '')];
    };
    const budget = classes('Montar pelo Orçamento');
    expect(budget[0]).toContain('border-zinc-200');
    expect(budget[1]).toContain('text-zinc-500');
    expect(budget).toEqual(classes('Montar Peça por Peça'));
    expect(budget).toEqual(classes('Identificar Gargalo'));
  } finally {
    vi.unstubAllGlobals();
  }
});
