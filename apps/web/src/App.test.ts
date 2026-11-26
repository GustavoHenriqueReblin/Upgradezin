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

it('padroniza as ações de informar o PC no orçamento e no diagnóstico', () => {
  const noop = () => {};
  const analysis = renderToStaticMarkup(createElement(PcAnalysis, { pc: null, onImport: noop, onUpgrade: noop, onToBuild: noop, onForget: noop }));
  const budget = renderToStaticMarkup(createElement(BudgetView, { mode: 'upgrade', pc: null, build: {}, onImport: noop, onManual: noop, onMode: noop, onToBuild: noop }));
  const actions = (html: string) => [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?(?:Importar meu PC|Informar peças manualmente)<\/button>/g)].map(([button]) => button);
  expect(actions(analysis)).toHaveLength(2);
  expect(actions(budget)).toEqual(actions(analysis));
});

it('mantém as ações principais da montagem manual e da identificação de gargalo', () => {
  const noop = () => {};
  const edit = { onOpen: noop, onRemove: noop, onQty: noop, onClear: noop, onOwned: noop };
  const build = renderToStaticMarkup(createElement(BuildView, { build: {}, edit }));
  expect(build).toContain('>Montar peça por peça</h2>');
  expect(build).toContain('aria-label="Escolher Processador"');
  expect(build).toMatch(/<button[^>]+aria-label="Escolher Processador"[^>]+class="[^"]*accent-control/);
  // A montagem é manual: o CPU-Z não monta nada.
  expect(build).not.toContain('Importar meu PC');
  const analysis = renderToStaticMarkup(createElement(PcAnalysis, { pc: null, onImport: noop, onUpgrade: noop, onToBuild: noop, onForget: noop }));
  expect(analysis).toContain('>Identificar gargalo</h2>');
  expect(analysis).toContain('Relatório automático');
  expect(analysis).toContain('Importar meu PC');
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
  expect(html).toMatch(/<button[^>]*class="[^"]*w-full[^"]*border-accent-500\/35[^"]*"[^>]*>[\s\S]*?Tem um valor em mente\?/);
  expect(html).toMatch(/<details class="[^"]*"><summary[^>]*>O que fazer/);
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

it('exibe os dois tipos de recomendação com PC comprável agora como padrão', () => {
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

it('mostra o aviso de direitos no rodapé da tela inicial', () => {
  vi.stubGlobal('location', { pathname: '/', search: '' });
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  try {
    expect(renderToStaticMarkup(createElement(App))).toMatch(/<footer\b[^>]*>© 2026 Upgradezin/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('usa o mesmo estilo nos três atalhos da tela inicial', () => {
  vi.stubGlobal('location', { pathname: '/' });
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  try {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('>Comparar</span>');
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);
    const classes = (label: string) => {
      const button = buttons.find((item) => item.includes(`>${label}</span>`));
      expect(button).toBeDefined();
      return [button!.match(/^<button[^>]* class="([^"]+)"/)?.[1], button!.match(/<svg[^>]* class="([^"]+)"/)?.[1]?.replace(/lucide lucide-[\w-]+ /, '')];
    };
    const budget = classes('Montar pelo orçamento');
    expect(budget[0]).toContain('border-zinc-200');
    expect(budget[1]).toContain('text-zinc-500');
    expect(budget).toEqual(classes('Montar peça por peça'));
    expect(budget).toEqual(classes('Identificar gargalo'));
  } finally {
    vi.unstubAllGlobals();
  }
});

it('resume o processador no atalho de gargalo quando a peça marcada tem um título de anúncio longo', () => {
  const title = 'Processador AMD Ryzen 7 5700, 3.7 GHz, Cache 20 MB, 8 Núcleos, AM4';
  vi.stubGlobal('location', { pathname: '/', search: '' });
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'upgradezin.build.v1' ? JSON.stringify({
      cpu: { key: 'cpu:5700', title, specs: { cpuLine: 'Ryzen 7', cpuModel: '5700' }, offers: [], current: true },
    }) : null,
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toMatch(/class="hidden max-w-\[28%\][^"]*truncate[^"]*" title="[^"]+">Ryzen 7 5700<\/span>/);
    // O título completo só aparece no modal Meu PC; o card de gargalo fica com o nome curto.
    const card = html.match(/<button[^>]*data-button-layout="card"[^>]*>(?:(?!<\/button>)[\s\S])*Identificar gargalo[\s\S]*?<\/button>/)?.[0];
    expect(card).toContain('>Ryzen 7 5700</span>');
    expect(card).not.toContain(`>${title}<`);
    expect(html).toContain(`>${title}<`);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('abre direto a tela pedida pela URL', () => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  const at = (pathname: string, search = '') => {
    vi.stubGlobal('location', { pathname, search });
    return renderToStaticMarkup(createElement(App));
  };
  try {
    expect(at('/montagem')).toContain('>Montar peça por peça</h2>');
    expect(at('/gargalo')).toContain('>Identificar gargalo</h2>');
    const budget = at('/orcamento', '?modo=upgrade');
    expect(budget).toContain('>Montar pelo orçamento</h2>');
    expect(budget).toMatch(/aria-selected="true"[^>]*>Upgrade do meu PC</);
    expect(at('/orcamento')).toMatch(/aria-selected="true"[^>]*>PC completo</);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('usa o visual do app no orçamento do PC completo', () => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'upgradezin.budget.v1' ? JSON.stringify({ profile: 'productivity' }) : null, setItem: vi.fn() });
  try {
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(BudgetView, { mode: 'full', onMode: noop, pc: null, build: {}, onImport: noop, onToBuild: noop }));
    // Seleção em laranja, os três perfis numa linha e a pergunta certa para quem não joga.
    expect(html).toMatch(/<button[^>]+aria-pressed="true"[^>]+class="[^"]*accent-control[^"]*"[^>]*>Full HD<\/button>/);
    expect(html).toContain('has-checked:border-accent-500');
    expect(html).toContain('grid gap-2 sm:grid-cols-3');
    expect(html).toContain('Qual a resolução do monitor?');
    expect(html).not.toContain('Em que tela vai jogar?');
    // Mesmo desenho do upgrade: sem painel lateral, abas sublinhadas.
    expect(html).not.toContain('md:grid-cols-[minmax(0,1fr)');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*class="[^"]*border-accent-500/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('alinha as categorias do cabeçalho logo depois do logo, sem centralizar', () => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  vi.stubGlobal('location', { pathname: '/montagem', search: '' });
  try {
    const header = renderToStaticMarkup(createElement(App)).match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header).toMatch(/<div class="flex min-w-0 justify-start"><nav\b/);
    expect(header).not.toMatch(/justify-center"><nav\b/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('mostra os mesmos atalhos em todo cabeçalho, e a montagem aberta sem nome em tela menor', () => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  const at = (pathname: string) => {
    vi.stubGlobal('location', { pathname, search: '' });
    return renderToStaticMarkup(createElement(App));
  };
  try {
    for (const html of [at('/'), at('/montagem')]) {
      expect(html).toContain('aria-label="Meu PC (não informado)"');
      expect(html).toContain('aria-label="Comparar peças"');
      expect(html).toMatch(/aria-label="Montagem"/);
    }
    // Aberta: em laranja, e o nome só nas telas bem largas, como nos outros atalhos.
    expect(at('/montagem')).toMatch(/aria-label="Montagem"[^>]*aria-pressed="true"[^>]*accent-control[\s\S]*?<span class="hidden 2xl:inline">Montagem<\/span>/);
  } finally {
    vi.unstubAllGlobals();
  }
});
