import { afterEach, describe, expect, it } from 'vitest';
import type { StoreId } from '@upgradezin/shared';
import { usePageLoader, type LoadOptions, type LoadedPage } from '../browser.ts';
import { BlockedError, SearchRedirectError } from '../pace.ts';
import { fixture } from './fixtures.ts';
import { s1 } from './s1.ts';
import { s2 } from './s2.ts';
import { s3 } from './s3.ts';

/**
 * As três lojas passam pelo mesmo caminho até a página (loadPage, o Chrome da loja com a
 * extensão). Aqui o Chrome é trocado por uma função que devolve a fixture, e cada adapter é
 * conferido do mesmo jeito: a URL que pediu, o que leu e como trata redirecionamento e bloqueio.
 */
interface Call {
  store: StoreId;
  url: string;
  opts: LoadOptions;
}
const signal = () => new AbortController().signal;

/** Troca o Chrome: `reply` decide a página de cada chamada; devolve as chamadas feitas. */
function fakeChrome(reply: (call: Call, n: number) => Partial<LoadedPage> | Error): Call[] {
  const calls: Call[] = [];
  usePageLoader(async (store, url, opts) => {
    const call = { store, url, opts };
    calls.push(call);
    const r = reply(call, calls.length);
    if (r instanceof Error) throw r;
    return { html: '', url, title: '', ...r };
  });
  return calls;
}

afterEach(() => usePageLoader(null));

