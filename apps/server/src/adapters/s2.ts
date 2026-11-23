import { matchesCategory, normalizeBrand, normalizeListing, parseCouponText, type CategoryId, type Offer } from '@upgradezin/shared';
import { loadPage, saveDebugHtml, type LoadedPage, type PageError } from '../browser.ts';
import { config } from '../config.ts';
import { parseHTML } from 'linkedom';
import { BlockedError, SearchRedirectError, sleep, storeGap, takePage } from '../pace.ts';
import { searchUrl, storeConfig } from '../stores.ts';
import type { StoreAdapter } from './types.ts';

/**
 * Loja S2: Next.js App Router. Os produtos vêm no payload RSC
 * (self.__next_f, lido do HTML), num objeto {"products":{"items":[...]}}.
 * Lida no Chrome da loja como as outras (loadPage).
 */

interface S2Prices {
  avista: number;
  final_price: number;
  base_price?: number;
  max_installments?: number;
}

interface S2Item {
  id: number;
  sku: string;
  url_key: string;
  name: string;
  is_openbox: number;
  potencia?: string | null;
  marcas_info?: { name?: string } | null;
  categories?: { name?: string; url_path: string }[];
  image?: { url_listing?: string; url?: string } | null;
  stock_status?: string;
  codigo_barra?: string | null;
  /** O bloco de preços vem num campo "<prefixo da loja>_prices". */
  [key: string]: unknown;
}

/** Bloco de preços do item: o único campo terminado em "_prices" com preço à vista. */
function pricesOf(it: S2Item): S2Prices | null {
  for (const [k, v] of Object.entries(it)) {
    if (k.endsWith('_prices') && v && typeof v === 'object' && 'avista' in v) return v as S2Prices;
  }
  return null;
}

/** Extrai o objeto JSON balanceado que começa no fim de `key`. */
export function grabJson(s: string, key: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = s.indexOf(key, i)) >= 0) {
    const start = i + key.length - 1;
    let depth = 0;
    let j = start;
    let inStr = false;
    for (; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(s.slice(start, j + 1));
    i = j;
  }
  return out;
}

/** Reconstrói o payload RSC a partir do HTML (no navegador, o Next.js esvazia self.__next_f depois da hidratação). */
export function rscFromHtml(html: string): string {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1]!) as string).join('');
}

/**
 * `hasProducts`: a página traz o bloco de produtos (mesmo vazio, numa busca sem resultado).
 * Sem ele, a loja entregou só a casca da página: limitação de acesso disfarçada.
 */
export function parseS2Rsc(rsc: string): { items: S2Item[]; totalPages: number; hasProducts: boolean; redirect: string | null } {
  const blocks = grabJson(rsc, '"products":{"items":[');
  const items: S2Item[] = blocks.length ? JSON.parse(blocks[0]!) : [];
  const tp = rsc.match(/"total_pages":(\d+)/);
  return { items, totalPages: tp ? Number(tp[1]) : 1, hasProducts: blocks.length > 0, redirect: s2Redirect(rsc) };
}

/**
 * Busca que a loja manda para outra página: o payload traz a instrução de redirecionamento do
 * Next.js ("NEXT_REDIRECT;replace;/hardware/cooler-processador;307;"). Vem na resposta da própria
 * busca; o navegador às vezes segue na hora, às vezes não (no servidor, não seguiu).
 */
