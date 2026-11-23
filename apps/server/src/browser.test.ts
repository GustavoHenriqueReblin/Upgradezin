import { afterEach, describe, expect, it } from 'vitest';
import { chromeArgs, chromeEnv, type OpenedTab, type Tab } from './browser-ext.ts';
import { closeBrowser, loadPage, useTabOpener, windowArgs } from './browser.ts';

/**
 * Aba falsa: `links` diz quais links a página aberta tem; `rscOf` o que o site devolveria ao clicar
 * (null: não respondeu a tempo). Guarda como cada página foi aberta (goto = endereço; click = clique).
 */
function fakeTabs(o: { links?: (from: string) => string[]; rscOf?: (href: string) => string | null; title?: (url: string) => string } = {}) {
  const log: string[] = [];
  let opened = 0;
  let closed = 0;
  useTabOpener(async () => {
    const n = ++opened;
    let url = '';
    const tab: Tab = {
      goto: async (u) => {
        log.push(`aba${n} goto ${u}`);
        url = u;
      },
      clickPage: async (href) => {
        const here = new URL(url);
        const has = (o.links ?? (() => [`${here.pathname}?page=${Number(here.searchParams.get('page') ?? 1) + 1}`]))(url).includes(href);
        if (!has) return { clicked: false, rsc: null };
        log.push(`aba${n} click ${href}`);
        url = here.origin + href;
        return { clicked: true, rsc: o.rscOf ? o.rscOf(href) : `dados de ${href}`, via: 'click' };
      },
      title: async () => o.title?.(url) ?? 'Lista',
      currentUrl: async () => url,
      content: async () => '<html>ok</html>',
      waitForSelector: async () => true,
      bringToFront: async () => {},
      screenshot: async () => true,
    };
    return { tab, sameWindow: true, tabsInWindow: 2, close: async () => (closed++, 1) } satisfies OpenedTab;
  });
  return { log, counts: () => ({ opened, closed }) };
}

afterEach(async () => {
  await closeBrowser();
  useTabOpener(null);
});

const BASE = 'https://www.s2.example/hardware';

describe('aba mantida nas páginas de uma lista (keepTab)', () => {
  it('a primeira página abre o endereço; a próxima da mesma lista é pelo clique no link (dados do pedido do site); outra categoria abre o endereço', async () => {
    const t = fakeTabs();
    expect((await loadPage('s2', `${BASE}/fonte`, { keepTab: true })).rsc).toBeUndefined();
    const p2 = await loadPage('s2', `${BASE}/fonte?page=2`, { keepTab: true });
    expect(p2).toMatchObject({ rsc: 'dados de /hardware/fonte?page=2', url: `${BASE}/fonte?page=2`, html: '' });
    await loadPage('s2', `${BASE}/fonte?page=3`, { keepTab: true });
    await loadPage('s2', `${BASE}/processadores`, { keepTab: true });
    expect(t.log).toEqual([`aba1 goto ${BASE}/fonte`, 'aba1 click /hardware/fonte?page=2', 'aba1 click /hardware/fonte?page=3', `aba1 goto ${BASE}/processadores`]);
    expect(t.counts()).toEqual({ opened: 1, closed: 0 });
    // Sem keepTab (ficha, busca): aba nova, fechada na hora; a da lista continua.
    await loadPage('s2', 'https://www.s2.example/produto/1');
    expect(t.log.at(-1)).toBe('aba2 goto https://www.s2.example/produto/1');
    expect(t.counts()).toEqual({ opened: 2, closed: 1 });
  });

  it('sem o link na página (pulou páginas) ou sem resposta do clique a tempo: abre o endereço', async () => {
    const t = fakeTabs({ rscOf: (href) => (href.endsWith('page=2') ? null : `dados de ${href}`) });
    await loadPage('s2', `${BASE}/fonte`, { keepTab: true });
    await loadPage('s2', `${BASE}/fonte?page=5`, { keepTab: true }); // a página 1 não tem o link da 5
    expect(t.log.at(-1)).toBe(`aba1 goto ${BASE}/fonte?page=5`);
    await loadPage('s2', `${BASE}/fonte`, { keepTab: true });
    const p2 = await loadPage('s2', `${BASE}/fonte?page=2`, { keepTab: true });
    expect(t.log.slice(-2)).toEqual(['aba1 click /hardware/fonte?page=2', `aba1 goto ${BASE}/fonte?page=2`]);
    expect(p2.rsc).toBeUndefined();
  });

  it('página de manutenção (no clique ou abrindo): bloqueio, e a aba mantida fecha; a próxima recomeça abrindo o endereço', async () => {
    const t = fakeTabs({ title: (url) => (url.includes('page=2') ? 'Site em Manutenção' : 'Lista') });
    await loadPage('s2', `${BASE}/fonte`, { keepTab: true });
    await expect(loadPage('s2', `${BASE}/fonte?page=2`, { keepTab: true })).rejects.toThrow(/manuten/i);
    expect(t.counts()).toEqual({ opened: 1, closed: 1 });
    await loadPage('s2', `${BASE}/fonte?page=3`, { keepTab: true });
    expect(t.log.at(-1)).toBe(`aba2 goto ${BASE}/fonte?page=3`);
  });
});

describe('Chrome da loja: como o site enxerga o navegador', () => {
  it('em português: idioma da interface, idioma enviado aos sites e o do sistema (o Chrome no Linux ignora --lang)', () => {
    const args = chromeArgs([]);
    expect(args).toContain('--lang=pt-BR');
    expect(args).toContain('--accept-lang=pt-BR,pt,en-US,en');
    const env = chromeEnv({ PATH: '/bin', LANG: 'C.UTF-8' });
    expect(env).toMatchObject({ PATH: '/bin', LANG: 'pt_BR.UTF-8' });
    expect(env.LANGUAGE?.startsWith('pt_BR')).toBe(true);
  });

  it('janela escondida: fora da tela só no Windows; no Linux (tela virtual), no canto da tela', () => {
    expect(windowArgs('s2', true, 'win32')).toContain('--window-position=-32000,-32000');
    const linux = windowArgs('s2', true, 'linux');
    expect(linux).toContain('--window-position=0,0');
    expect(linux.some((a) => a.includes('-32000'))).toBe(false);
    expect(linux).toContain('--disable-backgrounding-occluded-windows');
    // Visível: uma loja ao lado da outra, em qualquer sistema.
    expect(windowArgs('s3', false, 'linux')).toContain('--window-position=900,0');
  });
});
