import { normalizeMpn } from './group.ts';
import { isWhite, stripAccents } from './normalize.ts';
import { GPU_BRANDS, type Specs, type StoreId } from './types.ts';

/**
 * Mesmo produto em lojas diferentes. Dois níveis:
 *
 * - **exato** (`exact`): mesmo part number do fabricante. O part number vem normalizado (só letras e
 *   dígitos; sem o "NAC" que uma loja acrescenta no fim) e também é procurado no título e no endereço
 *   das outras lojas (uma loja usa o código interno do fabricante, "90YV0MD0-M0NA00", e põe o nome
 *   comercial, "TUF-RTX5070TI-O16G-GAMING", no título). É o nível em que a ficha técnica de um anúncio
 *   vale para o outro. No processador, também o mesmo modelo com a descrição do título sem contradição
 *   (clocks, cache, soquete, núcleos, vídeo, cooler, tray/OEM × box), com ou sem part number.
 * - **grupo** (`group`): o exato mais o que é o mesmo modelo para mostrar junto: mesmo EAN, mesma chave
 *   do título (modelKey) ou, em placa de vídeo de marca conhecida, a mesma assinatura (marca + chip +
 *   memória + linha: "ASRock Arc B570 Challenger OC" com e sem o código no título).
 *
 * Proteções: branco e não branco nunca se juntam; dois anúncios da mesma loja com o mesmo código ou a
 * mesma assinatura e specs diferentes (código cortado, variante) deixam aquele código/assinatura de fora.
 */

export interface IdentityItem {
  /** Identificador único na lista (ex. "s1:123"). */
  id: string;
  store: StoreId;
  title: string;
  url?: string;
  mpn?: string;
  ean?: string;
  brand?: string;
  modelKey?: string;
  specs: Specs;
}

export interface Identity {
  /** id -> chave do produto (nível exato). */
  exact: Map<string, string>;
  /** id -> chave do grupo (para mostrar junto). */
  group: Map<string, string>;
}

/** Part number comparável entre lojas: normalizado e sem o "NAC" que uma loja põe no fim. */
export function productMpn(mpn?: string): string | undefined {
  const m = normalizeMpn(mpn);
  if (!m) return undefined;
  const stripped = m.replace(/NAC$/, '');
  return normalizeMpn(stripped) ?? m;
}

/** Palavra logo depois do código que indica outra versão do produto ("B860M-AORUS-ELITE" × "B860M Aorus Elite WIFI6E"). */
const VARIANT = /^(WIFI\w*|WF|AX|AC|BT|PLUS|PRO|MAX|ULTRA|ELITE|MINI|TI|SUPER|XT|XTX|GRE|D4|DDR4|D5|DDR5|II|III|E|S|X)$/;

/** Texto em palavras (maiúsculas, só letras e dígitos), para procurar um código respeitando o começo e o fim das palavras. */
const words = (s: string) => stripAccents(s).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

/**
 * O código aparece no texto começando e terminando em palavra inteira (as palavras juntas, sem os
 * separadores: "90-ga3czz-00uanf" contém "90GA3CZZ00UANF") e sem marca de outra versão logo depois.
 */
export function textHasCode(text: string[], code: string): boolean {
  for (let i = 0; i < text.length; i++) {
    let acc = '';
    for (let j = i; j < text.length && acc.length < code.length; j++) {
      acc += text[j];
      if (acc === code) return !VARIANT.test(text[j + 1] ?? '');
    }
  }
  return false;
}

/** Linhas (séries) das placas de vídeo das marcas conhecidas, palavra a palavra. */
const GPU_LINES = new Set(
  (
    'dual tuf rog strix astral prime ats phoenix proart ko windforce eagle aero aorus elite master xtreme ventus shadow inspire trio suprim expert mech ' +
    'twin edge solid amp infinity gamingpro jetstream phantom challenger legend taichi pulse nitro pure hellhound devil fighter reaper swift speedster ' +
    'qick swft merc mercury quicksilver magnetic magair ghost python pegasus storm vertex armor ice core sff lp itx x2 x3 2x 3x'
  ).split(' '),
);
const BRANDS = GPU_BRANDS.map((b) => b.toLowerCase());

