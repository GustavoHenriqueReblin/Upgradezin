import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Offer, ProductGroup } from '@upgradezin/shared';

vi.mock('../account.ts', async (original) => {
  const status = { enabled: true, user: null };
  return { ...(await original<typeof import('../account.ts')>()), accountStatus: () => status, guestAccountStatus: () => status };
});
afterEach(() => vi.unstubAllGlobals());

const best = { store: 's1', storeSku: '1', title: 'Placa RTX 5060', url: 'https://s1.example/1', priceCash: 2000, inStock: true, specs: {}, collectedAt: new Date().toISOString(), productKey: 'gpu:1' } as unknown as Offer;
const group: ProductGroup = { key: 'g1', title: 'Placa RTX 5060', specs: {}, offers: [best], best };

describe('ações do card', () => {
  it('três botões só com ícone, do mesmo tamanho, com o nome na dica', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const { ProductCard } = await import('./ProductCard.tsx');
    const html = renderToStaticMarkup(createElement(ProductCard, { group, compareCategory: 'gpu', onPick: () => {} }));
    const actions = html.match(/<div class="[^"]*\[&amp;&gt;\*\]:flex-1[^"]*">([\s\S]*)<\/div><\/article>/)?.[1] ?? '';
    expect(actions.match(/<button/g)).toHaveLength(3);
    expect(actions).toMatch(/aria-label="Adicionar à montagem" title="Adicionar à montagem"/);
    expect(actions).toContain('aria-label="Acompanhar preço"');
    expect(actions).toContain('aria-label="Comparar"');
    expect(actions).not.toMatch(/<\/svg>\s*[A-Za-zÀ-ú]/); // nenhum texto depois do ícone
    expect(renderToStaticMarkup(createElement(ProductCard, { group, compareCategory: 'gpu', onPick: () => {}, replacing: true }))).toContain('aria-label="Trocar na montagem"');
    expect(renderToStaticMarkup(createElement(ProductCard, { group, compareCategory: 'gpu', onPick: () => {}, picked: true }))).toContain('aria-label="Na montagem"');
  });
});
