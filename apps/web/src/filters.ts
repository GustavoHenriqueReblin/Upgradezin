import {
  EFFICIENCY_LEVELS,
  effectiveCash,
  FORM_FACTORS,
  ssdTier,
  stripAccents,
  type CategoryId,
  type CoolerType,
  type Efficiency,
  type FormFactor,
  type SsdInterface,
  type GpuMaker,
  type MemoryType,
  type Offer,
  type Socket,
  type StoreId,
} from '@upgradezin/shared';

export type ModularOpt = 'full' | 'semi' | 'none' | 'unknown';
/** Opções de cabeamento, iguais no formulário da busca e no filtro lateral. */
export const MODULAR_OPTS: ModularOpt[] = ['full', 'semi', 'none', 'unknown'];
export type ColorOpt = 'black' | 'white';
export type PsuFormatOpt = 'atx' | 'sfx';
export type SortOpt = 'price' | 'price-desc' | 'discount' | 'efficiency' | 'watts' | 'per-watt' | 'cores' | 'vram' | 'per-gb' | 'speed' | 'per-tb' | 'read';

/** Ordenações que fazem sentido em cada categoria (além de preço). */
export const CATEGORY_SORTS: Partial<Record<CategoryId, SortOpt[]>> = {
  psu: ['efficiency', 'per-watt', 'watts'],
  cpu: ['cores'],
  gpu: ['vram'],
  ram: ['per-gb', 'speed'],
  ssd: ['per-tb', 'read'],
};

export interface Filters {
  stores: StoreId[];
  brands: string[];
  /** Fonte. Potências exatas (vazio = qualquer). Também definem os termos da busca. */
  watts: number[];
  effMin?: Efficiency;
  modular: ModularOpt[];
  atx3: boolean;
  pcie5: boolean;
  /** Formato da fonte: ATX (padrão) ou SFX (compacta). Vazio = qualquer. */
  psuFormat: PsuFormatOpt[];
  /** Placa-mãe e processador. */
  sockets: Socket[];
  chipsets: string[];
  formFactors: FormFactor[];
  /** Placa-mãe e memória RAM (na memória, define a busca). */
  memory: MemoryType[];
  wifi: boolean;
  bluetooth: boolean;
  /** Processador. Linhas também definem a busca. */
  cpuLines: string[];
  cpuGens: string[];
  cores: number[];
  igpu: boolean;
  cooler: boolean;
  unlocked: boolean;
  /** Placa de vídeo. Fabricantes do chip definem a busca; série e modelo filtram. */
  gpuMakers: GpuMaker[];
  gpuSeries: string[];
  gpuModels: string[];
  vram: number[];
  vramTypes: string[];
  lowProfile: boolean;
  /** Memória RAM. Capacidades também definem a busca. */
  ramCapacity: number[];
  ramModules: number[];
  ramSpeed: number[];
  ramLatency: number[];
  /** SSD. Interfaces definem a busca; capacidade é a faixa (SSD_TIERS). */
  ssdInterfaces: SsdInterface[];
  ssdCapacity: number[];
  ssdPcie: number[];
  /** Cooler. Tipos definem a busca. */
  coolerTypes: CoolerType[];
  radiators: number[];
  /** Gabinete: formatos de placa-mãe que precisam caber (definem a busca). */
  caseFormFactors: FormFactor[];
  caseGlass: boolean;
  caseFans: boolean;
  /** Aparência (todas as categorias). Vazio = qualquer cor. */
  colors: ColorOpt[];
  rgb: boolean;
  /** Busca local no título dos resultados já carregados (não consulta as lojas). */
  text: string;
  priceMin?: number;
  priceMax?: number;
  inStockOnly: boolean;
  /** Só ofertas com cupom anunciado pela loja. */
  couponOnly: boolean;
  /** Esconde marketplace e open box. */
  trustedOnly: boolean;
  sort: SortOpt;
}

export const DEFAULT_FILTERS: Filters = {
  stores: [],
  brands: [],
  watts: [],
  modular: [],
  atx3: false,
  pcie5: false,
  psuFormat: [],
  sockets: [],
  chipsets: [],
  formFactors: [],
  memory: [],
  wifi: false,
  bluetooth: false,
  cpuLines: [],
  cpuGens: [],
  cores: [],
  igpu: false,
  cooler: false,
  unlocked: false,
  gpuMakers: [],
  gpuSeries: [],
  gpuModels: [],
  vram: [],
  vramTypes: [],
  lowProfile: false,
  ramCapacity: [],
  ramModules: [],
  ramSpeed: [],
  ramLatency: [],
  ssdInterfaces: [],
  ssdCapacity: [],
  ssdPcie: [],
  coolerTypes: [],
  radiators: [],
  caseFormFactors: [],
  caseGlass: false,
  caseFans: false,
  colors: [],
  rgb: false,
  text: '',
  inStockOnly: true,
  couponOnly: false,
  trustedOnly: true,
  sort: 'price',
};

