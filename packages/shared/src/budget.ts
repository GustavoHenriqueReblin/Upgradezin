import { checkBuild, coolerFits, type Build, type BuildIssue, type BuildSlot } from './compat.ts';
import { BASE_SYSTEM_POWER, chipsetSupport, cpuFamily, cpuPower, cpuTdp, GPU_POWER, recommendedPsuWatts } from './hardware.ts';
import { caseFits } from './pccase.ts';
import { budgetCpuCapacity, budgetCpuScore, budgetGamingScore, budgetGpuScore, budgetIgpuScore, ENTRY_CHIPSETS, type Resolution } from './perf.ts';
import { effectiveCash, FORM_FACTORS, type FormFactor, type MemoryType, type Offer, type Specs } from './types.ts';

/**
 * Montar pelo orçamento (docs/ARCHITECTURE.md §17.4). Função pura: recebe o orçamento, a tela e as
 * ofertas de agora (com a ficha) e devolve as peças a comprar.
 *
 * - **PC inteiro** (sem `owned`): escolhe o par processador + placa de vídeo que mais rende em jogos
 *   na tela da pessoa, com a plataforma, memória em dois pentes, fonte certificada com folga,
 *   SSD NVMe, cooler quando o processador pede e gabinete onde a placa cabe.
 * - **Upgrade** (`owned` = as peças do PC importado): para cada peça, manter ou trocar. Processador do
 *   mesmo encaixe (se a placa-mãe aceita), ou plataforma nova (processador, placa-mãe e memória;
 *   a memória atual fica se for do tipo da placa nova); placa de vídeo; fonte quando a atual não
 *   aguenta. Só sugere se render pelo menos 10% a mais.
 *
 * O índice de jogos combina o teto estimado da CPU e a nota da GPU na resolução pedida.
 * Entre as opções que cabem no orçamento, a mais barata dentro
 * de 3% da melhor: gastar mais por quase nada não vale. Até OPTIONS opções, cada uma com outra placa de
 * vídeo (ou outro processador), para a pessoa comparar; a última pode passar até 25% do orçamento se
 * render bem mais (STRETCH). Cada opção passa pela compatibilidade antes de entrar na resposta.
 */

export interface BudgetRequest {
  /** Quanto a pessoa quer gastar (R$, à vista). */
  budget: number;
  res: Resolution;
  hz?: number;
  /** Estoque observado recentemente ou catálogo com preços de referência. */
  mode?: BudgetMode;
  profile?: BudgetProfile;
  graphics?: 'integrated' | 'dedicated';
  preferences?: { cpu?: 'amd' | 'intel'; gpu?: 'amd' | 'intel' | 'nvidia' };
  requiredBrands?: BudgetRequest['preferences'];
  workload?: 'cpu' | 'gpu';
  /** Peças que a pessoa já tem (upgrade). Sem processador nem placa de vídeo aqui: PC inteiro. */
  owned?: Build;
  /** Desempenho das peças atuais, calculado na tela (o processador pela ficha do modelo). */
  current?: { cpu?: number; gpu?: number };
}

export type BudgetMode = 'buyable' | 'ideal';
export type BudgetProfile = 'games' | 'mixed' | 'productivity';
export interface BudgetReference { price: number; at: string }
export type BudgetOffer = Offer & { reference?: BudgetReference };

export interface BudgetPart {
  /** À vista com cupom, da loja mais barata; com `qty`, o total das unidades. */
  price: number;
  /** Unidades (memória em pentes avulsos iguais: 2). Ausente = 1. */
  qty?: number;
  offer: Offer;
  /** O mesmo produto em todas as lojas (para a montagem comparar). */
  offers: Offer[];
  /** Preço histórico por unidade quando a peça não tem oferta recente. */
  reference?: BudgetReference;
}

/**
 * ok: montou. too-low: o orçamento não fecha nem a opção mais barata (minTotal diz quanto).
 * no-gain: upgrade sem troca que renda 10% dentro do valor. no-data: faltam ofertas para montar.
 */
export type BudgetStatus = 'ok' | 'too-low' | 'no-gain' | 'no-data';

/**
 * Observações do plano. igpu: sem placa de vídeo (vídeo integrado). ram-16: memória de 16 GB (32 não
 * coube). ssd-500: SSD de 500 GB. psu-unknown: upgrade sem a fonte informada (confira). keeps-ram:
 * plataforma nova com a memória atual. bios: a placa-mãe
 * atual aceita o processador depois de atualizar a BIOS. ram-pair: memória em 2 pentes avulsos iguais
 * (mais barata que o kit).
 */
export type BudgetNote = 'igpu' | 'ram-16' | 'ssd-500' | 'psu-unknown' | 'keeps-ram' | 'bios' | 'ram-pair' | 'box-cooler' | 'vrm-unverified' | 'psu-connector' |
  'capacity-value' | 'case-clearance' | 'cooling-estimate';

/** Uma opção de compra: as peças que fecham no orçamento, com o desempenho que elas dão. */
export interface BudgetOption {
  /** Peças a comprar. No upgrade, as peças de `owned` que não estão aqui ficam. */
  parts: Partial<Record<BuildSlot, BudgetPart>>;
  total: number;
  /** Desempenho do processador e da placa de vídeo do PC resultante, e o equilíbrio (processador ÷ o que a placa pede). */
  cpu?: number;
  gpu?: number;
  ratio?: number;
  /** Upgrade: quanto o rendimento em jogos sobe (0.4 = +40%). */
  gain?: number;
  /** Rendimento em jogos na tela da pessoa (escala de perf.ts): compara as opções entre si. */
  fps: number;
  /** Índice do perfil e estimativa de capacidade paralela, separados do índice de jogos. */
  objective?: number;
  work?: number;
  /** Passa do orçamento (até STRETCH acima) para render bem mais: "por R$ X a mais, Y% a mais de desempenho". */
  stretch?: true;
  notes: BudgetNote[];
  /** O que a compatibilidade ainda aponta na montagem final (sem as observações). */
  issues: BuildIssue[];
}

/**
 * O plano: a 1ª opção (a melhor) nos próprios campos e as outras em `alternatives` (até OPTIONS no total),
 * cada uma com outra placa de vídeo (ou, se não houver, outro processador), para a pessoa comparar.
 */
export interface BudgetPlan extends BudgetOption {
  status: BudgetStatus;
  mode?: BudgetMode;
  profile?: BudgetProfile;
  budget: number;
  /** too-low: o menor valor que monta. */
  minTotal?: number;
  bestObjective?: number;
  audit?: {
    strongerWithinBudget?: BudgetOption;
    betterOutsideBudget?: BudgetOption;
    rejectedBuilds: { incompatibility: number; noSuitableCooling: number; noSuitableBoard: number };
  };
  /** 2ª e 3ª opções, da melhor para a pior. */
  alternatives: BudgetOption[];
}

