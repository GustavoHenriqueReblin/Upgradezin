import {
  matchesCategory,
  mpnFromTitle,
  normalizeBrand,
  normalizeListing,
  parseBRL,
  parseCouponConditions,
  parseCouponText,
  type Coupon,
  stripAccents,
  type CategoryId,
  type Offer,
} from '@upgradezin/shared';
import { loadPage, saveDebugHtml } from '../browser.ts';
import { config } from '../config.ts';
import { BlockedError, jitter, sleep, takePage } from '../pace.ts';
import { searchUrl, storeConfig } from '../stores.ts';
import type { StoreAdapter } from './types.ts';

/**
 * Loja S1: páginas Next.js com o catálogo em __NEXT_DATA__ (props.pageProps.data,
 * uma string JSON), lidas no Chrome da loja como as outras (loadPage).
 */

/** Máximo que a loja entrega por página (pedir mais devolve 120). */
const PAGE_SIZE = 120;

interface S1Product {
  code: number;
  name: string;
  friendlyName: string;
  sellerName: string;
  category: string;
  manufacturer?: { name?: string };
  image?: string;
  price: number;
  oldPrice?: number;
  priceWithDiscount: number;
  maxInstallment?: string;
  /** Só vale para oferta (estoque da oferta); fora dela a loja manda 0 mesmo com o produto à venda. */
  quantity: number;
  available: boolean;
  flags: { isMarketplace: boolean; isOpenbox: boolean };
  /** Oferta temporária: prazo (endsAt, segundos) e estoque próprio (quantityAvailable). */
  offer?: { price: number; priceWithDiscount: number; endsAt?: number; quantityAvailable?: number } | null;
  /** Selo da vitrine, ex. { title: 'CUPOM CODIGO' }. */
  stamps?: { title?: string } | null;
}

interface S1Catalog {
  meta: { totalItemsCount: number; totalPagesCount: number };
  data: S1Product[];
}

export function parseS1Html(html: string): S1Catalog {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('S1: __NEXT_DATA__ não encontrado');
  const next = JSON.parse(m[1]!);
  const raw = next?.props?.pageProps?.data;
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const cat = data?.catalogServer;
  if (!cat?.data) throw new Error('S1: catalogServer ausente');
  return cat;
}

export function mapS1Product(p: S1Product, collectedAt: string, category: CategoryId): Offer | null {
  const store = storeConfig('s1');
  // Caminho da categoria na loja (STORE_S1_CATEGORIES), comparado sem acento.
  const path = store.categories[category];
  if (path && !stripAccents(p.category ?? '').toLowerCase().startsWith(stripAccents(path))) return null;
  if (!matchesCategory(category, p.name)) return null;
  // Oferta só vale enquanto tem prazo e estoque; depois o preço volta ao normal.
  const o = p.offer;
  const offerOn = !!o && (o.quantityAvailable ?? 1) > 0 && (!o.endsAt || o.endsAt * 1000 > Date.parse(collectedAt));
  const cash = (offerOn && (o!.priceWithDiscount || o!.price)) || p.priceWithDiscount || p.price;
  if (!cash) return null;
  const inst = p.maxInstallment?.match(/(\d+)x\s*de\s*(R\$\s*[\d.,]+)/i);
  const brand = normalizeBrand(p.manufacturer?.name);
  const card = (offerOn && o!.price) || p.price;
  return {
    store: 's1',
    storeSku: String(p.code),
    title: p.name,
    url: `${store.url}/produto/${p.code}/${p.friendlyName}`,
    image: p.image,
    brand,
    priceCash: cash,
    priceCard: card || undefined,
    installments: inst ? { count: Number(inst[1]), value: parseBRL(inst[2]) ?? 0 } : undefined,
    listPrice: p.oldPrice && p.oldPrice > card ? p.oldPrice : undefined,
    inStock: p.available,
    // Cupom da loja não vale para produto de vendedor parceiro (conferido na página: não entra no carrinho).
    coupon: p.flags.isMarketplace ? undefined : couponFromStamp(p.stamps?.title),
    promo:
      offerOn && (o!.endsAt || o!.quantityAvailable !== undefined)
        ? { endsAt: o!.endsAt ? new Date(o!.endsAt * 1000).toISOString() : undefined, left: o!.quantityAvailable }
        : undefined,
    seller: p.sellerName,
    marketplace: p.flags.isMarketplace,
    openbox: p.flags.isOpenbox,
    // Part number no fim do título (mesma leitura da S3): identifica o produto entre as lojas.
    mpn: mpnFromTitle(p.name),
    ...normalizeListing(category, p.name, brand),
    collectedAt,
  };
}

/** Endereço da listagem com paginação, tamanho de página e ordem. */
function s1ListUrl(base: string, page: number): string {
  const url = new URL(base);
  url.searchParams.set('page_number', String(page));
  url.searchParams.set('page_size', String(PAGE_SIZE));
  url.searchParams.set('sort', 'most_searched');
  return url.toString();
}

/**
 * Uma página da listagem (busca ou categoria), lida no Chrome da loja.
 * Termos que batem com uma categoria (ex. "fonte-750w") redirecionam para a página da
 * categoria e perdem os parâmetros: abre de novo o destino com a paginação.
 * Página sem os dados do catálogo não é "0 resultados": a loja limitou o acesso.
 */
