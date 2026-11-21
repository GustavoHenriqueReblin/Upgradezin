import { matchesCategory, mpnFromTitle, normalizeBrand, normalizeListing, parseBRL, parseCouponText, type CategoryId, type Offer } from '@upgradezin/shared';
import { getTab, gotoChecked } from '../browser.ts';
import { takePage } from '../pace.ts';
import { searchUrl, storeConfig } from '../stores.ts';
import type { StoreAdapter } from './types.ts';

/**
 * Loja S3: HTML renderizado no servidor, até 300 resultados numa página.
 * Cada card tem atributos data-tss-* (preço PIX, marca, estoque).
 * Protegida contra robôs: exige navegador real.
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

export const S3_CARD_SELECTOR = '.product-item[data-tss-product]';

/**
 * Lê os cards da busca. Roda DENTRO da página (Playwright serializa a função),
 * então não pode usar nada de fora dela. Sem funções nomeadas aqui dentro: o
 * esbuild (tsx) as envolveria em __name(). Exportada para testes com DOM em Node.
 */
export function readS3Cards(els: Element[]): S3Card[] {
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

export const s3: StoreAdapter = {
  id: 's3',
  async search({ category, q, signal, onPage, onNeedsHuman }) {
    takePage('s3');
    const tab = await getTab('s3');
    await gotoChecked(tab, 's3', searchUrl('s3', category, q), signal, onNeedsHuman);
    await tab.waitForSelector('.product-item, .tss-filter-results-count', { timeout: 15_000 }).catch(() => {});
    const cards = await tab.$$eval(S3_CARD_SELECTOR, readS3Cards);
    const now = new Date().toISOString();
    const offers = cards.map((c) => mapS3Card(c, now, category)).filter((o): o is Offer => !!o);
    onPage?.({ page: 1, total: 1, found: offers.length, offers });
    return offers;
  },
};