/** Quantas opções o plano mostra (a melhor e as alternativas). */
export const OPTIONS = 3;
/** A última opção pode passar do orçamento em até isto (0.25 = 25%)... */
export const STRETCH = 0.25;
/** ...se render pelo menos isto a mais que a 1ª opção. */
const STRETCH_GAIN = 0.1;

/** Ganho mínimo de um upgrade para valer a sugestão. */
const MIN_GAIN = 0.1;
/** Entre as opções que cabem, a mais barata que rende pelo menos isto da melhor. */
const NEAR_BEST = 0.97;
// Limites de preferência por capacidade a cada primeira duplicação. O crédito depende da sobra real.
const CAPACITY_WEIGHT = { games: { ram: 0.065, ssd: 0.045 }, mixed: { ram: 0.095, ssd: 0.055 }, productivity: { ram: 0.110, ssd: 0.065 } };
const capacityBenefit = (capacity: number, base: number) => capacity > base ? 2 * (1 - base / capacity) : 0;
/** Desempenho mínimo de placa de vídeo para entrar (escala de perf.ts; GTX 1050 Ti = 33). */
const MIN_GPU_PERF = 30;
/** TDP mínimo de air cooler (os de 65 W são os de 90 mm ou de perfil baixo). */
const MIN_AIR_TDP = 100;
/** Preferência do kit sobre 2 pentes avulsos iguais (na escolha). */
const PAIR_MARGIN = 0.05;
/** Carga a partir da qual padrão elétrico e conectores declarados ganham prioridade. */
const PSU_HIGH_LOAD_W = 400;
/** Frequência mínima da memória escolhida. */
const MIN_RAM_SPEED: Record<MemoryType, number> = { ddr4: 3200, ddr5: 5200 };

/**
 * Marcas com mais relevância no mercado, por peça: têm prioridade, não exclusividade. Na escolha, o
 * produto de outra marca conta como se custasse BRAND_MARGIN a mais; assim a de marca conhecida ganha
 * quando a diferença é pequena, e a de fora só entra quando é bem mais barata. O preço mostrado e o
 * total são os reais. Processador, SSD, cooler e gabinete sem lista.
 */
export const BUDGET_BRANDS: Partial<Record<BuildSlot, string[]>> = {
  motherboard: ['ASUS', 'MSI', 'Gigabyte', 'ASRock', 'Biostar'],
  ram: ['Kingston', 'Corsair', 'G.Skill', 'Crucial', 'ADATA', 'XPG', 'TeamGroup', 'T-Force', 'Patriot'],
  gpu: ['ASUS', 'MSI', 'Gigabyte', 'ASRock', 'PowerColor', 'XFX', 'Zotac', 'PNY', 'Galax'],
  psu: ['Corsair', 'XPG', 'Cooler Master', 'Thermaltake', 'MSI', 'EVGA', 'DeepCool', 'Cougar', 'Gamemax'],
};
/**
 * Quanto a mais o produto de outra marca "custa" na escolha. A fonte pesa mais: é a peça em que a marca
 * desconhecida mais arrisca o PC (em nov/2026, a de marca da lista custava de 40% a 60% a mais que a mais
 * barata certificada, uns R$ 100). A memória também pesa mais: marca desconhecida é a causa mais comum
 * de travamento (2 pentes Patriot de 16 GB custavam 29% a mais que 2 de uma marca sem nome).
 */
const BRAND_MARGIN: Partial<Record<BuildSlot, number>> = { motherboard: 0.15, ram: 0.3, gpu: 0.2, psu: 0.7 };

const brandKey = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
const BRAND_KEYS = Object.fromEntries(Object.entries(BUDGET_BRANDS).map(([slot, list]) => [slot, list!.map(brandKey)])) as Partial<Record<BuildSlot, string[]>>;

/** A oferta é de uma marca da lista da peça (pela marca do anúncio; sem ela, pelo começo do título). */
export function preferredBrand(slot: BuildSlot, o: Pick<Offer, 'brand' | 'title'>): boolean {
  const keys = BRAND_KEYS[slot];
  if (!keys) return true;
  if (o.brand) return keys.includes(brandKey(o.brand));
  const words = o.title.split(/\s+/).slice(0, 6).map(brandKey);
  return words.some((w, i) => keys.includes(w) || keys.includes(w + (words[i + 1] ?? '')));
}

interface Product {
  price: number;
  /** Preço de escolha: o real, com a margem das marcas fora da lista (BUDGET_BRANDS). */
  score: number;
  offer: BudgetOffer;
  offers: Offer[];
  specs: Specs;
  /** Unidades: memória em 2 pentes avulsos iguais (preço e preço de escolha já são das duas). */
  qty?: number;
}