export function s2Redirect(rsc: string): string | null {
  const m = rsc.match(/NEXT_REDIRECT;(?:replace|push);([^;"\\]+);/);
  return m ? m[1]! : null;
}

export function mapS2Item(it: S2Item, collectedAt: string, category: CategoryId): Offer | null {
  const store = storeConfig('s2');
  // url_path da categoria na loja (STORE_S2_CATEGORIES).
  const path = store.categories[category];
  if (path && !it.categories?.some((c) => c.url_path === path)) return null;
  if (!matchesCategory(category, it.name)) return null;
  const pp = pricesOf(it);
  if (!pp?.avista) return null;
  const brand = normalizeBrand(it.marcas_info?.name);
  const { specs, modelKey } = normalizeListing(category, it.name, brand);
  // Potência estruturada da loja é mais confiável que a do título.
  const w = Number(it.potencia);
  if (category === 'psu' && w >= 150 && w <= 2500) specs.watts = w;
  const n = pp.max_installments || 0;
  return {
    store: 's2',
    storeSku: String(it.id),
    title: it.name,
    url: `${store.url}/${it.url_key}`,
    image: it.image?.url_listing || it.image?.url,
    brand,
    priceCash: pp.avista,
    priceCard: pp.final_price,
    installments: n ? { count: n, value: Math.round((pp.final_price / n) * 100) / 100 } : undefined,
    listPrice: pp.base_price && pp.base_price > pp.final_price ? pp.base_price : undefined,
    inStock: it.stock_status === 'IN_STOCK',
    coupon: couponFromCategories(it.categories),
    seller: store.name,
    marketplace: false,
    openbox: it.is_openbox === 1,
    ean: it.codigo_barra || undefined,
    mpn: it.sku,
    specs,
    modelKey,
    collectedAt,
  };
}

/**
 * A loja marca itens com cupom colocando-os numa "categoria" com o nome do
 * cupom (ex. "CODIGO10OFF"); o card mostra "CUPOM: CODIGO10OFF". A % sai do nome.
 */
function couponFromCategories(cats?: { name?: string }[]): Offer['coupon'] {
  for (const c of cats ?? []) {
    const name = c.name?.trim() ?? '';
    if (!/^[A-Z0-9]+$/.test(name)) continue;
    const value = parseCouponText(name);
    if (value) return { code: name, ...value };
  }
  return undefined;
}

/**
 * Ficha técnica da página do produto: a tabela de especificações, uma linha (<tr>) por campo, com
 * o rótulo e o valor em células separadas. Vira um parágrafo por campo com rótulo e valor juntos
 * ("Dimensões: 228 x 123 x 50 mm"), que é como o leitor da ficha (parseSpecSheet) lê; quebras
 * dentro do valor ficam ("Frente: 360 mm<br>Superior: 240 mm"). null quando a página não tem.
 */
export function s2SheetFromHtml(html: string): string | null {
  const { document } = parseHTML(html);
  const table = document.querySelector('th.name-field')?.closest('table');
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll('tr'))
    .map((tr) => {
      const label = tr.querySelector('th')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const value = tr.querySelector('td')?.innerHTML.trim() ?? '';
      // "Rótulo: valor" (com os dois-pontos, venha o rótulo com ou sem eles), como o leitor da ficha lê.
      return label || value ? `<p>${label ? `${label.replace(/\s*:?\s*$/, '')}:` : ''}${value}</p>` : '';
    })
    .filter(Boolean);
  return rows.length ? rows.join('\n') : null;
}

/** Espera antes de conferir se a página da busca foi redirecionada por script. */
const REDIRECT_WAIT_MS = 2000;

/**
 * Uma página da loja (busca ou categoria): abre no Chrome, confere redirecionamento e bloqueio
 * e lê os itens do payload. Usada pela busca e pela varredura.
 */
async function readS2Page(url: URL, signal: AbortSignal, onNeedsHuman?: () => void, keepTab = false): Promise<{ items: S2Item[]; totalPages: number; clicked: boolean }> {
  takePage('s2');
  // Termo igual ao nome de uma categoria ("Water Cooler", "Gabinete"): a loja redireciona a busca
  // para a página da categoria, que não traz a lista (para o navegador da coleta, vem a página de
  // "manutenção"). Não é bloqueio: confere o endereço final antes de ler o título como bloqueio.
  const redirectedTo = (finalUrl?: string) => {
    if (!finalUrl) return null;
    const to = new URL(finalUrl);
    return to.pathname !== url.pathname ? to.pathname : null;
  };
  let loaded: LoadedPage;
  try {
    loaded = await loadPage('s2', url.toString(), {
      signal,
      onNeedsHuman,
      keepTab,
      // O redirecionamento é feito por script da página, instantes depois de abrir: sem lista e
      // ainda no mesmo endereço, espera um pouco e lê de novo antes de chamar de bloqueio.
      recheck: (p) => !p.rsc && !redirectedTo(p.url) && !parseS2Rsc(rscFromHtml(p.html)).hasProducts,
      recheckMs: REDIRECT_WAIT_MS,
    });
  } catch (err) {
    const to = redirectedTo((err as PageError).finalUrl);
    if (to) throw new SearchRedirectError('s2', to);
    throw err;
  }
  const to = redirectedTo(loaded.url);
  if (to) throw new SearchRedirectError('s2', to);
  // Lê do HTML: depois da hidratação o Next.js esvazia self.__next_f no navegador.
  // Lida pelo clique (lista paginada): os dados vêm do pedido que o site fez, não do HTML.
  const { items, totalPages, hasProducts, redirect } = parseS2Rsc(loaded.rsc ?? rscFromHtml(loaded.html));
  if (!hasProducts && redirect) throw new SearchRedirectError('s2', redirect);
  if (items.length === 0) await saveDebugHtml('s2', loaded.rsc ?? loaded.html, 'no-items');
  // Página sem dados de produto não é "0 resultados": a loja limitou o acesso. Respeita e para.
  if (!hasProducts) {
    // Pelo clique, a página de manutenção vem na resposta (o título da aba continua o da página anterior).
    const maintenance = loaded.rsc?.match(/<title>([^<]*manuten[^<]*)<\/title>/i)?.[1];
    throw new BlockedError('s2', 'unavailable', maintenance ? `Página de manutenção: ${maintenance.trim().slice(0, 60)}` : 'Página sem dados de produto');
  }
  return { items, totalPages, clicked: !!loaded.rsc };
}

const pageUrl = (base: string, page: number) => {
  const url = new URL(base);
  if (page > 1) url.searchParams.set('page', String(page));
  return url;
};

export const s2: StoreAdapter = {
  id: 's2',
  async search({ category, q, signal, maxPages, onPage, onNeedsHuman }) {
    // Texto igual ao nome de uma categoria: a loja redireciona para a página dela (SearchRedirectError).
    // O que a página da categoria tem a rotina já lê: a busca por texto fica com o banco.
    const base = searchUrl('s2', category, q);
    const offers: Offer[] = [];
    const limit = Math.min(config.MAX_PAGES_S2, maxPages ?? Infinity);
    let total = 1;
    for (let page = 1; page <= Math.min(total, limit); page++) {
      if (page > 1) await sleep(storeGap('s2', 'list'), signal);
      const { items, totalPages } = await readS2Page(pageUrl(base, page), signal, onNeedsHuman);
      total = totalPages;
      const now = new Date().toISOString();
      const seen = new Set(offers.map((o) => o.storeSku));
      const mapped = items.map((it) => mapS2Item(it, now, category)).filter((o): o is Offer => !!o && !seen.has(o.storeSku));
      offers.push(...mapped);
      onPage?.({ page, total: Math.min(total, limit), found: offers.length, offers: mapped });
      // A busca da loja é ampla (traz PCs montados etc.). Página quase sem itens da categoria = fim da relevância.
      if (mapped.length < items.length * 0.2) break;
    }
    return offers;
  },
  /** Ficha técnica pela página do produto (o endereço guardado no anúncio: a loja usa o nome, não o código). */
  async productSheet({ url }, signal) {
    if (!url) throw new Error('S2: ficha técnica sem o endereço do produto');
    takePage('s2');
    return s2SheetFromHtml((await loadPage('s2', url, { signal })).html);
  },
  /** Página da categoria (aberta direto traz a lista, 36 itens por página, paginada com ?page=N). */
  async sweepPage({ category, url, page, signal, fresh }) {
    // Página da categoria: mesma aba entre as páginas e, da segunda em diante, pelo clique no link da
    // página (como uma pessoa), em vez de abrir cada ?page=N numa aba nova (a loja passou a barrar isso).
    // `fresh` (teste do admin): o endereço direto, numa aba nova, sem passar pelas anteriores.
    const { items, totalPages, clicked } = await readS2Page(pageUrl(url, page), signal, undefined, !fresh);
    const now = new Date().toISOString();
    return {
      offers: items.map((it) => mapS2Item(it, now, category)).filter((o): o is Offer => !!o),
      totalPages,
      inStock: items.filter((it) => it.stock_status === 'IN_STOCK').length,
      via: clicked ? 'click' : 'url',
    };
  },
};
