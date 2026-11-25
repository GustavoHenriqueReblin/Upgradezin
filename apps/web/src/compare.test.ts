import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Offer, ProductPage } from '@upgradezin/shared';
import { parseCpuzReport } from '@upgradezin/shared';
import amd from '../../../packages/shared/fixtures/cpuz/amd-am4-rx6600.txt?raw';
import { applyComparisonSelection, compareKeys, compareUrl, comparisonComputer, comparisonCpuCompatibility, comparisonMetrics, comparisonName, groupComparison, rankComparison, relativeGain } from './compare.ts';
import { searchCategoryFromUrl, withoutSearchCategory } from './uiState.ts';
import { ComparisonPage } from './components/ComparisonPage.tsx';
import { ProductPage as ProductView } from './components/ProductPage.tsx';
import { CatalogHeader } from './components/CatalogHeader.tsx';

it('usa o mesmo cabeçalho com a marca Upgradezin no produto e no comparador', () => {
  vi.stubGlobal('location', { search: '' });
  try {
    const header = (html: string) => html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
    const comparison = header(renderToStaticMarkup(createElement(ComparisonPage)));
    expect(comparison).toMatch(/href="\/"[^>]*>Upgradezin<span/);
    const product = header(renderToStaticMarkup(createElement(ProductView, { productKey: 'cpu:1' })));
    expect(product).toMatch(/href="\/"[^>]*>Upgradezin<span/);
    expect(comparison).toMatch(/Upgradezin[\s\S]*Voltar à Busca[\s\S]*Comparar Peças/);
    expect(comparison).toMatch(/<h1\b[^>]*>Comparar Peças<\/h1>/);
    expect(product).toMatch(/Upgradezin[\s\S]*Voltar à Busca[\s\S]*Comparar Peças/);
    for (const markup of [product, comparison]) expect(markup).toMatch(/<header[^>]*class="[^"]*sticky top-0/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('aponta Voltar à Busca para a categoria, inclusive nas páginas das demais peças', () => {
  for (const category of ['cpu', 'gpu', 'motherboard', 'ram', 'ssd', 'psu', 'cooler', 'case'] as const) {
    const html = renderToStaticMarkup(createElement(CatalogHeader, { category }));
    expect(html).toMatch(new RegExp(`href="/\\?categoria=${category}"[^>]*>[\\s\\S]*?Voltar à Busca`));
  }
});

it('preserva a ordem e todas as chaves únicas na URL, mesmo acima do limite anterior', () => {
  const url = new URL(compareUrl(['gpu:A B', 'gpu:A B', 'id:7', 'xyz/8', 'quarta']), 'https://app.example');
  expect(compareKeys(url.searchParams)).toEqual(['gpu:A B', 'id:7', 'xyz/8', 'quarta']);
  const keys = Array.from({ length: 30 }, (_, index) => `gpu:${index}`);
  expect(compareKeys(new URL(compareUrl(keys), url).searchParams)).toEqual(keys);
});

it('abre a categoria do atalho e incorpora mudanças de outra guia sem apagar as alternativas do link', () => {
  expect(searchCategoryFromUrl('?categoria=gpu')).toBe('gpu');
  expect(searchCategoryFromUrl('?categoria=cpu')).toBe('cpu');
  expect(searchCategoryFromUrl('?categoria=desconhecida')).toBeUndefined();
  const initial = ['gpu:link', 'cpu:1', 'gpu:3'];
  expect(applyComparisonSelection(initial, 'peca=gpu%3A3&peca=gpu%3A4', 'peca=gpu%3A4&peca=gpu%3A5')).toEqual(['gpu:link', 'cpu:1', 'gpu:5']);
});

it('limpa apenas a categoria que abriu a busca, mantendo os demais dados da URL', () => {
  expect(withoutSearchCategory({ pathname: '/', search: '?categoria=gpu', hash: '' })).toBe('/');
  expect(withoutSearchCategory({ pathname: '/', search: '?origem=produto&categoria=cpu', hash: '#busca' })).toBe('/?origem=produto#busca');
  expect(withoutSearchCategory({ pathname: '/', search: '?origem=produto', hash: '' })).toBeUndefined();
});

it('separa CPU, GPU e placa-mãe e mantém todos os produtos em cada grupo', () => {
  const part = (category: ProductPage['category'], key: string): ProductPage => ({ category, key, title: key, values: {}, offers: [] });
  const gpu = [1, 2, 3, 4].map((n) => part('gpu', `gpu:${n}`));
  const cpu = part('cpu', 'cpu:1');
  const board = part('motherboard', 'motherboard:1');
  expect([...groupComparison([gpu[0]!, cpu, board, ...gpu.slice(1)])]).toEqual([
    ['gpu', gpu], ['cpu', [cpu]], ['motherboard', [board]],
  ]);
});

it('calcula desempenho por real com o preço à vista da própria loja em estoque', () => {
  const offer = { store: 's1', inStock: true, priceCash: 2000, specs: { gpuModel: 'RX 6600' } } as Offer;
  const page: ProductPage = {
    key: 'gpu:1', category: 'gpu', title: 'RX 6600', values: {},
    offers: [{ ...offer, priceCash: 1000, marketplace: true }, { ...offer, priceCash: 1200, inStock: false }, offer],
  };
  const metric = comparisonMetrics(page);
  expect(metric.score).toBeGreaterThan(0);
  expect(metric.price).toBe(2000);
  expect(metric.value).toBe(metric.score! / 2);
  expect(comparisonMetrics({ ...page, offers: [] })).toMatchObject({ score: undefined, price: undefined, value: undefined });
  expect(relativeGain(125, 100)).toBe(25);
  expect(relativeGain(100, undefined)).toBeUndefined();
});

it('classifica por nota ponderada e deixa peças sem dados completos sem nota', () => {
  const gpu = (key: string, gpuModel: string, priceCash: number, inStock = true): ProductPage => ({
    key, category: 'gpu', title: key, values: {},
    offers: [{ store: 's1', specs: { gpuModel }, inStock, priceCash } as Offer],
  });
  const value = gpu('valor', 'RX 6600', 950);
  const fast = gpu('veloz', 'RTX 4070', 3000);
  const unavailable = gpu('esgotada', 'RTX 4090', 3000, false);
  const { ranked, topScore, topValue, lowestPrice } = rankComparison([value, unavailable, fast]);
  expect(ranked.map(({ page }) => page.key)).toEqual(['veloz', 'valor', 'esgotada']);
  expect(ranked[0]?.overall).toBeCloseTo(75 * ranked[0]!.score! / topScore + 25 * ranked[0]!.value! / topValue);
  expect(ranked[1]?.value).toBe(topValue);
  expect(ranked[2]?.overall).toBeUndefined();
  expect(lowestPrice).toBe(950);
  expect(rankComparison([fast, unavailable, value], 'price').ranked.map(({ page }) => page.key)).toEqual(['valor', 'veloz', 'esgotada']);
  expect(rankComparison([value, fast, unavailable], 'score').ranked.map(({ page }) => page.key)).toEqual(['esgotada', 'veloz', 'valor']);
  expect(rankComparison([fast, unavailable, value], 'value').ranked.map(({ page }) => page.key)).toEqual(['valor', 'veloz', 'esgotada']);
});

it('mostra família e modelo em vez do título comercial, quando identificados', () => {
  const page: ProductPage = { key: 'cpu:1', title: 'Processador AMD Ryzen 7 7800X3D AM5, Box', category: 'cpu', values: {}, offers: [] };
  expect(comparisonName(page, { cpuLine: 'Ryzen 7', cpuModel: '7800X3D' })).toBe('Ryzen 7 7800X3D');
  expect(comparisonName(page, {})).toBe(page.title);
  expect(comparisonName({ ...page, category: 'gpu' }, { gpuModel: 'RTX 3060', vram: 12 })).toBe('RTX 3060 12 GB');
});

it('mede a troca no índice do PC, mantendo a outra peça, e deixa a estimativa vazia se falta referência', () => {
  const pc = parseCpuzReport(amd)!;
  const computer = comparisonComputer(pc, '1080p', 144);
  const newGpu = (gpuModel: string) => {
    const page: ProductPage = { key: gpuModel, category: 'gpu', title: gpuModel, values: {}, offers: [] };
    return { page, ...comparisonMetrics(page), specs: { gpuModel } };
  };
  expect(computer.baseline).toBeGreaterThan(0);
  expect(computer.withPart(newGpu('RX 6600'))).toBe(computer.baseline);
  expect(computer.withPart(newGpu('RTX 4070'))).toBeGreaterThan(computer.baseline!);
  expect(computer.withPart(newGpu('Desconhecida'))).toBeUndefined();
});

it('mostra o que precisa mudar na plataforma, sem supor compatibilidade quando faltam dados', () => {
  const pc = parseCpuzReport(amd)!;
  expect(comparisonCpuCompatibility(pc, { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '7800X3D', socket: 'AM5' })).toEqual({
    status: 'Requer Mudança de Plataforma', parts: 'Placa-Mãe AM5 + DDR5',
  });
  expect(comparisonCpuCompatibility(pc, pc.cpu!.specs)).toEqual({ status: 'Compatível', parts: 'Nenhum' });
  expect(comparisonCpuCompatibility(pc, {})).toEqual({ status: 'Compatibilidade a Confirmar', parts: 'A Confirmar' });
});