/** O que define a busca em cada categoria: "Limpar" mantém isso (refazer a busca é em "Alterar Busca"). */
const SEARCH_KEYS: Partial<Record<CategoryId, (keyof Filters)[]>> = {
  psu: ['watts'],
  motherboard: ['sockets', 'chipsets'],
  cpu: ['sockets', 'cpuLines'],
  gpu: ['gpuMakers'],
  ram: ['memory', 'ramCapacity'],
  ssd: ['ssdInterfaces'],
  cooler: ['coolerTypes'],
  case: ['caseFormFactors'],
};

const effRank = (e?: Efficiency) => (e ? EFFICIENCY_LEVELS.indexOf(e) : -1);

/** Gabinete onde cabem as placas escolhidas (o maior formato escolhido precisa caber). */
export function caseFitsAll(caseFf: FormFactor | undefined, boards: FormFactor[]): boolean {
  if (!boards.length) return true;
  if (!caseFf) return false;
  return FORM_FACTORS.indexOf(caseFf) >= Math.min(...boards.map((b) => FORM_FACTORS.indexOf(b)));
}

/** Lista vazia = qualquer; valor ausente na oferta não passa quando há seleção. */
const anyOf = <T,>(selected: T[], value: T | undefined) => !selected.length || (value !== undefined && selected.includes(value));

/** Cada filtro como predicado isolado, para calcular contagens "excluindo a si mesmo". */
export type FilterKey =
  | 'stores' | 'brands' | 'watts' | 'eff' | 'modular' | 'atx3' | 'pcie5' | 'psuFormat'
  | 'sockets' | 'chipsets' | 'formFactors' | 'memory' | 'wifi' | 'bluetooth'
  | 'cpuLines' | 'cpuGens' | 'cores' | 'igpu' | 'cooler' | 'unlocked'
  | 'gpuMakers' | 'gpuSeries' | 'gpuModels' | 'vram' | 'vramTypes' | 'lowProfile'
  | 'ramCapacity' | 'ramModules' | 'ramSpeed' | 'ramLatency'
  | 'ssdInterfaces' | 'ssdCapacity' | 'ssdPcie' | 'coolerTypes' | 'radiators' | 'caseFormFactors' | 'caseGlass' | 'caseFans'
  | 'colors' | 'rgb' | 'text' | 'price' | 'stock' | 'coupon' | 'trusted';

function predicates(f: Filters): Record<FilterKey, (o: Offer) => boolean> {
  return {
    stores: (o) => anyOf(f.stores, o.store),
    brands: (o) => anyOf(f.brands, o.brand),
    watts: (o) => anyOf(f.watts, o.specs.watts),
    eff: (o) => !f.effMin || effRank(o.specs.efficiency) >= effRank(f.effMin),
    modular: (o) => !f.modular.length || f.modular.includes(o.specs.modular ?? 'unknown'),
    atx3: (o) => !f.atx3 || !!o.specs.atx,
    pcie5: (o) => !f.pcie5 || !!o.specs.pcie5 || !!o.specs.atx,
    psuFormat: (o) => !f.psuFormat.length || f.psuFormat.includes(o.specs.sfx ? 'sfx' : 'atx'),
    sockets: (o) => anyOf(f.sockets, o.specs.socket),
    chipsets: (o) => anyOf(f.chipsets, o.specs.chipset),
    formFactors: (o) => anyOf(f.formFactors, o.specs.formFactor),
    memory: (o) => anyOf(f.memory, o.specs.memory),
    wifi: (o) => !f.wifi || !!o.specs.wifi,
    bluetooth: (o) => !f.bluetooth || !!o.specs.bluetooth,
    cpuLines: (o) => anyOf(f.cpuLines, o.specs.cpuLine),
    cpuGens: (o) => anyOf(f.cpuGens, o.specs.cpuGen),
    cores: (o) => anyOf(f.cores, o.specs.cores),
    igpu: (o) => !f.igpu || o.specs.igpu === true,
    cooler: (o) => !f.cooler || o.specs.cooler === true,
    unlocked: (o) => !f.unlocked || o.specs.unlocked === true,
    gpuMakers: (o) => anyOf(f.gpuMakers, o.specs.gpuMaker),
    gpuSeries: (o) => anyOf(f.gpuSeries, o.specs.gpuSeries),
    gpuModels: (o) => anyOf(f.gpuModels, o.specs.gpuModel),
    vram: (o) => anyOf(f.vram, o.specs.vram),
    vramTypes: (o) => anyOf(f.vramTypes, o.specs.vramType),
    lowProfile: (o) => !f.lowProfile || !!o.specs.lowProfile,
    ramCapacity: (o) => anyOf(f.ramCapacity, o.specs.ramCapacity),
    ramModules: (o) => anyOf(f.ramModules, o.specs.ramModules),
    ramSpeed: (o) => anyOf(f.ramSpeed, o.specs.ramSpeed),
    ramLatency: (o) => anyOf(f.ramLatency, o.specs.ramLatency),
    ssdInterfaces: (o) => anyOf(f.ssdInterfaces, o.specs.ssdInterface),
    ssdCapacity: (o) => anyOf(f.ssdCapacity, ssdTier(o.specs.ssdCapacity)),
    ssdPcie: (o) => anyOf(f.ssdPcie, o.specs.ssdPcie),
    coolerTypes: (o) => anyOf(f.coolerTypes, o.specs.coolerType),
    radiators: (o) => anyOf(f.radiators, o.specs.radiator),
    caseFormFactors: (o) => caseFitsAll(o.specs.caseFormFactor, f.caseFormFactors),
    caseGlass: (o) => !f.caseGlass || !!o.specs.caseGlass,
    caseFans: (o) => !f.caseFans || (o.specs.caseFans ?? 0) > 0,
    colors: (o) => !f.colors.length || f.colors.includes(o.specs.white ? 'white' : 'black'),
    rgb: (o) => !f.rgb || !!o.specs.rgb,
    text: (o) => matchesText(o, f.text),
    price: (o) => (f.priceMin == null || effectiveCash(o) >= f.priceMin) && (f.priceMax == null || effectiveCash(o) <= f.priceMax),
    stock: (o) => !f.inStockOnly || o.inStock,
    coupon: (o) => !f.couponOnly || effectiveCash(o) < o.priceCash,
    trusted: (o) => !f.trustedOnly || (!o.marketplace && !o.openbox),
  };
}

