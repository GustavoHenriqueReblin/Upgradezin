import { brandFromTitle, matchesCategory, mpnFromTitle, normalizeBrand, normalizeListing, parseBRL, parseCouponText, type CategoryId, type Offer } from '@upgradezin/shared';
import { parseHTML } from 'linkedom';
import { loadPage, saveDebugHtml } from '../browser.ts';
import { takePage } from '../pace.ts';
import { searchUrl, storeConfig } from '../stores.ts';
import type { StoreAdapter } from './types.ts';

/**
 * Loja S3: HTML renderizado no servidor. Na busca, até 300 resultados numa página, e cada card tem
 * atributos data-tss-* (preço PIX, marca, estoque). Na página de categoria, os cards não têm esses
 * atributos (preço, estoque e nome vêm do próprio card, a marca do título), os em estoque vêm
 * primeiro e o resto da lista chega pelo "ver mais" (JSON, ver s3MoreUrl).
 * Lida no Chrome da loja como as outras (loadPage).
 */

export interface S3Card {
  id: string;
  brand: string;
  price: string;
  stock: string;
  title: string;
  href: string;
  img: string;
  oldPrice: string;
  instCount: string;
  instValue: string;
  /** Etiqueta do card, ex. "Cupom 10% OFF" (o código fica na página de cupons da loja). */
  coupon?: string;
}

const S3_CARD_SELECTOR = '.product-item[data-tss-product]';

/** Cards da busca a partir do HTML da página (DOM do linkedom, no servidor). */
export function parseS3Cards(html: string): S3Card[] {
  const { document } = parseHTML(html);
  return readS3Cards(Array.from(document.querySelectorAll(S3_CARD_SELECTOR)) as unknown as Element[]);
}

/** Lê os dados de cada card (elementos do DOM). */
function readS3Cards(els: Element[]): S3Card[] {
  return els.map((el) => {
    const a = el.querySelector<HTMLAnchorElement>('a.product-item__name');
    const juros = el.querySelectorAll('.product-item__juros span');
    return {
      id: el.getAttribute('data-tss-product') ?? '',
      brand: el.getAttribute('data-tss-brand') ?? '',
      price: el.getAttribute('data-tss-price') ?? '',
      stock: el.getAttribute('data-tss-estoque') ?? '',
      title: a?.getAttribute('title') ?? a?.textContent?.trim() ?? '',
      href: a?.getAttribute('href') ?? '',
      img: el.querySelector('img')?.getAttribute('src') ?? '',
      oldPrice: el.querySelector('.product-item__old-price span')?.textContent?.trim() ?? '',
      instCount: juros[0]?.textContent ?? '',
      instValue: juros[1]?.textContent ?? '',
      coupon: el.querySelector('.cupomL')?.textContent?.trim() ?? '',
    };
  });
}

/**
 * Cards da página de categoria e do "ver mais" (sem data-tss-*): nome e endereço no link do nome,
 * preço PIX em ".product-item__new-price", esgotado com ".tbt_esgotado" (e sem preço), marca do título.
 */