describe('todas as lojas pelo mesmo caminho (loadPage)', () => {
  it('S1: busca com paginação, lê o catálogo do HTML', async () => {
    const calls = fakeChrome(() => ({ html: fixture('s1-psu.html') }));
    const offers = await s1.search({ category: 'psu', q: '750W', signal: signal() });
    expect(calls[0]).toMatchObject({ store: 's1' });
    expect(calls[0]!.url).toMatch(/^https:\/\/www\.s1\.example\/busca\/fonte-750w\?page_number=1&page_size=120&sort=most_searched$/);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.store === 's1')).toBe(true);
  });

  it('S1: busca que a loja leva para a página da categoria abre o destino de novo, com a paginação', async () => {
    const calls = fakeChrome((_c, n) => (n === 1 ? { url: 'https://www.s1.example/hardware/fontes' } : { html: fixture('s1-psu.html') }));
    await s1.search({ category: 'psu', q: 'Fonte', signal: signal() });
    expect(calls[1]!.url).toMatch(/^https:\/\/www\.s1\.example\/hardware\/fontes\?page_number=1&page_size=120/);
  });

  it('S1: página sem os dados do catálogo é bloqueio, não "0 resultados"', async () => {
    fakeChrome(() => ({ html: '<html><body>Acesso negado</body></html>' }));
    const err = await s1.search({ category: 'psu', q: '750W', signal: signal() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlockedError);
    expect((err as BlockedError).reason).toBe('unavailable');
  });

  it('S1: ficha técnica pela página do produto', async () => {
    const page = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product: { technicalInformation: { text: '<p>ficha</p>' } } } } })}</script>`;
    const calls = fakeChrome(() => ({ html: page }));
    expect(await s1.productSheet!({ sku: '123' }, signal())).toBe('<p>ficha</p>');
    expect(calls[0]!.url).toBe('https://www.s1.example/produto/123');
  });

  it('S2: ficha técnica pelo endereço do anúncio (a loja usa o nome do produto, não o código)', async () => {
    const calls = fakeChrome(() => ({ html: fixture('s2-product-gpu.html') }));
    const url = 'https://www.s2.example/placa-de-video-teste-8gb';
    expect(await s2.productSheet!({ sku: '63306', url }, signal())).toContain('228 x 123 x 50 mm');
    expect(calls[0]!.url).toBe(url);
    await expect(s2.productSheet!({ sku: '63306' }, signal())).rejects.toThrow(/endereço/);
  });

  it('S3: ficha técnica pela página /produto/<código>', async () => {
    const calls = fakeChrome(() => ({ html: fixture('s3-product-gpu.html') }));
    expect(await s3.productSheet!({ sku: '35120' }, signal())).toContain('249');
    expect(calls[0]!.url).toBe('https://www.s3.example/produto/35120');
  });

  it('S2: busca lê o payload do HTML e pede releitura se a página trocar sozinha', async () => {
    const calls = fakeChrome(() => ({ html: fixture('s2-psu.html') }));
    const offers = await s2.search({ category: 'psu', q: '750W', signal: signal() });
    expect(calls[0]!.url).toBe('https://www.s2.example/search?q=fonte%20750W');
    expect(offers.length).toBeGreaterThan(0);
    // Com produtos e no mesmo endereço, não precisa reler; sem produtos, precisa.
    const recheck = calls[0]!.opts.recheck!;
    expect(recheck({ html: fixture('s2-psu.html'), url: calls[0]!.url, title: '' })).toBe(false);
    expect(recheck({ html: '<html></html>', url: calls[0]!.url, title: '' })).toBe(true);
  });

  it('S2: busca que vai para outra página é redirecionamento (também quando a página de destino parece bloqueio)', async () => {
    fakeChrome(() => ({ url: 'https://www.s2.example/hardware/gabinete', html: '<html></html>' }));
    const a = await s2.search({ category: 'case', q: 'Gabinete', signal: signal() }).catch((e: unknown) => e);
    expect(a).toBeInstanceOf(SearchRedirectError);
    expect((a as SearchRedirectError).to).toBe('/hardware/gabinete');

    fakeChrome(() => Object.assign(new BlockedError('s2', 'unavailable', 'Página de manutenção'), { finalUrl: 'https://www.s2.example/hardware/gabinete' }));
    const b = await s2.search({ category: 'case', q: 'Gabinete', signal: signal() }).catch((e: unknown) => e);
    expect(b).toBeInstanceOf(SearchRedirectError);
  });

  it('S2: mesma página sem produtos é bloqueio', async () => {
    fakeChrome(() => ({ html: '<html><body>nada</body></html>' }));
    const err = await s2.search({ category: 'psu', q: '750W', signal: signal() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlockedError);
  });

  it('S2: até MAX_PAGES_S2 páginas por termo; com maxPages (busca do site), para antes', async () => {
    const calls = fakeChrome(() => ({ html: fixture('s2-psu.html') }));
    await s2.search({ category: 'psu', q: '750W', signal: signal() });
    // A fixture se repete: a 2ª página não traz item novo e a busca para (fim da relevância).
    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual([null, '2']);
    calls.length = 0;
    await s2.search({ category: 'psu', q: '750W', signal: signal(), maxPages: 1 });
    expect(calls).toHaveLength(1);
  });

  it('S2: página da varredura abre a categoria direto, com ?page=N a partir da 2ª', async () => {
    const calls = fakeChrome(() => ({ html: fixture('s2-psu.html') }));
    const first = await s2.sweepPage!({ category: 'psu', url: 'https://www.s2.example/hardware/fonte', page: 1, signal: signal() });
    await s2.sweepPage!({ category: 'psu', url: 'https://www.s2.example/hardware/fonte', page: 3, signal: signal() });
    expect(calls.map((c) => c.url)).toEqual(['https://www.s2.example/hardware/fonte', 'https://www.s2.example/hardware/fonte?page=3']);
    expect(first.totalPages).toBe(61);
    expect(first.offers.length).toBeGreaterThan(0);
    expect(first.offers.every((o) => o.store === 's2')).toBe(true);
  });

  it('S3: espera os cards aparecerem e lê do HTML', async () => {
    const calls = fakeChrome(() => ({ html: fixture('s3-cpu.html') }));
    const offers = await s3.search({ category: 'cpu', q: 'Ryzen 5', signal: signal() });
    expect(calls[0]!.url).toBe('https://www.s3.example/busca?str=processador+Ryzen+5');
    expect(calls[0]!.opts.waitFor).toContain('.product-item');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.store === 's3')).toBe(true);
  });
});