/** Limpa os refinamentos do resultado, mantendo o que definiu a busca da categoria e a ordenação. */
export function resetResultFilters(f: Filters, category: CategoryId): Filters {
  const keys = [...(SEARCH_KEYS[category] ?? [])];
  // Placa-mãe buscada só pela memória (sem plataforma): a memória definiu a busca.
  if (category === 'motherboard' && !f.sockets.length) keys.push('memory');
  const kept = Object.fromEntries(keys.map((k) => [k, f[k]]));
  return { ...DEFAULT_FILTERS, ...kept, sort: f.sort };
}

export function applyFilters(offers: Offer[], f: Filters, except?: FilterKey): Offer[] {
  const p = predicates(f);
  const active = (Object.keys(p) as FilterKey[]).filter((k) => k !== except).map((k) => p[k]);
  return offers.filter((o) => active.every((fn) => fn(o)));
}

export function countBy<T extends string | number>(offers: Offer[], pick: (o: Offer) => T | undefined): Map<T, number> {
  const m = new Map<T, number>();
  for (const o of offers) {
    const v = pick(o);
    if (v !== undefined) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

// ---------- Busca local nos resultados ----------

const fold = (s: string) => stripAccents(s).toLowerCase();

/** Palavras da busca local: separadas por espaço ou vírgula. */
export const textTerms = (text: string) => fold(text).split(/[\s,]+/).filter(Boolean);

/** Todas as palavras digitadas aparecem no título (ou na marca), sem diferenciar acento e maiúscula. */
export function matchesText(o: Offer, text: string): boolean {
  const terms = textTerms(text);
  if (!terms.length) return true;
  const hay = fold(`${o.brand ?? ''} ${o.title}`);
  return terms.every((t) => hay.includes(t));
}

/** Palavras que não ajudam a distinguir produtos (artigos, categoria, cor, specs com filtro próprio, marketing). */
const STOP = new Set(
  (
    'de da do das dos com sem para por e ou em a o as os the and for with x ' +
    'placa video mae processador memoria ram fonte gpu gamer gaming pc desktop ' +
    'preto preta black branco branca white cinza prata ' +
    'gb mb mhz ghz mt bits bit cache turbo max nucleos cores core threads thread ' +
    'ddr gddr nvidia geforce amd radeon intel arc rtx gtx gt rx ryzen ultra plus pfc ativo ' +
    'ray tracing dlss fsr fan fans rgb argb led dimm udimm xmp expo cl ti xt xtx super gre ' +
    'integrado video graficos graphics box tray oem lga socket cooler hexa octa quad dual-core ' +
    'serie series edition versao nova novo kit atx matx itx micro mini modular full semi'
  ).split(' '),
);

/**
 * Palavras do nome do produto (antes da primeira vírgula, onde fica a linha: "Fury Beast",
 * "Windforce"), sem números e specs, que já têm filtro próprio.
 */
function titleWords(title: string): Set<string> {
  const head = fold(title).split(/,| - /)[0]!;
  return new Set(head.split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !/\d/.test(w) && !STOP.has(w)));
}

/**
 * Nomes comuns entre os resultados, para a busca local: aparecem em pelo menos 2
 * ofertas e não em quase todas (essas não filtram nada). Mais frequentes primeiro.
 */
export function commonWords(offers: Offer[], limit = 12, skip: string[] = []): string[] {
  const df = new Map<string, number>();
  for (const o of offers) for (const w of titleWords(o.title)) df.set(w, (df.get(w) ?? 0) + 1);
  const max = Math.max(2, Math.floor(offers.length * 0.8));
  const skipped = new Set(skip.map(fold));
  return [...df.entries()]
    .filter(([w, n]) => n >= 2 && n < max && !skipped.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}