/** Assinatura de placa de vídeo de marca conhecida: marca|chip|memória|linha(s)|oc|branca. Sem linha reconhecida, nenhuma. */
export function gpuSignature(item: Pick<IdentityItem, 'title' | 'brand' | 'specs'>): string | undefined {
  const s = item.specs;
  if (!s.gpuModel) return undefined;
  const words = stripAccents(item.title).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const brand = BRANDS.find((b) => b === item.brand?.toLowerCase() || words.includes(b));
  if (!brand) return undefined;
  // A linha com o número logo depois ("Infinity 2" × "Infinity 3": duas e três ventoinhas) é outra linha.
  const lines = [...new Set(words.flatMap((w, k) => (GPU_LINES.has(w) ? [/^\d$/.test(words[k + 1] ?? '') ? `${w}${words[k + 1]}` : w] : [])))].sort();
  if (!lines.length) return undefined;
  const oc = words.includes('oc') ? 'oc' : '';
  return [brand, s.gpuModel.toLowerCase(), s.vram ?? '', lines.join('+'), oc, isWhite(item.title) ? 'white' : ''].join('|');
}

/** Specs que, diferentes, provam que dois anúncios não são o mesmo produto. */
const conflict = (a: Specs, b: Specs) =>
  (['gpuModel', 'vram', 'cpuModel', 'cpuLine', 'ramCapacity', 'watts', 'ssdCapacity', 'memory', 'socket', 'chipset', 'wifi'] as const).some((k) => {
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    return x !== undefined && y !== undefined && x !== y;
  });

/** As specs principais confirmam que é o mesmo modelo (alguma definida nos dois e igual). */
const agree = (a: Specs, b: Specs) =>
  (['gpuModel', 'cpuModel', 'chipset', 'ramCapacity', 'watts', 'ssdCapacity'] as const).some((k) => {
    const x = (a as Record<string, unknown>)[k];
    return x !== undefined && x === (b as Record<string, unknown>)[k];
  });

/** Clocks e cache escritos no título do processador ("3.4GHz (4.5GHz Turbo)", "Cache 100MB"). */
function cpuDescription(title: string): { base?: number; boost?: number; cache?: number } {
  const t = stripAccents(title).toLowerCase();
  const ghz = [...t.matchAll(/(\d{1,2}[.,]\d{1,2})\s*ghz/g)].map((m) => Number(m[1]!.replace(',', '.')));
  const cache = t.match(/cache\s*(?:l3\s*)?(?:de\s*)?(\d{1,3})\s*mb|(\d{1,3})\s*mb\s*(?:de\s*)?(?:cache|l3)/);
  return {
    ...(ghz.length && { base: ghz[0] }),
    ...(ghz.length > 1 && { boost: Math.max(...ghz.slice(1)) }),
    ...(cache && { cache: Number(cache[1] ?? cache[2]) }),
  };
}

/** Acompanha cooler: o que as specs dizem ou, abreviado no título, "S/ Cooler" e "C/ Cooler". */
const coolerOf = (i: IdentityItem): boolean | undefined => {
  if (i.specs.cooler !== undefined) return i.specs.cooler;
  const t = stripAccents(i.title).toLowerCase();
  return /s\/\s?cooler/.test(t) ? false : /c\/\s?cooler/.test(t) ? true : undefined;
};

/** Dois processadores do mesmo modelo se contradizem em algo que os dois títulos dizem. */
function cpuConflict(a: IdentityItem, b: IdentityItem): boolean {
  if (conflict(a.specs, b.specs)) return true;
  const ka = coolerOf(a);
  const kb = coolerOf(b);
  if (ka !== undefined && kb !== undefined && ka !== kb) return true;
  for (const k of ['cores', 'threads', 'igpu'] as const) {
    const x = a.specs[k];
    const y = b.specs[k];
    if (x !== undefined && y !== undefined && x !== y) return true;
  }
  // Tray/OEM (sem caixa) é outro produto da box: pelo título ou pelo part number (Intel "CM…", "…TRAY", AMD "…MPK").
  const tray = (i: IdentityItem) => {
    const m = productMpn(i.mpn) ?? '';
    // Também o código tray no título: Intel "Cm8070104…", AMD "Yd340bc5m4mfh" / "…OFH".
    return /\b(tray|oem|mpk)\b|sem caixa|s\/\s?caixa|\bcm\d{6,}|\byd\w+[mo]fh\b/.test(stripAccents(i.title).toLowerCase()) || /^CM\d|TRAY$|MPK$/.test(m);
  };
  if (tray(a) !== tray(b)) return true;
  // Cooler que acompanha, quando os dois dizem: "Wraith Stealth" × "Wraith Prism" são caixas diferentes.
  const coolerName = (i: IdentityItem) => stripAccents(i.title).toLowerCase().match(/wraith\s*(stealth|prism|spire|max)|laminar\s*(rm\d|rh\d)/)?.[0].replace(/\s+/g, ' ');
  const ca = coolerName(a);
  const cb = coolerName(b);
  if (ca && cb && ca !== cb) return true;
  const da = cpuDescription(a.title);
  const db = cpuDescription(b.title);
  return (['base', 'boost', 'cache'] as const).some((k) => da[k] !== undefined && db[k] !== undefined && Math.abs(da[k]! - db[k]!) > 0.05);
}

