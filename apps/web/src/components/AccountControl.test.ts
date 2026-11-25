import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const status = vi.hoisted(() => ({ enabled: true, user: { name: 'Ana Souza' } as { name: string } | undefined }));
vi.mock('../account.ts', async (original) => ({
  ...(await original<typeof import('../account.ts')>()),
  accountStatus: () => status,
  guestAccountStatus: () => status,
}));
const { AccountControl } = await import('./AccountControl.tsx');

describe('lado da conta no cabeçalho', () => {
  it('o que vem junto (o sino) fica depois do traço e antes da conta; sem login, aparece sozinho', () => {
    const bell = createElement('button', { 'aria-label': 'Alertas de preço' });
    const html = renderToStaticMarkup(createElement(AccountControl, { separated: true }, bell));
    expect(html).toMatch(/h-6 w-px[\s\S]*?aria-label="Alertas de preço"[\s\S]*?aria-label="Minha conta de Ana"/);
    status.enabled = false;
    expect(renderToStaticMarkup(createElement(AccountControl, { separated: true }, bell))).toBe('<button aria-label="Alertas de preço"></button>');
    expect(renderToStaticMarkup(createElement(AccountControl, { separated: true }))).toBe('');
  });

  it('Entrar mostra o nome na mesma resolução dos outros atalhos (Comparar, Montagem)', () => {
    status.enabled = true;
    status.user = undefined;
    expect(renderToStaticMarkup(createElement(AccountControl, { showLabel: true }))).toContain('<span class="hidden sm:inline">Entrar</span>');
    expect(renderToStaticMarkup(createElement(AccountControl))).toContain('<span class="hidden 2xl:inline">Entrar</span>');
  });

  it('o nome de quem entrou segue a mesma resolução', () => {
    status.enabled = true;
    status.user = { name: 'Ana Souza' };
    expect(renderToStaticMarkup(createElement(AccountControl, { showLabel: true }))).toContain('<span class="hidden sm:inline max-w-32 truncate">Ana</span>');
    expect(renderToStaticMarkup(createElement(AccountControl))).toContain('<span class="hidden 2xl:inline max-w-32 truncate">Ana</span>');
  });
});