async function listPage(base: string, page: number, signal: AbortSignal): Promise<S1Catalog> {
  let url = s1ListUrl(base, page);
  for (let hop = 0; hop < 2; hop++) {
    const loaded = await loadPage('s1', url, { signal });
    const to = new URL(loaded.url);
    if (to.pathname !== new URL(url).pathname && !to.searchParams.has('page_number')) {
      url = s1ListUrl(`${to.origin}${to.pathname}`, page);
      continue;
    }
    if (!/<script id="__NEXT_DATA__"/.test(loaded.html)) {
      await saveDebugHtml('s1', loaded.html, 'no-data');
      throw new BlockedError('s1', 'unavailable', 'Página sem dados de produto');
    }
    return parseS1Html(loaded.html);
  }
  throw new Error('S1: redirecionamentos demais');
}

const productUrl = (sku: string) => `${storeConfig('s1').url}/produto/${encodeURIComponent(sku)}`;

/**
 * HTML da ficha técnica na página do produto, ou null se a página não tem. Junta as "informações
 * técnicas" (primeiro: valem na frente) com a descrição: em muitos anúncios (marcas menores,
 * vendedores parceiros, alguns gabinetes) as medidas só estão na descrição.
 */
export function s1SheetFromHtml(html: string): string | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const product = JSON.parse(m[1]!)?.props?.pageProps?.product;
  const parts = [product?.technicalInformation?.text, product?.description].filter((t): t is string => typeof t === 'string' && !!t.trim());
  return parts.length ? parts.join('<br>') : null;
}

/** "CUPOM CODIGO" -> { code: 'CODIGO' }. A porcentagem vem depois (resolveCoupons). */
function couponFromStamp(title?: string): Offer['coupon'] {
  const code = title?.match(/^\s*cupom\s+([A-Z0-9]+)/i)?.[1];
  return code ? { code: code.toUpperCase() } : undefined;
}

/** Porcentagem/valor por código de cupom, descoberta na página de um produto. Vale 1 h. */
const couponCache = new Map<string, { at: number; value: Omit<Coupon, 'code'> | null }>();

/** Página do produto: "Use o cupom CODIGO e ganhe 10% OFF neste item" -> { percent: 10 }. */
export function couponFromS1ProductHtml(html: string, code: string): Omit<Coupon, 'code'> | null {
  // O código vem do selo da própria loja ([A-Z0-9]+), seguro dentro da regex.
  // "Use o cupom CODIGO e ganhe 15% OFF neste item, corre que os cupons são limitados. *Consulte condições completas."
  const snippet = html.match(new RegExp(`cupom\\s+${code}[^"<]{0,320}`, 'i'))?.[0] ?? '';
  const value = parseCouponText(snippet);
  return value ? { ...value, ...parseCouponConditions(snippet) } : null;
}

/**
 * A busca só traz o nome do cupom. O texto com a porcentagem ("Use o cupom CODIGO e
 * ganhe 10% OFF neste item") está na página do produto: abre UMA página por cupom
 * diferente e aplica em todos os itens com aquele selo.
 */
async function resolveCoupons(offers: Offer[], signal: AbortSignal) {
  const byCode = new Map<string, Offer[]>();
  for (const o of offers) if (o.coupon?.code) byCode.set(o.coupon.code, [...(byCode.get(o.coupon.code) ?? []), o]);
  for (const [code, list] of byCode) {
    let hit = couponCache.get(code);
    if (!hit || Date.now() - hit.at > 3_600_000) {
      try {
        // Logo depois da busca, como quem abre um produto da lista: pausa curta, uma página por cupom.
        await sleep(jitter(2000, 4000), signal);
        takePage('s1');
        const { html } = await loadPage('s1', productUrl(list[0]!.storeSku), { signal });
        hit = { at: Date.now(), value: couponFromS1ProductHtml(html, code) };
        couponCache.set(code, hit);
      } catch (err) {
        if (signal.aborted) throw err;
        continue; // sem a porcentagem, o item mostra só o nome do cupom
      }
    }
    if (hit.value) for (const o of list) o.coupon = { code, ...hit.value };
  }
}

export const s1: StoreAdapter = {
  id: 's1',
  async search({ category, q, signal, maxPages, onPage }) {
    const base = searchUrl('s1', category, q);
    const offers: Offer[] = [];
    const limit = Math.min(config.MAX_PAGES_S1, maxPages ?? Infinity);
    let total = 1;
    for (let page = 1; page <= Math.min(total, limit); page++) {
      if (page > 1) await sleep(jitter(), signal);
      takePage('s1');
      const cat = await listPage(base, page, signal);
      total = cat.meta.totalPagesCount || 1;
      const now = new Date().toISOString();
      const seen = new Set(offers.map((o) => o.storeSku));
      const mapped = cat.data
        .map((p) => mapS1Product(p, now, category))
        .filter((o): o is Offer => !!o && !seen.has(o.storeSku));
      offers.push(...mapped);
      onPage?.({ page, total: Math.min(total, limit), found: offers.length, offers: mapped });
      if (mapped.length === 0) break; // relevância acabou
    }
    await resolveCoupons(offers, signal);
    return offers;
  },
  /** Ficha técnica da página do produto (product.technicalInformation.text e product.description no __NEXT_DATA__). */
  async productSheet({ sku }, signal) {
    takePage('s1');
    return s1SheetFromHtml((await loadPage('s1', productUrl(sku), { signal })).html);
  },
  /** Página da categoria (mesmo formato da busca: a busca que bate com uma categoria redireciona para ela). */
  async sweepPage({ category, url, page, signal }) {
    takePage('s1');
    const cat = await listPage(url, page, signal);
    const now = new Date().toISOString();
    const offers = cat.data.map((p) => mapS1Product(p, now, category)).filter((o): o is Offer => !!o);
    await resolveCoupons(offers, signal);
    return { offers, totalPages: cat.meta.totalPagesCount || 1 };
  },
};
