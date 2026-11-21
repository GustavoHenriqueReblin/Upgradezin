import { matchesCategory, normalizeBrand, normalizeListing, parseCouponText, type CategoryId, type Offer } from '@upgradezin/shared';
import { getTab, gotoChecked, saveDebug } from '../browser.ts';
import { config } from '../config.ts';
import { BlockedError, jitter, SearchRedirectError, sleep, takePage } from '../pace.ts';
import { searchUrl, storeConfig } from '../stores.ts';
import type { StoreAdapter } from './types.ts';

/**
 * Loja S2: Next.js App Router. Os produtos vêm no payload RSC
 * (self.__next_f, lido do HTML), num objeto {"products":{"items":[...]}}.
 * Protegida contra robôs: exige navegador real.
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

/** Espera antes de conferir se a página da busca foi redirecionada por script. */
const REDIRECT_WAIT_MS = 2000;

export const s2: StoreAdapter = {
  id: 's2',
  async search({ category, q, path, signal, onPage, onNeedsHuman }) {
    // Termo que a busca já redirecionou: abre direto o destino (a página da categoria, aberta direto,
    // traz a lista normalmente; só chegando pelo redirecionamento da busca é que vem a "manutenção").
    const base = path ? storeConfig('s2').url + path : searchUrl('s2', category, q);
    const tab = await getTab('s2');
    const offers: Offer[] = [];
    let total = 1;
    for (let page = 1; page <= Math.min(total, config.MAX_PAGES_S2); page++) {
      if (page > 1) await sleep(jitter(), signal);
      const url = new URL(base);
      if (page > 1) url.searchParams.set('page', String(page));
      takePage('s2');
      // Termo igual ao nome de uma categoria ("Water Cooler", "Gabinete"): a loja redireciona a busca
      // para a página da categoria, que não traz a lista (para o navegador da coleta, vem a página de
      // "manutenção"). Não é bloqueio: confere o endereço final antes de ler o título como bloqueio.
      const redirected = () => {
        const to = new URL(tab.url());
        return to.pathname !== url.pathname ? to.pathname : null;
      };
      try {
        await gotoChecked(tab, 's2', url.toString(), signal, onNeedsHuman);
      } catch (err) {
        const to = redirected();
        if (to) throw new SearchRedirectError('s2', to);
        throw err;
      }
      // O redirecionamento é feito por script da página, instantes depois de abrir: sem lista (ou com a
      // página trocando no meio da leitura), espera um pouco e confere o endereço antes de chamar de bloqueio.
      const redirectedLater = async () => {
        const now = redirected();
        if (now) return now;
        await sleep(REDIRECT_WAIT_MS, signal);
        return redirected();
      };
      const to = redirected();
      if (to) throw new SearchRedirectError('s2', to);
      // Lê do HTML: depois da hidratação o Next.js esvazia self.__next_f no navegador.
      let html: string;
      try {
        html = await tab.content();
      } catch (err) {
        const later = await redirectedLater();
        if (later) throw new SearchRedirectError('s2', later);
        throw err;
      }
      const { items, totalPages, hasProducts, redirect } = parseS2Rsc(rscFromHtml(html));
      if (!hasProducts && redirect) throw new SearchRedirectError('s2', redirect);
      if (!hasProducts) {
        const later = await redirectedLater();
        if (later) throw new SearchRedirectError('s2', later);
      }
      if (page === 1 && items.length === 0) await saveDebug('s2', tab, 'no-items');
      // Página sem dados de produto não é "0 resultados": a loja limitou o acesso. Respeita e para.
      if (!hasProducts) throw new BlockedError('s2', 'unavailable', 'Página sem dados de produto');
      total = totalPages;
      const now = new Date().toISOString();
      const mapped = items.map((it) => mapS2Item(it, now, category)).filter((o): o is Offer => !!o);
      offers.push(...mapped);
      onPage?.({ page, total: Math.min(total, config.MAX_PAGES_S2), found: offers.length, offers: mapped });
      // A busca da loja é ampla (traz PCs montados etc.). Página quase sem itens da categoria = fim da relevância.
      if (mapped.length < items.length * 0.2) break;
    }
    return offers;
  },
};