export function parseS3ListCards(html: string): S3Card[] {
  // A página inteira, ou só os cards (o "more" do JSON).
  const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`);
  const els = Array.from(document.querySelectorAll('.product-item')) as unknown as Element[];
  return els
    .filter((el) => el.querySelector('a.product-item__name'))
    .map((el) => {
      const a = el.querySelector<HTMLAnchorElement>('a.product-item__name')!;
      const href = a.getAttribute('href') ?? '';
      const title = a.getAttribute('title') ?? a.textContent?.trim() ?? '';
      const price = parseBRL(el.querySelector('.product-item__new-price span')?.textContent);
      const soldOut = !!el.querySelector('.tbt_esgotado');
      const juros = el.querySelectorAll('.product-item__juros span');
      return {
        id: href.match(/\/produto\/(\d+)/)?.[1] ?? '',
        brand: brandFromTitle(title) ?? '',
        price: price && !soldOut ? String(price) : '',
        stock: price && !soldOut ? '1' : '0',
        title,
        href,
        img: el.querySelector('img')?.getAttribute('src') ?? '',
        oldPrice: el.querySelector('.product-item__old-price span')?.textContent?.trim() ?? '',
        instCount: juros[0]?.textContent ?? '',
        instValue: juros[1]?.textContent ?? '',
        coupon: el.querySelector('.cupomL')?.textContent?.trim() ?? '',
      };
    });
}

/**
 * Página N (2 em diante) da categoria: o mesmo pedido do botão "ver mais" da loja (app, url, more e
 * filter[marca|order|pg|str]), por GET. Responde JSON: { more: HTML dos cards, bpg: o botão da página
 * seguinte, que some na última }.
 */
export function s3MoreUrl(categoryUrl: string, page: number): string {
  const url = new URL(categoryUrl);
  const q = new URLSearchParams({ app: 'true', url: url.pathname, more: 'true', 'filter[marca]': '', 'filter[order]': '', 'filter[pg]': String(page), 'filter[str]': '' });
  return `${url.origin}${url.pathname}?${q}`;
}

/** Há página seguinte: o botão "ver mais" da loja (#pdmore) está no HTML. */
const hasMore = (html: string) => /id="pdmore"/.test(html);

/** JSON do "ver mais" aberto numa aba (o Chrome mostra o texto num <pre>). null se não é JSON. */
export function parseS3More(html: string): { more: string; bpg: string } | null {
  const { document } = parseHTML(html);
  const text = (document.querySelector('pre')?.textContent ?? document.body?.textContent ?? html).trim();
  try {
    const data = JSON.parse(text.startsWith('{') ? text : text.slice(text.indexOf('{')));
    return typeof data?.more === 'string' ? { more: data.more, bpg: typeof data.bpg === 'string' ? data.bpg : '' } : null;
  } catch {
    return null;
  }
}

export function mapS3Card(c: S3Card, collectedAt: string, category: CategoryId): Offer | null {
  const store = storeConfig('s3');
  if (!matchesCategory(category, c.title)) return null;
  const cash = Number(c.price);
  if (!cash) return null;
  const brand = normalizeBrand(c.brand);
  const count = Number(c.instCount.replace(/\D/g, ''));
  const value = parseBRL(c.instValue);
  const card = count && value ? Math.round(count * value * 100) / 100 : undefined;
  const old = parseBRL(c.oldPrice);
  return {
    store: 's3',
    storeSku: c.href.match(/\/produto\/(\d+)/)?.[1] ?? c.id,
    title: c.title,
    url: new URL(c.href, store.url).toString(),
    image: c.img || undefined,
    brand,
    priceCash: cash,
    priceCard: card,
    installments: count && value ? { count, value } : undefined,
    listPrice: old && old > cash ? old : undefined,
    inStock: c.stock === '1',
    coupon: c.coupon ? (parseCouponText(c.coupon) ?? undefined) : undefined,
    seller: store.name,
    marketplace: false,
    // A loja não tem campo próprio: "OPEN BOX" no título (ex. "... - OPEN BOX").
    openbox: /\bopen\s*-?\s*box\b/i.test(c.title),
    // Part number no fim do título ("…, Preta, SYDSCD4-3200MHZ-8GB"): sem ele, a S3 só casava pela chave de modelo.
    mpn: mpnFromTitle(c.title),
    ...normalizeListing(category, c.title, brand),
    collectedAt,
  };
}

/**
 * Ficha técnica da página do produto: o bloco "Especificações Técnicas" (#esptec). Cada campo vem
 * como "<strong>Rótulo</strong>:<br>valor": junta rótulo e valor na mesma linha ("Dimensões: 249 x
 * 132 x 41 mm"), que é como o leitor da ficha (parseSpecSheet) lê. null quando a página não tem.
 */
export function s3SheetFromHtml(html: string): string | null {
  const { document } = parseHTML(html);
  const block = document.querySelector('#esptec');
  if (!block || !block.textContent?.trim()) return null;
  const end = String.raw`(?:\s|&nbsp;|&#160;)*<\/strong>\s*(?:<b>\s*:\s*<\/b>)?\s*<br\s*\/?>`;
  return block.innerHTML
    .replace(new RegExp(`:${end}`, 'gi'), ':</strong> ') // "Rótulo:</strong><br>": os dois-pontos já estão no rótulo
    .replace(new RegExp(end, 'gi'), '</strong>: ');
}

const productUrl = (sku: string) => `${storeConfig('s3').url}/produto/${encodeURIComponent(sku)}`;

export const s3: StoreAdapter = {
  id: 's3',
  async search({ category, q, signal, onPage, onNeedsHuman }) {
    takePage('s3');
    const { html } = await loadPage('s3', searchUrl('s3', category, q), { signal, onNeedsHuman, waitFor: '.product-item, .tss-filter-results-count' });
    const cards = parseS3Cards(html);
    const now = new Date().toISOString();
    const offers = cards.map((c) => mapS3Card(c, now, category)).filter((o): o is Offer => !!o);
    onPage?.({ page: 1, total: 1, found: offers.length, offers });
    return offers;
  },
  /**
   * Página da categoria: a 1ª é a própria página (~150 cards); as seguintes, o "ver mais" (JSON).
   * Os em estoque vêm primeiro.
   */
  async sweepPage({ category, url, page, signal }) {
    takePage('s3');
    let cardsHtml: string;
    let more: boolean;
    if (page === 1) {
      const { html } = await loadPage('s3', url, { signal, waitFor: '.product-item' });
      cardsHtml = html;
      more = hasMore(html);
    } else {
      const { html } = await loadPage('s3', s3MoreUrl(url, page), { signal });
      const data = parseS3More(html);
      if (!data) {
        await saveDebugHtml('s3', html, `ver-mais-${category}-${page}`);
        throw new Error('S3: o "ver mais" da categoria não respondeu JSON');
      }
      cardsHtml = data.more;
      more = hasMore(data.bpg);
    }
    const cards = parseS3ListCards(cardsHtml);
    const now = new Date().toISOString();
    return {
      offers: cards.map((c) => mapS3Card(c, now, category)).filter((o): o is Offer => !!o),
      totalPages: more ? page + 1 : page,
      inStock: cards.filter((c) => c.stock === '1').length,
    };
  },
  /** Ficha técnica pela página do produto (/produto/<código>: a loja completa o endereço). */
  async productSheet({ sku }, signal) {
    takePage('s3');
    return s3SheetFromHtml((await loadPage('s3', productUrl(sku), { signal })).html);
  },
};