/**
 * Dois anúncios da mesma loja com o mesmo código são o mesmo produto (anúncio repetido) só se as specs
 * não se contradizem e o título bate (mesma chave) ou as specs principais confirmam. Senão o código é
 * ambíguo (título cortado: "BX8071514" para i5-14600KF e i7-14700KF).
 */
const sameProduct = (a: IdentityItem, b: IdentityItem) => !conflict(a.specs, b.specs) && (a.modelKey === b.modelKey || agree(a.specs, b.specs));

class Unions {
  private parent = new Map<string, string>();
  constructor(ids: string[]) {
    for (const id of ids) this.parent.set(id, id);
  }
  find(id: string): string {
    const p = this.parent.get(id)!;
    if (p === id) return id;
    const r = this.find(p);
    this.parent.set(id, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  copy(): Unions {
    const u = new Unions([]);
    for (const [k] of this.parent) u.parent.set(k, this.find(k));
    return u;
  }
}

/** Junta os itens de cada balde, a não ser que algum par da mesma loja se contradiga (código ou assinatura ambígua). */
function unionBuckets(u: Unions, buckets: Map<string, IdentityItem[]>, sameStoreOk: (a: IdentityItem, b: IdentityItem) => boolean) {
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const ambiguous = list.some((a, i) => list.some((b, j) => j > i && a.store === b.store && !sameStoreOk(a, b)));
    if (ambiguous) continue;
    for (const x of list.slice(1)) u.union(list[0]!.id, x.id);
  }
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => m.set(k, [...(m.get(k) ?? []), v]);

export function identifyProducts(items: IdentityItem[]): Identity {
  const u = new Unions(items.map((i) => i.id));
  const white = new Map(items.map((i) => [i.id, isWhite(i.title)]));
  const mpn = new Map(items.map((i) => [i.id, productMpn(i.mpn)]));

  // 1. Mesmo part number (separando branco de não branco).
  const byMpn = new Map<string, IdentityItem[]>();
  for (const i of items) {
    const m = mpn.get(i.id);
    if (m) push(byMpn, `${m}|${white.get(i.id)}`, i);
  }
  unionBuckets(u, byMpn, sameProduct);

  // 2. Part number de um anúncio dentro do título ou do endereço de outra loja (código de 8+ caracteres).
  const hay = new Map(
    items.map((i) => {
      const title = words(i.title);
      const url = words(i.url?.replace(/^https?:\/\/[^/]+/, '') ?? '');
      // Tudo junto, para descartar rápido quem nem contém o código.
      return [i.id, { title, url, all: `${title.join('')}|${url.join('')}` }];
    }),
  );
  const byChip = new Map<string, IdentityItem[]>();
  for (const i of items) push(byChip, i.specs.gpuModel ?? '', i);
  for (const x of items) {
    const m = mpn.get(x.id);
    if (!m || m.length < 8) continue;
    // Placa de vídeo: só entre anúncios do mesmo chip (e sem chip lido), para não comparar tudo com tudo.
    const pool = x.specs.gpuModel ? [...(byChip.get(x.specs.gpuModel) ?? []), ...(byChip.get('') ?? [])] : items;
    for (const y of pool) {
      if (y.store === x.store || white.get(y.id) !== white.get(x.id) || conflict(x.specs, y.specs)) continue;
      const h = hay.get(y.id)!;
      if (h.all.includes(m) && (textHasCode(h.title, m) || textHasCode(h.url, m))) u.union(x.id, y.id);
    }
  }

  // 2b. Processador: mesmo modelo e a descrição do título não se contradiz (soquete, núcleos, threads,
  // vídeo, cooler, clocks, cache): é o mesmo produto, com ou sem part number, e com códigos de embalagem
  // diferentes ("100-100000651POF" e "…WOF" do mesmo 5800X3D). Quem caberia em dois conjuntos (o título
  // não diz se tem cooler e há "com" e "sem" do mesmo modelo) fica de fora.
  const byCpu = new Map<string, IdentityItem[]>();
  for (const i of items) {
    const s = i.specs;
    if (s.cpuModel && s.cpuLine) push(byCpu, `${s.cpuBrand ?? ''}|${s.cpuLine}|${s.cpuModel}`.toLowerCase(), i);
  }
  for (const list of byCpu.values()) {
    if (list.length < 2) continue;
    // Os que dizem se têm cooler primeiro: formam os conjuntos; os outros entram onde couberem.
    const ordered = [...list].sort((a, b) => Number(coolerOf(a) === undefined) - Number(coolerOf(b) === undefined));
    const clusters: IdentityItem[][] = [];
    for (const x of ordered) {
      const fits = clusters.filter((c) => c.every((y) => !cpuConflict(x, y)));
      if (fits.length === 1) fits[0]!.push(x);
      else if (!fits.length) clusters.push([x]);
    }
    for (const c of clusters) for (const x of c.slice(1)) u.union(c[0]!.id, x.id);
  }

  const exactRoot = u.copy();

  // 3. Grupo: mesmo EAN, mesma chave do título, mesma assinatura de placa de vídeo.
  const byEan = new Map<string, IdentityItem[]>();
  const byKey = new Map<string, IdentityItem[]>();
  const bySig = new Map<string, IdentityItem[]>();
  for (const i of items) {
    const sig = gpuSignature(i);
    if (i.ean) push(byEan, i.ean, i);
    // A chave do título descarta números soltos ("Infinity 2" = "Infinity 3", "Ventus 2X" = "3X"): só junta
    // anúncios com a mesma assinatura de placa (ou os dois sem assinatura).
    if (i.modelKey) push(byKey, `${i.modelKey}|${sig ?? ''}`, i);
    if (sig) push(bySig, sig, i);
  }
  unionBuckets(u, byEan, () => true);
  for (const list of byKey.values()) {
    if (list.some((a, i) => list.some((b, j) => j > i && conflict(a.specs, b.specs)))) continue;
    for (const x of list.slice(1)) u.union(list[0]!.id, x.id);
  }
  // Assinatura: dois anúncios da mesma loja com ela e códigos diferentes = variantes; fica de fora.
  unionBuckets(u, bySig, (a, b) => exactRoot.find(a.id) === exactRoot.find(b.id) || !mpn.get(a.id) || !mpn.get(b.id) || mpn.get(a.id) === mpn.get(b.id));

  // Chave estável: o menor part number do conjunto; sem nenhum, o menor id. Dois conjuntos com o mesmo
  // part number (código ambíguo, separado) ganham o menor id no fim, para a chave continuar única.
  const keyOf = (roots: Unions) => {
    const best = new Map<string, string>();
    const minId = new Map<string, string>();
    for (const i of items) {
      const r = roots.find(i.id);
      const cand = mpn.get(i.id) ?? `~${i.id}`;
      const cur = best.get(r);
      if (!cur || cand < cur) best.set(r, cand);
      const id = minId.get(r);
      if (!id || i.id < id) minId.set(r, i.id);
    }
    const uses = new Map<string, number>();
    for (const k of best.values()) uses.set(k, (uses.get(k) ?? 0) + 1);
    const key = (r: string) => {
      const k = best.get(r)!;
      return uses.get(k)! > 1 ? `${k.replace(/^~/, '')}~${minId.get(r)}` : k.replace(/^~/, '');
    };
    return new Map(items.map((i) => [i.id, key(roots.find(i.id))]));
  };
  return { exact: keyOf(exactRoot), group: keyOf(u) };
}
