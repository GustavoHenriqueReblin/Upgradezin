import { effectiveCash, type Offer } from './types.ts';
import { identifyProducts } from './identity.ts';
import { isWhite, stripAccents } from './normalize.ts';

/** Cor sai do nome e volta como sufixo fixo (" white"), seja qual for a grafia e a posição. */
const NOISE = /\b(fonte|de|alimentacao|gamer|atx|sfx|pc|para|computador|serie|series|linha|branca|branco|white|snow|preta|preto|black)\b/g;

/**
 * Chave de modelo derivada do título: marca + palavras até a potência.
 *   "Fonte XPG Kyber, 750W, 80 Plus Gold"        -> "xpg kyber 750"
 *   "Fonte Montech Century II 750W, 80 Plus Gold" -> "montech century ii 750"
 * Variante branca ganha sufixo para não misturar com a preta.
 */
export function modelKeyFromTitle(title: string, brand?: string): string {
  const t = stripAccents(title).toLowerCase();
  const w = t.match(/(\d{3,4})\s*w(?:atts?)?\b/);
  let head = w ? t.slice(0, w.index) : t.split(',')[0]!;
  head = head.replace(/[^a-z0-9 ]+/g, ' ').replace(NOISE, ' ');
  const tokens = head.split(/\s+/).filter(Boolean);
  const b = brand ? stripAccents(brand).toLowerCase().replace(/[^a-z0-9 ]+/g, '') : '';
  if (b && !tokens.join(' ').includes(b)) tokens.unshift(b);
  const watts = w ? w[1] : '';
  const white = isWhite(title) ? ' white' : '';
  return `${tokens.join(' ')} ${watts}${white}`.trim();
}

/** Part number comparável: só letras e dígitos, maiúsculo; curto ou sem dígito não serve. */
export function normalizeMpn(mpn?: string): string | undefined {
  const m = mpn?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return m && m.length >= 6 && /\d/.test(m) && /[A-Z]/.test(m) ? m : undefined;
}

/** Pedaço do fim do título que é spec, não código: "3200MHz", "650W", "120mm", cor, padrão. */
const SPEC_TOKEN =
  /^(\d+(?:[.,]\d+)?[a-z/"]{1,5}|ddr\d|gddr\d+x?|pcie|nvme|sata|m\.2|argb|rgb|e-?atx|m-?atx|mini-?itx|atx|itx|preto|preta|branco|branca|white|black|rosa|pink)$/i;

/**
 * Part number do fabricante no fim do título: "… - 90-GA41ZZ-00UANF" (S1) ou
 * "…, Preta, SYDSCD4-3200MHZ-8GB" (S3). Só o último pedaço, se for uma palavra com letra e
 * dígito que não seja spec ("3200MHz", "8GB"); " - Open Box" no fim é ignorado.
 */
export function mpnFromTitle(title: string): string | undefined {
  const t = title.replace(/\s*[-–]\s*open\s*-?\s*box\s*$/i, '').trim();
  const last = t.match(/(?:\s[-–]\s*|,\s*)([A-Z0-9][A-Z0-9./_-]{4,})\s*$/i)?.[1];
  if (!last || SPEC_TOKEN.test(last)) return undefined;
  return normalizeMpn(last) ? last.toUpperCase() : undefined;
}

export interface ProductGroup {
  key: string;
  title: string;
  brand?: string;
  image?: string;
  specs: Offer['specs'];
  offers: Offer[];
  best: Offer;
}

/**
 * Agrupa ofertas de lojas diferentes que são o mesmo produto (identity.ts, nível grupo): mesmo part
 * number (também achado no título ou no endereço de outra loja), EAN, chave do título ou assinatura
 * de placa de vídeo. A chave do grupo é a menor chave de modelo dele (repetida em outro grupo: + o produto).
 */
export function groupOffers(offers: Offer[]): ProductGroup[] {
  // Posição na lista: duas ofertas iguais de loja e código continuam sendo duas.
  const { group } = identifyProducts(
    offers.map((o, i) => ({ id: String(i), store: o.store, title: o.title, url: o.url, mpn: o.mpn, ean: o.ean, brand: o.brand, modelKey: o.modelKey, specs: o.specs ?? {} })),
  );
  const byProduct = new Map<string, Offer[]>();
  for (const [i, o] of offers.entries()) {
    const key = group.get(String(i))!;
    const list = byProduct.get(key);
    if (list) list.push(o);
    else byProduct.set(key, [o]);
  }
  // Chave do grupo para a tela: a menor chave de modelo dele (como antes); repetida, ganha o produto no fim.
  const groups = new Map<string, Offer[]>();
  for (const [product, list] of byProduct) {
    const label = list.map((o) => o.modelKey).sort()[0]!;
    groups.set(groups.has(label) ? `${label}|${product}` : label, list);
  }

  return [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => Number(b.inStock) - Number(a.inStock) || effectiveCash(a) - effectiveCash(b));
    // Uma oferta por loja: a melhor dela (anúncios repetidos ou variantes do mesmo modelo).
    const seenStores = new Set<string>();
    const perStore = sorted.filter((o) => !seenStores.has(o.store) && seenStores.add(o.store));
    const best = perStore[0]!;
    return {
      key,
      title: best.title,
      brand: best.brand ?? list.find((o) => o.brand)?.brand,
      image: list.find((o) => o.image)?.image,
      specs: mergeSpecs(list),
      offers: perStore,
      best,
    };
  });
}

function mergeSpecs(list: Offer[]): Offer['specs'] {
  const out: Offer['specs'] = {};
  for (const o of list) {
    for (const [k, v] of Object.entries(o.specs)) {
      if (v !== undefined && (out as Record<string, unknown>)[k] === undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}