/** Ofertas que dá para comprar, uma entrada por produto (a mais barata entre as lojas), da de menor preço de escolha à maior. */
function productsOf(slot: BuildSlot, offers: BudgetOffer[] | undefined, now: number, mode: BudgetMode): Product[] {
  const by = new Map<string, Product>();
  for (const o of offers ?? []) {
    if (!o.specs || o.marketplace || o.openbox || (!o.inStock && (mode !== 'ideal' || !o.reference))) continue;
    const price = round2(o.inStock ? effectiveCash(o, now) : o.reference?.price ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const product = o.productKey ?? o.modelKey ?? `${o.store}|${o.storeSku}`;
    const variant = slot === 'gpu' ? gpuVariant(o.specs) : slot === 'cpu' ? String(boxCoolerIn(o)) : '';
    const key = `${product}|${variant}`;
    const p = by.get(key);
    if (!p) by.set(key, { price, score: price, offer: o, offers: o.inStock ? [o] : [], specs: o.specs });
    else {
      if (o.inStock) p.offers.push(o);
      const preferred = o.inStock !== p.offer.inStock ? o.inStock : o.inStock ? price < p.price : (o.reference?.at ?? '') > (p.offer.reference?.at ?? '');
      if (preferred) Object.assign(p, { price, offer: o, specs: o.specs });
    }
  }
  const margin = BRAND_MARGIN[slot] ?? 0;
  for (const p of by.values()) p.score = preferredBrand(slot, p.offer) ? p.price : p.price * (1 + margin);
  return [...by.values()].sort((a, b) => a.score - b.score || a.price - b.price);
}

const rank = (f: FormFactor) => FORM_FACTORS.indexOf(f);
const memo = <T>(fn: (k: string) => T) => {
  const m = new Map<string, T>();
  return (k: string) => {
    if (!m.has(k)) m.set(k, fn(k));
    return m.get(k)!;
  };
};
const tdpOf = (s: Specs) => s.tdp ?? cpuTdp(s) ?? 65;
const cpuWatts = (s: Specs) => Math.max(tdpOf(s), cpuPower(s) ?? tdpOf(s) * 1.4);
const gpuWatts = (s: Specs | undefined, sheet?: Offer['sheet']) => {
  if (!s) return 0;
  const declared = s.gpuTdp ?? sheet?.tdpW;
  const reference = s.gpuModel ? GPU_POWER[s.gpuModel] : undefined;
  return typeof declared === 'number' && Number.isFinite(declared) && declared > 0 ? Math.max(declared, reference ?? 0) : (reference ?? 200);
};
/** Consumo máximo estimado do PC (W). */
const drawOf = (cpu: Specs, gpu: Specs | undefined, sheet?: Offer['sheet']) => cpuWatts(cpu) + gpuWatts(gpu, sheet) + BASE_SYSTEM_POWER;
/** Fonte recomendada: consumo com folga; a que o fabricante da placa de vídeo pede vale como piso. */
const psuNeed = (cpu: Specs, gpu: Specs | undefined, sheet: Offer['sheet'] | undefined, atx3: boolean) =>
  recommendedPsuWatts(drawOf(cpu, gpu, sheet), gpuWatts(gpu, sheet), gpu?.gpuPsu ?? 0, atx3);
/** Fonte simples: sem PFC ativo e sem certificação. */
const sustainedWorkFactor = (watts: number, verified = false) =>
  verified ? 1 : Math.sqrt(Math.min(1, (watts >= 200 ? 200 : 145) / watts));

const basicPsu = (s: Specs) => s.activePfc === false && (!s.efficiency || s.efficiency === 'white');

interface CpuOption {
  /** Processador novo (sem: mantém o atual). */
  cpu?: Product;
  specs: Specs;
  perf: number;
  work?: number;
  cost: number;
  /** Soma dos preços de escolha. */
  score: number;
  board?: Product;
  ram?: Product;
  cooler?: Product;
  /** Geração PCIe do slot da placa de vídeo na placa-mãe que fica. */
  notes: BudgetNote[];
}

interface GpuOption {
  gpu?: Product;
  specs?: Specs;
  perf: number;
}

const gpuVariant = (s?: Specs) => s?.gpuModel ? `${s.gpuModel}|${s.vram ?? '?'}` : 'atual';
const boxCoolerIn = (o: Offer) => o.specs?.cooler === true && !/WOF$/i.test(o.mpn ?? '');

interface Tier {
  ram: number;
  ssd?: number;
}

export function planBudget(req: BudgetRequest, offers: Partial<Record<BuildSlot, BudgetOffer[]>>, now = Date.now()): BudgetPlan {
  return prepareBudget(req, offers, now)(req.budget);
}

/** Reaproveita as mesmas candidatas e checagens quando só muda o valor disponível. */
export function prepareBudget(req: Omit<BudgetRequest, 'budget'>, offers: Partial<Record<BuildSlot, BudgetOffer[]>>, now = Date.now()): (budget: number, audit?: boolean | 'primary') => BudgetPlan {
  const mode = req.mode ?? 'buyable';
  const profile = req.profile ?? 'games';
  const P = {
    motherboard: productsOf('motherboard', offers.motherboard, now, mode),
    cpu: productsOf('cpu', offers.cpu, now, mode),
    ram: productsOf('ram', offers.ram, now, mode),
    gpu: productsOf('gpu', offers.gpu, now, mode),
    psu: productsOf('psu', offers.psu, now, mode),
    ssd: productsOf('ssd', offers.ssd, now, mode),
    cooler: productsOf('cooler', offers.cooler, now, mode),
    case: productsOf('case', offers.case, now, mode),
  };
  const owned = req.owned ?? {};
  const upgrade = !!(owned.cpu || owned.gpu);
  const rejectedBuilds = { incompatibility: 0, noSuitableCooling: 0, noSuitableBoard: 0 };
  const empty = (budget: number, status: BudgetStatus, extra: Partial<BudgetPlan> = {}): BudgetPlan => ({ status, mode, profile, budget, parts: {}, total: 0, fps: 0, notes: [], issues: [], alternatives: [], ...extra });
  if (!upgrade && (!P.cpu.length || !P.psu.length)) return (budget) => empty(budget, 'no-data');

  // ---------- Candidatas de cada peça (da mais barata) ----------
  const cases = memo((ff) => P.case.filter((c) => caseFits(c.specs.caseFormFactor, ff as FormFactor)));
  /**
   * Memória de `cap` GB em 2 pentes: um kit, ou 2 pentes avulsos iguais (em nov/2026, 2 de 16 GB DDR4
   * custavam R$ 1.458 contra R$ 2.399 do kit mais barato). O kit tem uma pequena preferência
   * (PAIR_MARGIN): só ele garante a frequência anunciada com os dois pentes.
   */
  const rams = memo((k) => {
    const [memory, cap] = k.split('|') as [MemoryType, string];
    const fast = (r: Product) => r.specs.memory === memory && (r.specs.ramSpeed ?? 0) >= MIN_RAM_SPEED[memory];
    const kits = P.ram.filter((r) => fast(r) && r.specs.ramCapacity === Number(cap) && r.specs.ramModules === 2);
    const pairs = P.ram
      .filter((r) => fast(r) && r.specs.ramCapacity === Number(cap) / 2 && r.specs.ramModules === 1)
      .map((r): Product => ({ ...r, price: r.price * 2, score: r.score * 2 * (1 + PAIR_MARGIN), qty: 2 }));
    return [...kits, ...pairs].sort((a, b) => a.score - b.score || a.price - b.price);
  });
  const ssds = memo((cap) => P.ssd.filter((s) => s.specs.ssdInterface === 'nvme' && s.specs.ssdForm !== '2.5' && Math.abs((s.specs.ssdCapacity ?? 0) - Number(cap)) <= Number(cap) * 0.1));
  const psus = memo((w) => P.psu.filter((p) => (p.specs.watts ?? 0) >= Number(w) && !!p.specs.efficiency && p.specs.efficiency !== 'white'));
  const psuAtx3 = (p: Product) => /^3[.]?[01]?$/.test(p.specs.atx ?? '') ||
    (typeof p.offer.sheet?.standard === 'string' && /\bATX\s*3(?:[.,][01])?\b/i.test(p.offer.sheet.standard));
  const psuEvidence = (p: Product) => Number(psuAtx3(p)) + Number((p.specs.pcie5 && p.offer.sheet?.pcie16 !== 0) || Number(p.offer.sheet?.pcie16) > 0);
  const psuCandidates = memo((key) => {
    const [conventional, modern, heavy, sixteen, eight] = key.split('|').map(Number);
    const fit = psus(String(Math.min(conventional!, modern!))).filter((p) => {
      const sheet = p.offer.sheet;
      return (p.specs.watts ?? 0) >= (psuAtx3(p) ? modern! : conventional!) &&
        sheet?.eps !== 0 && !(sixteen && (sheet?.pcie16 === 0 || p.specs.pcie5 === false)) && !(eight && typeof sheet?.pcie8 === 'number' && sheet.pcie8 < eight);
    });
    const cost = (p: Product) => p.score / (1 + 0.07 * psuEvidence(p));
    return heavy || sixteen ? fit.sort((a, b) => cost(a) - cost(b) || a.price - b.price) : fit;
  });
  const psuToBuy = (cpu: Specs, gpu: Specs | undefined, sheet?: Offer['sheet']) => {
    const load = drawOf(cpu, gpu, sheet);
    const conventional = psuNeed(cpu, gpu, sheet, false);
    const modern = psuNeed(cpu, gpu, sheet, true);
    const connectors = typeof sheet?.powerConnectors === 'string' ? sheet.powerConnectors : '';
    const eight = /(?:^|\s)(\d+)\s*[x×]\s*8\s*(?:pinos?|pins?)/i.exec(connectors)?.[1] ?? '0';
    return psuCandidates(`${conventional}|${modern}|${load >= PSU_HIGH_LOAD_W ? 1 : 0}|${gpu?.gpu16Pin ? 1 : 0}|${eight}`);
  };
  /**
   * Triagem conservadora pelo soquete, potência estimada do processador e porte do cooler.
   * A capacidade declarada pelo fabricante serve como filtro, sem garantir temperatura ou ruído.
   */
  const coolers = memo((k) => {
    const [socket, t] = k.split('|');
    const watts = Number(t);
    return P.cooler.filter((c) => {
      const s = c.specs;
      if (coolerFits(s, socket as Specs['socket']) !== 'ok') return false;
      if (s.coolerTdp !== undefined && s.coolerTdp < watts) return false;
      if (s.coolerType === 'water') return (s.radiator ?? 0) >= (watts > 200 ? 280 : watts >= 145 ? 240 : 120);
      if (s.coolerType !== 'air') return false;
      const { heatpipes, fanMm } = c.offer.sheet ?? {};
      if (watts > 200) return Number(heatpipes) >= 6 && Number(fanMm) >= 120 && Number(c.offer.sheet?.fans) >= 2;
      if (watts >= 145 && (typeof heatpipes === 'number' || typeof fanMm === 'number')) {
        return (heatpipes === undefined || Number(heatpipes) >= 4) && (fanMm === undefined || Number(fanMm) >= 120);
      }
      return (s.coolerTdp ?? 0) >= Math.max(MIN_AIR_TDP, watts);
    });
  });
  /** Gabinete onde a placa-mãe cabe, com ventilação: 1 ventoinha ou mais; 3 ou mais com placa de vídeo de 200 W ou mais. */
  const ventilatedCases = memo((k) => {
    const [ff, fans] = k.split('|');
    return cases(ff!).filter((c) => (c.specs.caseFans ?? 0) >= Number(fans));
  });
  const casesFor = (ff: FormFactor, gpuW: number) => ventilatedCases(`${ff}|${gpuW >= 200 ? 3 : 1}`);
  const coolingLoad = (p: Product) => {
    const watts = cpuWatts(p.specs);
    // Reserva de projeto para manter a carga por mais tempo, com ar mais quente dentro do gabinete.
    return profile !== 'games' && watts >= 145 ? Math.ceil(watts * 1.10) : watts;
  };
  const coolerKey = (p: Product) => `${p.specs.socket}|${coolingLoad(p)}`;
  const vrmDemand = (p: Product) => tdpOf(p.specs) >= 105 || cpuWatts(p.specs) >= 145;
  // Ensaio de uma hora em Cinebench, 7950X sob 200 W. Só vale para o modelo exato.
  const vrmTested = (b: Product, watts: number) => watts <= 200 && /\bB650M[- ]HDV\s*\/\s*M[.]2\b/i.test(b.offer.title);
  const withBoxCooler = (p: Product) => boxCoolerIn(p.offer) && !vrmDemand(p);
  const oldCooler = owned.cooler?.specs;
  const reuseCooler = (p: Product) => !!oldCooler && coolerFits(oldCooler, p.specs.socket) === 'ok' && coolingLoad(p) <= 145 && (oldCooler.coolerTdp ?? 0) >= coolingLoad(p);
  const coolerFitsCase = (cooler?: Specs, pcase?: Specs) =>
    !(cooler?.coolerHeight && pcase?.caseMaxCooler && cooler.coolerHeight > pcase.caseMaxCooler) &&
    !(cooler?.radiator && pcase?.caseRadiators?.length && !pcase.caseRadiators.includes(cooler.radiator));
  const radiatorFitsGpu = (pcase?: Specs, gpu?: Specs, cooler?: Specs) =>
    !(cooler?.radiator && gpu?.gpuLength && pcase?.caseMaxGpu && pcase.caseMaxGpu - gpu.gpuLength < 55);
  const knownRoom = (pcase: Specs, gpu?: Specs, cooler?: Specs) =>
    Number(!!gpu?.gpuLength && !!pcase.caseMaxGpu && pcase.caseMaxGpu - gpu.gpuLength >= (cooler?.radiator ? 55 : 10)) +
    Number(!!cooler?.coolerHeight && !!pcase.caseMaxCooler && pcase.caseMaxCooler - cooler.coolerHeight >= 5);
  const tightCase = (pcase?: Specs, gpu?: Specs, cooler?: Specs) => {
    if (!pcase) return false;
    const gpuRoom = pcase.caseMaxGpu && gpu?.gpuLength ? pcase.caseMaxGpu - gpu.gpuLength : undefined;
    const coolerRoom = pcase.caseMaxCooler && cooler?.coolerHeight ? pcase.caseMaxCooler - cooler.coolerHeight : undefined;
    // Radiador frontal e ventoinhas podem ocupar cerca de 55 mm. A ficha não informa a posição.
    return (gpuRoom !== undefined && gpuRoom < (cooler?.radiator ? 55 : 10)) ||
      (!!cooler?.radiator && !!gpu && gpuRoom === undefined) || (coolerRoom !== undefined && coolerRoom < 5);
  };

  // ---------- Processadores e placas de vídeo à venda (um por modelo, o de menor preço de escolha) ----------
  const cpus = new Map<string, { p: Product; perf: number }>();
  for (const p of P.cpu) {
    const s = p.specs;
    if (req.requiredBrands?.cpu && req.requiredBrands.cpu !== s.cpuBrand) continue;
    const perf = budgetCpuScore(s, p.offer.sheet);
    if (!perf || !s.socket || !s.cpuModel || !cpuFamily(s)) continue;
    const k = `${s.cpuLine} ${s.cpuModel}|${withBoxCooler(p)}|${cpuWatts(s)}`;
    if (!cpus.has(k)) cpus.set(k, { p, perf });
  }
  const gpus = new Map<string, GpuOption[]>();
  // Upgrade: só variantes com pelo menos a memória de vídeo da placa atual (o mesmo chip sai com 8 e 16 GB);
  // com menos, ou sem a informação, seria downgrade.
  const vramFloor = upgrade ? owned.gpu?.specs.vram : undefined;
  for (const p of P.gpu) {
    if (vramFloor && (p.specs.vram ?? 0) < vramFloor) continue;
    if (req.requiredBrands?.gpu && req.requiredBrands.gpu !== p.specs.gpuMaker) continue;
    const perf = budgetGpuScore(p.specs, req.res);
    const m = p.specs.gpuModel;
    // Placa abaixo de uma GTX 1050 Ti (GT 710, GT 730…) rende menos que o vídeo integrado atual: não é opção.
    if (perf && perf < MIN_GPU_PERF) continue;
    if (!perf || !m) continue;
    const length = p.specs.gpuLength;
    const key = `${gpuVariant(p.specs)}|${length === undefined ? '?' : 'mm'}|${p.specs.gpuPcieLanes ?? p.offer.sheet?.pcie ?? '?'}|${gpuWatts(p.specs, p.offer.sheet)}|${p.specs.gpuPsu ?? '?'}|${p.specs.gpu16Pin ?? '?'}`;
    const options = gpus.get(key) ?? [];
    // A lista chega ordenada pelo preço de escolha. Preserva a variante menor quando ela pode caber em outro gabinete.
    if (options.some((option) => option.gpu!.price <= p.price && (option.specs?.gpuLength ?? 0) <= (length ?? 0))) continue;
    options.push({ gpu: p, specs: p.specs, perf });
    gpus.set(key, options);
  }

  const oCpu = owned.cpu?.specs;
  const oMb = owned.motherboard?.specs;
  const oRam = owned.ram?.specs;
  const oGpu = owned.gpu?.specs;
  const oPsu = owned.psu?.specs;
  const curCpu = budgetCpuScore(oCpu, undefined, req.current?.cpu);
  const curIgpu = !oGpu && oCpu ? budgetIgpuScore(oCpu) : undefined;
  const curGpu = (oGpu ? budgetGpuScore(oGpu, req.res) : curIgpu) ?? req.current?.gpu;
  // Aproxima trabalho paralelo a partir de núcleos e threads. Cache extra de jogos não é ganho em todo trabalho.
  const workOf = (s: Specs, games: number) => s.cores && s.cores > 0
    ? Math.min(games, 150) * Math.sqrt((s.cores + 0.25 * Math.max(0, (s.threads ?? s.cores) - s.cores)) / 7.5)
    : games;
  const objectiveOf = (fps: number, work: number, gpu: number) => {
    if (profile === 'games') return fps;
    // Índice gráfico de 1080p como aproximação para cargas aceleradas, que não dependem do monitor.
    const task = req.workload === 'gpu' ? Math.sqrt(work * gpu) : work;
    return profile === 'productivity' ? task : Math.sqrt(fps * task);
  };
  /** Upgrade: a placa-mãe nova tem de caber no gabinete atual (que não conhecemos): até o formato da placa atual. */
  const maxBoard = upgrade ? (oMb?.formFactor ?? 'atx') : 'eatx';

  // ---------- Opções de processador (com o que cada uma arrasta junto) ----------
  function cpuOptions(tier: Tier): CpuOption[] {
    const out: CpuOption[] = [];
    if (upgrade && oCpu && curCpu) out.push({ specs: oCpu, perf: curCpu, work: workOf(oCpu, curCpu) * sustainedWorkFactor(cpuWatts(oCpu)), cost: 0, score: 0, notes: [] });
    /** Placa-mãe nova para o processador: a de menor preço de escolha com placa + memória. */
    const platform = memo((k) => {
      const [socket, family, high, power] = k.split('|');
      let best: Pick<CpuOption, 'board' | 'ram' | 'cost' | 'score' | 'notes'> | undefined;
      for (const b of P.motherboard) {
        const s = b.specs;
        if (s.socket !== socket || !s.chipset || !s.memory || !s.formFactor || rank(s.formFactor) > rank(maxBoard)) continue;
        if (chipsetSupport(s.chipset, family as Parameters<typeof chipsetSupport>[1]) !== 'ok') continue;
        const watts = Number(power);
        const tested = vrmTested(b, watts);
        const vrmKnown = b.offer.sheet?.vrmHeatsink === true;
        const phases = typeof b.offer.sheet?.vrmPhases === 'string' ? Number(/^\d+/.exec(b.offer.sheet.vrmPhases)?.[0]) : 0;
        // O dissipador informa a construção, mas sozinho não sustenta uma recomendação de carga alta.
        const highLoadEvidence = vrmKnown && phases >= 8;
        if (high === '1' && !tested && (ENTRY_CHIPSETS.has(s.chipset) || b.offer.sheet?.vrmHeatsink === false || (watts >= 200 && !highLoadEvidence))) continue;
        // Memória: a atual fica se for do tipo da placa; senão, um kit novo.
        const ownedRamFits = !s.memoryMaxGb || (oRam?.ramCapacity ?? 0) * (owned.ram?.qty ?? 1) <= s.memoryMaxGb;
        const keep = upgrade && oRam?.memory === s.memory && ownedRamFits;
        const ram = keep ? undefined : rams(`${s.memory}|${tier.ram}`)[0];
        if (!keep && !ram) continue;
        if (ram && s.memoryMaxGb && tier.ram > s.memoryMaxGb) continue;
        // PC inteiro: só placa com gabinete à venda no formato dela.
        if (!upgrade && (s.m2Slots === 0 || !cases(s.formFactor).length)) continue;
        const cost = b.price + (ram?.price ?? 0);
        const expansion = Number((s.memorySlots ?? 0) >= 4) + Number((s.m2Slots ?? 0) >= 2);
        const sustainedPenalty = !tested && Number(power) >= 200 ? (vrmKnown ? 0.05 : 0.10) : profile !== 'games' && high === '1' && !tested ? 0.05 : 0;
        const score = b.score * (1 + sustainedPenalty - expansion * 0.025) + (ram?.score ?? 0);
        if (!best || score < best.score || (score === best.score && vrmKnown && best.board?.offer.sheet?.vrmHeatsink !== true)) {
          best = { board: b, ram, cost, score, notes: [...(keep ? ['keeps-ram' as const] : []),
            ...(high === '1' && !tested && (!vrmKnown || Number(power) >= 200) ? ['vrm-unverified' as const] : [])] };
        }
      }
      return best;
    });
    for (const { p, perf } of cpus.values()) {
      const s = p.specs;
      const work = workOf(s, perf);
      if (upgrade && curCpu && oCpu && (profile === 'games' ? perf <= curCpu : work <= workOf(oCpu, curCpu) && perf <= curCpu)) continue;
      const family = cpuFamily(s)!;
      // Mesmo encaixe: fica a placa-mãe (se ela aceita o processador).
      const support = upgrade && oCpu && oMb?.chipset && s.socket === oCpu.socket ? chipsetSupport(oMb.chipset, family) : undefined;
      const reuse = reuseCooler(p);
      const box = !reuse && withBoxCooler(p);
      const needsCooler = !box && !reuse;
      const cooler = needsCooler ? coolers(coolerKey(p)).find((x) => coolerFitsCase(x.specs, owned.case?.specs)) : undefined;
      if (needsCooler && !cooler) { rejectedBuilds.noSuitableCooling++; continue; }
      const coolerNotes: BudgetNote[] = box ? ['box-cooler'] : [];
      if ((support === 'ok' || support === 'bios') && cpuWatts(s) < 200 && !(vrmDemand(p) && ENTRY_CHIPSETS.has(oMb!.chipset!))) {
        const notes: BudgetNote[] = [...coolerNotes];
        if (support === 'bios') notes.push('bios');
        if (vrmDemand(p)) notes.push('vrm-unverified');
        out.push({ cpu: p, specs: s, perf, work: work * sustainedWorkFactor(cpuWatts(s)), cost: p.price + (cooler?.price ?? 0), score: p.score + (cooler?.score ?? 0), cooler, notes });
        continue;
      }
      const plat = platform(`${s.socket}|${family}|${vrmDemand(p) ? 1 : 0}|${cpuWatts(s)}`);
      if (!plat) { rejectedBuilds.noSuitableBoard++; continue; }
      // Sem ensaio no modelo, o pico da CPU não conta integralmente em carga longa.
      const sustained = sustainedWorkFactor(cpuWatts(s), !!plat.board && vrmTested(plat.board, cpuWatts(s)));
      out.push({ cpu: p, specs: s, perf, work: work * sustained, ...plat, cooler, cost: p.price + plat.cost + (cooler?.price ?? 0), score: p.score + plat.score + (cooler?.score ?? 0), notes: [...plat.notes, ...coolerNotes] });
    }
    return out;
  }

  function gpuOptions(): GpuOption[] {
    const out = [...gpus.values()].flat().filter((g) => !upgrade || !curGpu || g.perf > curGpu);
    if (upgrade && curGpu && !curIgpu) out.unshift({ specs: oGpu, perf: curGpu });
    return out;
  }

  interface Combo {
    tier: Tier;
    c: CpuOption;
    g: GpuOption;
    /** Sem placa de vídeo: vídeo integrado. */
    igpu?: boolean;
    psu?: Product;
    ssd?: Product;
    pcase?: Product;
    cooler?: Product;
    cost: number;
    score: number;
    fps: number;
    objective: number;
    gpuPerf: number;
    psuUnknown?: boolean;
  }

  const gs = req.graphics === 'integrated' ? [] : gpuOptions();
  const storageOptions = upgrade ? [{ ssd: undefined, capacity: undefined }] : (profile === 'games' ? [2000, 1000, 500] : [4000, 2000, 1000, 500]).flatMap((capacity) => {
    const ssd = ssds(String(capacity))[0];
    return ssd ? [{ ssd, capacity }] : [];
  });
  function search(ram: number): Combo[] {
    if (!storageOptions.length) return [];
    const cs = cpuOptions({ ram });
    const combos: Combo[] = [];
    for (const c of cs) {
      const choices: (GpuOption & { igpu?: boolean })[] = [...gs];
      const integrated = budgetIgpuScore(c.specs, c.cpu?.offer.sheet);
      if (!req.requiredBrands?.gpu && req.graphics !== 'dedicated' && (!upgrade || !oGpu) && integrated !== undefined) choices.push({ perf: integrated, igpu: true });
      if (req.requiredBrands?.cpu && req.requiredBrands.cpu !== c.specs.cpuBrand) continue;
      for (const g of choices) {
        if (req.requiredBrands?.gpu && req.requiredBrands.gpu !== g.specs?.gpuMaker) continue;
        if (upgrade && !c.cpu && !g.gpu) continue; // nada muda
        const gPerf = g.perf;
        // Fonte: no PC inteiro, sempre; no upgrade, quando a atual não aguenta (ou é simples e a placa muda).
        const need = psuNeed(c.specs, g.specs, g.gpu?.offer.sheet, !!oPsu?.atx);
        const mustBuy = !upgrade || (!!oPsu?.watts && (oPsu.watts < need || (g.specs?.gpu16Pin === true && oPsu.pcie5 === false) || (!!g.gpu && basicPsu(oPsu))));
        const psu = mustBuy ? psuToBuy(c.specs, g.specs, g.gpu?.offer.sheet)[0] : undefined;
        if (mustBuy && !psu) continue;
        const psuUnknown = upgrade && !oPsu?.watts;
        const fps = g.igpu ? gPerf : budgetGamingScore(c.perf, gPerf, req.res, req.hz);
        const objective = objectiveOf(fps, c.work ?? c.perf, g.igpu ? gPerf : budgetGpuScore(g.specs, '1080p') ?? gPerf);
        if (objective <= 0 || (currentObjective !== undefined && objective < currentObjective * (1 + MIN_GAIN))) continue;
        // Gabinete (PC inteiro): ventilação conforme o consumo da placa de vídeo.
        // Já sem os que a placa de vídeo não cabe (pela ficha dos dois), para o custo ser o de verdade.
        const len = g.igpu ? undefined : g.specs?.gpuLength;
        let cooler = c.cooler;
        const gpuFitsCase = (s?: Specs) => !len || !s?.caseMaxGpu || s.caseMaxGpu >= len;
        if (upgrade && (!gpuFitsCase(owned.case?.specs) || !radiatorFitsGpu(owned.case?.specs, g.specs, cooler?.specs ?? oldCooler))) continue;
        const availableCases = upgrade ? [] : casesFor(c.board!.specs.formFactor!, Math.max(cpuWatts(c.specs), gpuWatts(g.specs, g.gpu?.offer.sheet)));
        const caseFor = (picked?: Product) => {
          const fits = (x: Product) => gpuFitsCase(x.specs) && coolerFitsCase(picked?.specs, x.specs) && radiatorFitsGpu(x.specs, g.specs, picked?.specs);
          return availableCases.find(fits);
        };
        let pcase = caseFor(cooler);
        if (!upgrade && !pcase && c.cpu && cooler) {
          for (const candidate of coolers(coolerKey(c.cpu))) {
            pcase = caseFor(candidate);
            if (!pcase) continue;
            cooler = candidate;
            break;
          }
        }
        if (!upgrade && !pcase) { rejectedBuilds.noSuitableCooling++; continue; }
        const caseQuality = (x: Product) => 2 * knownRoom(x.specs, g.specs, cooler?.specs) +
          Number(typeof x.offer.sheet?.front === 'string' && /mesh|perfurad/i.test(x.offer.sheet.front));
        const currentCaseQuality = pcase ? caseQuality(pcase) : 0;
        const roomier = pcase && currentCaseQuality < 5 ? availableCases.find((x) =>
          gpuFitsCase(x.specs) && coolerFitsCase(cooler?.specs, x.specs) && radiatorFitsGpu(x.specs, g.specs, cooler?.specs) &&
          caseQuality(x) > currentCaseQuality && !tightCase(x.specs, g.specs, cooler?.specs)) : undefined;
        const essentialCost = c.cost - (c.cooler?.price ?? 0) + (cooler?.price ?? 0) + (g.gpu?.price ?? 0) + (psu?.price ?? 0);
        const essentialScore = c.score - (c.cooler?.score ?? 0) + (cooler?.score ?? 0) + (g.gpu?.score ?? 0) + (psu?.score ?? 0);
        for (const selectedCase of roomier ? [pcase, roomier] : [pcase]) for (const { ssd, capacity } of storageOptions) {
          const baseCost = essentialCost + (selectedCase?.price ?? 0);
          const baseScore = essentialScore + (selectedCase?.score ?? 0);
          const cost = round2(baseCost + (ssd?.price ?? 0));
          const score = baseScore + (ssd?.score ?? 0);
          combos.push({ tier: { ram, ssd: capacity }, c, g, igpu: g.igpu, psu, ssd, pcase: selectedCase, cooler, cost, score, fps, objective, gpuPerf: gPerf, psuUnknown });
        }
      }
    }
    return combos;
  }

  /** Rendimento do PC atual (upgrade): só entram opções que rendem pelo menos MIN_GAIN a mais. */
  const curFps = upgrade && curCpu && curGpu ? (curIgpu ?? budgetGamingScore(curCpu, curGpu, req.res, req.hz)) : undefined;
  const currentObjective = oCpu && curCpu && curFps !== undefined ? objectiveOf(curFps, workOf(oCpu, curCpu) * sustainedWorkFactor(cpuWatts(oCpu)), budgetGpuScore(oGpu, '1080p') ?? curGpu!) : undefined;
  const validated = new WeakMap<Combo, BudgetOption>();
  const invalid = new WeakSet<Combo>();
  const verify = (x: Combo) => {
    if (invalid.has(x)) return false;
    if (validated.has(x)) return true;
    const plan = finalize(x, false);
    if (plan.issues.some((i) => i.level === 'error' || i.code === 'psu-tight')) {
      invalid.add(x);
      rejectedBuilds.incompatibility++;
      return false;
    }
    validated.set(x, plan);
    return true;
  };
  const emptyStatus = upgrade && currentObjective !== undefined && !req.requiredBrands?.cpu && !req.requiredBrands?.gpu ? 'no-gain' : 'no-data';
  const combos = (profile === 'games' || upgrade ? [32, 16] : [64, 32, 16]).flatMap(search);
  const gpuKey = (x: Combo) => (x.igpu ? 'igpu' : gpuVariant(x.g.specs));
  const cpuKey = (x: Combo) => `${x.c.specs.cpuLine} ${x.c.specs.cpuModel}`;
  const quality = (x: Combo) => {
    const board = x.c.board?.specs ?? oMb;
    const room = x.pcase ? knownRoom(x.pcase.specs, x.g.specs, x.cooler?.specs) : 0;
    return 2 * room + Number(board?.socket === 'AM5') + Number((board?.memorySlots ?? 0) >= 4) + Number((board?.m2Slots ?? 0) >= 2)
      + Number(x.c.board?.offer.sheet?.vrmHeatsink === true) + (x.psu ? psuEvidence(x.psu) : 0)
      + Number(x.cooler?.specs.coolerType === 'air' && Number(x.cooler.offer.sheet?.heatpipes) >= 4 && Number(x.cooler.offer.sheet?.fanMm) >= 120)
      + Number(typeof x.pcase?.offer.sheet?.front === 'string' && /mesh|perfurad/i.test(x.pcase.offer.sheet.front));
  };
  const preference = (x: Combo) => Number(!!req.preferences?.cpu && req.preferences.cpu === x.c.specs.cpuBrand)
    + Number(!!req.preferences?.gpu && req.preferences.gpu === x.g.specs?.gpuMaker);
  const supports = new Map(combos.map((x) => [x, { quality: quality(x), preference: preference(x) }]));
  const sortedByCost = [...combos].sort((a, b) => a.cost - b.cost);
  const ramOf = (x: Combo) => x.c.ram ? x.tier.ram : (oRam?.ramCapacity ?? 0) * (owned.ram?.qty ?? 1);
  const dominates = (p: Combo, x: Combo) => p.cost <= x.cost && p.objective >= x.objective &&
    (p.g.specs?.vram ?? 0) >= (x.g.specs?.vram ?? 0) && ramOf(p) >= ramOf(x) && (p.tier.ssd ?? 0) >= (x.tier.ssd ?? 0) &&
    supports.get(p)!.quality >= supports.get(x)!.quality && supports.get(p)!.preference >= supports.get(x)!.preference;
  const dominated = new WeakMap<Combo, boolean>();
  const undominated = (x: Combo) => {
    const known = dominated.get(x);
    if (known !== undefined) return !known;
    for (const p of sortedByCost) {
      if (p.cost > x.cost) break;
      if (p !== x && dominates(p, x) && !dominates(x, p) && verify(p)) {
        dominated.set(x, true);
        return false;
      }
    }
    dominated.set(x, false);
    return true;
  };

  return (budget, audit) => {
    const capacityCredit = (x: Combo, baselineCost: number) => {
      if (upgrade || x.cost > budget || baselineCost >= budget) return 0;
      const weights = CAPACITY_WEIGHT[profile];
      // Com desempenho alto, parte da folga pode elevar a disposição a pagar por capacidade.
      const surplus = budget - baselineCost;
      const preference = profile === 'productivity' ? 0.40 : 0.22;
      const allowance = Math.min(baselineCost * 0.60, surplus * preference) * Math.min(1, Math.max(0, (x.objective - 100) / 50));
      const credit = (baselineCost + allowance) * (weights.ram * capacityBenefit(x.tier.ram, 16) + weights.ssd * capacityBenefit(x.tier.ssd ?? 0, 500));
      const level = Math.min(1, x.objective / 100) + 0.30 * Math.min(1, Math.max(0, (x.objective - 150) / 75));
      return Math.min(budget - baselineCost, credit * level);
    };
    let bestObjective: number | undefined;
    const bestOf = (list: Combo[], eligible: (x: Combo) => boolean = () => true): Combo | undefined => {
      if (!list.length) return undefined;
      const strongest = list.reduce((a, b) => b.objective > a.objective ? b : a);
      const top = verify(strongest) ? strongest : [...list].sort((a, b) => b.objective - a.objective).find(verify);
      if (!top) return undefined;
      bestObjective ??= top.objective;
      const near = list.filter((x) => {
        if (x.objective >= top.objective * NEAR_BEST) return true;
        // Se só muda uma das peças principais, preço precisa compensar a perda estimada.
        const loss = 1 - x.objective / top.objective;
        return !x.igpu && !top.igpu && (gpuKey(x) === gpuKey(top) || cpuKey(x) === cpuKey(top)) &&
          loss <= 0.05 && (top.cost - x.cost) / top.cost >= loss * 2;
      });
      const baseline = near.find((x) => verify(x) && eligible(x));
      if (!baseline) return undefined;
      const adjusted = (x: Combo) => {
        const support = supports.get(x)!;
        const qualityCredit = support.quality * Math.min(1, x.objective / 100) * Math.min(baseline.cost * 0.006, Math.max(0, budget - baseline.cost));
        return x.cost - capacityCredit(x, baseline.cost) - qualityCredit - support.preference * baseline.cost * 0.02;
      };
      let winner = baseline;
      let winnerCost = adjusted(baseline);
      for (const x of near) {
        const cost = adjusted(x);
        const order = cost - winnerCost || x.cost - winner.cost || winner.objective - x.objective || x.score - winner.score;
        if (order < 0 && verify(x) && eligible(x)) {
          winner = x;
          winnerCost = cost;
        }
      }
      return winner;
    };
    if (!combos.length) return empty(budget, emptyStatus, audit === true ? { audit: { rejectedBuilds: { ...rejectedBuilds } } } : {});
    const fit = sortedByCost.filter((x) => x.cost <= budget);
    const first = bestOf(fit, undominated);
    if (!first) {
      const minimum = sortedByCost.find(verify);
      return minimum ? empty(budget, 'too-low', { minTotal: Math.ceil(minimum.cost) }) : empty(budget, emptyStatus);
    }

    if (audit === 'primary') return { status: 'ok', mode, profile, budget, ...validated.get(first)!, bestObjective, alternatives: [] };
    const picks = [first];
    const worthIt = (x: Combo) => picks.every((p) => !dominates(p, x) && (
      x.cost <= p.cost * 0.95 || x.objective >= p.objective * 1.03 || ramOf(x) > ramOf(p) ||
      (x.tier.ssd ?? 0) > (p.tier.ssd ?? 0) || (x.g.specs?.vram ?? 0) > (p.g.specs?.vram ?? 0) ||
      (x.cost <= p.cost * 1.05 && x.objective >= p.objective * NEAR_BEST &&
        (supports.get(x)!.quality >= supports.get(p)!.quality + 2 || supports.get(x)!.preference > supports.get(p)!.preference))));
    const stretch = bestOf(sortedByCost.filter((x) => x.cost > budget && x.cost <= budget * (1 + STRETCH) &&
      x.objective >= bestObjective! * (1 + STRETCH_GAIN) &&
      x.objective / first.objective - 1 >= (x.cost - first.cost) / first.cost), undominated);
    while (picks.length < OPTIONS - (stretch ? 1 : 0)) {
      const pool = fit.filter(worthIt);
      const next = bestOf(pool.filter((x) => !picks.some((p) => gpuKey(p) === gpuKey(x))), undominated) ??
        bestOf(pool.filter((x) => !picks.some((p) => cpuKey(p) === cpuKey(x))), undominated) ??
        bestOf(pool.filter((x) => picks.some((p) => cpuKey(p) === cpuKey(x) && gpuKey(p) === gpuKey(x) &&
          (ramOf(x) > ramOf(p) || (x.tier.ssd ?? 0) > (p.tier.ssd ?? 0) || supports.get(x)!.quality > supports.get(p)!.quality))), undominated);
      if (!next) break;
      picks.push(next);
    }
    if (stretch) picks.push(stretch);
    const [best, ...rest] = picks.map((combo): BudgetOption => ({ ...validated.get(combo)!, ...(combo.cost > budget && { stretch: true }) }));
    const strongest = (eligible: (x: Combo) => boolean) => {
      let top: Combo | undefined;
      for (const x of sortedByCost) {
        if (eligible(x) && (!top || x.objective > top.objective) && verify(x)) top = x;
      }
      return top && validated.get(top);
    };
    return { status: 'ok', mode, profile, budget, ...best!, bestObjective, alternatives: rest, ...(audit === true && {
      audit: {
        strongerWithinBudget: strongest((x) => x.cost <= budget && x.objective > first.objective),
        betterOutsideBudget: strongest((x) => x.cost > budget && x.objective > bestObjective!),
        rejectedBuilds: { ...rejectedBuilds },
      },
    }) };
  };

  /** A opção montada com as mesmas peças e preços usados na busca. */
  function finalize(combo: Combo, stretch: boolean): BudgetOption {
    const picked: Partial<Record<BuildSlot, Product>> = {};
    const c = combo.c;
    if (c.cpu) picked.cpu = c.cpu;
    if (c.board) picked.motherboard = c.board;
    if (c.ram) picked.ram = c.ram;
    if (combo.cooler) picked.cooler = combo.cooler;
    if (combo.pcase) picked.case = combo.pcase;
    if (combo.g.gpu) picked.gpu = combo.g.gpu;
    if (combo.psu) picked.psu = combo.psu;
    if (combo.ssd) picked.ssd = combo.ssd;
    const notes = new Set<BudgetNote>(c.notes);
    if (combo.igpu) notes.add('igpu');
    if (combo.psuUnknown) notes.add('psu-unknown');
    if (combo.g.specs?.gpu16Pin && combo.psu && typeof combo.psu.offer.sheet?.pcie16 !== 'number') notes.add('psu-connector');
    if (c.ram && combo.tier.ram === 16) notes.add('ram-16');
    if (combo.tier.ssd === 500) notes.add('ssd-500');
    if (!upgrade && (combo.tier.ram > 16 || (combo.tier.ssd ?? 0) > 500)) notes.add('capacity-value');
    if (tightCase(combo.pcase?.specs ?? owned.case?.specs, combo.g.specs, combo.cooler?.specs ?? oldCooler)) notes.add('case-clearance');
    if (combo.cooler && c.cpu) notes.add('cooling-estimate');

    const buildOf = (): Build => {
      const b: Build = {};
      for (const [slot, part] of Object.entries(owned) as [BuildSlot, NonNullable<Build[BuildSlot]>][]) b[slot] = { ...part, current: true };
      // Plataforma nova: a placa-mãe e o processador antigos saem (a memória só se foi trocada).
      for (const [slot, p] of Object.entries(picked) as [BuildSlot, Product][]) b[slot] = { specs: slot === 'psu' && psuAtx3(p) ? { ...p.specs, atx: p.specs.atx ?? '3.0' } : p.specs, ...(p.qty && { qty: p.qty }) };
      if (notes.has('box-cooler')) delete b.cooler;
      if (combo.igpu) delete b.gpu;
      return b;
    };

    const total = Object.values(picked).reduce((s, p) => s + p.price, 0);

    if (picked.ram?.qty) notes.add('ram-pair');
    const final = checkBuild(buildOf());
    const parts: BudgetOption['parts'] = {};
    for (const [slot, x] of Object.entries(picked) as [BuildSlot, Product][]) {
      parts[slot] = { price: round2(x.price), ...(x.qty && { qty: x.qty }), offer: x.offer, offers: x.offers, ...(x.offer.reference && { reference: x.offer.reference }) };
    }
    const cpuP = c.perf;
    const gpuP = combo.gpuPerf;
    return {
      parts,
      total: round2(total),
      cpu: Math.round(cpuP),
      gpu: Math.round(gpuP),
      ...(combo.igpu ? {} : { ratio: Math.round((budgetCpuCapacity(cpuP, req.res, req.hz) / gpuP) * 100) / 100 }),
      ...(currentObjective !== undefined && currentObjective > 0 && { gain: Math.round((combo.objective / currentObjective - 1) * 100) / 100 }),
      fps: Math.round(combo.fps * 10) / 10,
      objective: round2(combo.objective),
      work: round2(c.work ?? c.perf),
      ...(stretch && { stretch: true as const }),
      notes: [...notes],
      issues: final.issues.filter((i) => i.level !== 'info' || i.code === 'gpu-pcie-lanes'),
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
