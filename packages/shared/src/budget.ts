import { BUILD_SLOTS, checkBuild, coolerFits, type Build, type BuildIssue, type BuildSlot } from './compat.ts';
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
 * Entre as opções que cabem no orçamento, a de maior utilidade (índice do perfil contra o custo, com os benefícios de
 * capacidade e qualidade; ver `utility`): gastar mais só quando o ganho paga. Até OPTIONS opções, cada uma com um motivo
 * (mais desempenho no valor, mais barata, outra placa de vídeo ou outro processador); a última pode passar até 25% do
 * orçamento se render bem mais (STRETCH). Cada opção passa pela compatibilidade antes de entrar na resposta.
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
  /**
   * Carga de trabalho (Produtividade e Jogos e trabalho). Sem ela: uso geral (processador, com a placa de vídeo ajudando
   * até uma placa de entrada). cpu: multicore. gpu: renderização e modelagem 3D (acelerada pela placa). dev:
   * desenvolvimento e máquinas virtuais (processador e bastante memória). video: edição de vídeo (processador, placa e
   * armazenamento). ai: IA local (placa de vídeo e memória de vídeo; CUDA como preferência).
   */
  workload?: BudgetWorkloadKind;
  /** Peças que a pessoa já tem (upgrade). Sem processador nem placa de vídeo aqui: PC inteiro. */
  owned?: Build;
  /** Desempenho das peças atuais, calculado na tela (o processador pela ficha do modelo). */
  current?: { cpu?: number; gpu?: number };
}

export type BudgetWorkloadKind = 'cpu' | 'gpu' | 'dev' | 'video' | 'ai';
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
  'capacity-value' | 'case-clearance' | 'cooling-estimate' | 'more-ram' | 'ram-added' | 'keeps-ssd';

/**
 * Adequação de uma parte da configuração final (V6), separada da compatibilidade: confirmed (a ficha comprova: TDP declarado
 * do cooler acima da carga, potência da fonte acima da necessidade, VRM ensaiado), estimated (pela construção: heatpipes,
 * radiador, fases), insufficient (a ficha mostra que fica abaixo do que a configuração pede) e unknown (falta informação;
 * nunca vale como confirmação).
 */
export type BudgetAdequacy = 'confirmed' | 'estimated' | 'insufficient' | 'unknown';
/** Motivo de cada opção do plano (V6): recomendada, maior desempenho, custo-benefício, econômica, outra peça principal ou acima do valor. */
export type BudgetReason = 'recommended' | 'max-performance' | 'value' | 'economy' | 'alternative' | 'stretch';

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
  /**
   * Utilidade da opção (V5): ln(índice) − peso·ln(custo [+ valor do PC atual]) + benefícios de capacidade, qualidade e marca.
   * Compara opções do mesmo pedido (não entre pedidos): a recomendada é a de maior utilidade.
   */
  utility?: number;
  /** V6: por que a opção está no plano. */
  reason?: BudgetReason;
  /** V6: adequação da configuração final (inclui as peças que ficam no upgrade). */
  adequacy?: Partial<Record<'cooler' | 'psu' | 'vrm' | 'ram' | 'storage' | 'case', BudgetAdequacy>>;
  /** V6: memória e armazenamento da configuração final (GB; inclui o que fica e o que é somado no upgrade). */
  final?: { ramGb?: number; storageGb?: number; storageKind?: 'nvme' | 'sata' | 'unknown' };
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
  /** V6, upgrade: o PC como está (índice e utilidade de não trocar), para separar antes, depois e o ganho incremental. */
  current?: { objective: number; utility: number };
  /** V6: tamanho da busca (combinações geradas) e motivos de descarte, para medir a otimização. */
  stats?: { candidates: number; rejectedBuilds: { incompatibility: number; noSuitableCooling: number; noSuitableBoard: number } };
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
/** Duas opções com índices a menos disto de distância contam como empatadas (alternativas e qualidade). */
const NEAR_BEST = 0.97;
/** Peso do preço na utilidade: pagar x% a mais vale quando o índice sobe pelo menos isto vezes x% (10% a mais por 2,4%). */
const PRICE_WEIGHT = 0.25;
/**
 * Fração do custo que vale pagar a mais por ponto de qualidade da plataforma e por marca preferida (a preferência vale
 * até 10% a mais no preço, ou ~2,5% de desempenho; acima disso, ganha a outra marca; a exigência obriga).
 */
const QUALITY_VALUE = 0.006;
const PREFERENCE_VALUE = 0.1;
/**
 * Memória que o trabalho pede (GB por thread do processador): abaixo disso, a memória vale negativo; acima, com retorno
 * decrescente. Jogos: 16 GB de base. Multiplicadores por carga (máquinas virtuais pedem mais).
 */
const RAM_PER_THREAD: Record<BudgetProfile, number> = { games: 0, mixed: 0.75, productivity: 1 };
const WORKLOAD_RAM: Partial<Record<BudgetWorkloadKind, number>> = { dev: 1.5 };
/**
 * V5: piso de memória por carga, além da conta por thread (que é só uma estimativa de partida, não o consumo dos programas).
 * Edição de vídeo e renderização 3D: 32 GB (timeline em 4K, cenas e texturas). IA local: o dobro da memória de vídeo (o
 * modelo carrega pela memória do sistema e o que não cabe na placa fica nela), pelo menos 32 GB.
 */
const WORKLOAD_RAM_FLOOR: Partial<Record<BudgetWorkloadKind, number>> = { video: 32, gpu: 32, ai: 32 };
/** Armazenamento: peso extra por carga (vídeo bruto e projetos ocupam muito). */
const WORKLOAD_SSD: Partial<Record<BudgetWorkloadKind, number>> = { video: 1.5, dev: 1.2 };
/** Uso geral: a placa de vídeo ajuda até este índice (uma placa de entrada); acima disso, não faz diferença. */
const GENERAL_GPU_CAP = 100;
/**
 * V5: quanto vale, em reais, cada ponto de índice do PC atual (o que custaria comprar esse desempenho novo). No catálogo
 * de nov/2026, um PC novo entrega em média ~19 pontos por R$ 1.000. No upgrade, a utilidade conta o custo sobre o valor do
 * PC que fica (pontos atuais × isto) mais a compra: escala que não depende do orçamento. Substitui o limite fixo de 4
 * pontos por R$ 1.000 da V4 (que pesava igual num PC de índice 20 e num de 200): a troca precisa ter utilidade maior que a
 * de não trocar, e perto do índice 100 isso dá o mesmo ~4% por R$ 1.000 da V4.
 */
const BRL_PER_POINT = 1000 / 19;
/** Valor mínimo do PC atual na escala (PC muito fraco ou sem índice): evita que qualquer troca pareça barata demais. */
const MIN_OWNED_VALUE = 500;
/**
 * Upgrade: ganho relativo mínimo por R$ 1.000 (0.04 = 4% do índice atual). É o limite da V4 (4 pontos por R$ 1.000) no índice
 * 100, sem depender da escala: num PC de índice 20 ou 200 vale a mesma proporção. Junto com a utilidade maior que a de não
 * trocar (a utilidade sozinha aceitava gastar muito acima do valor do PC por pouco).
 */
const MIN_UPGRADE_RATE = 0.04;
/** Placas-mãe por plataforma e forma de memória na busca (a mais barata e as de construção melhor que valham a mais). */
const PLATFORM_BOARDS = 2;
/**
 * V6: armazenamento pelo tipo do disco principal, além da capacidade total: NVMe meia duplicação, SATA um quarto. A ficha não
 * distingue HDD; disco sem interface informada fica sem bônus (pode ser HDD) e não conta como SSD.
 */
const DRIVE_VALUE = { nvme: 0.5, sata: 0.25, unknown: 0 } as const;
/** Capacidade em montagem forte: vale até isto a mais (índice 150 ou mais) do que numa de índice 100. */
const CAPACITY_LEVEL = 0.3;
/** Alternativas: a de mais desempenho entra quando rende pelo menos isto a mais; a mais barata, quando economiza isto. */
const STRONGER_GAIN = 0.01;
const CHEAPER_SAVING = 0.1;
/** V6: custo-benefício só entre as que entregam pelo menos isto do índice da recomendada (senão seria sempre a mais simples). */
const VALUE_SHARE = 0.85;
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

/**
 * Os produtos que o motor considera para uma peça, na ordem em que ele escolhe: só da própria loja, uma entrada por
 * produto (a mais barata entre as lojas) e a preferência das marcas (BUDGET_BRANDS). As dicas de memória, fonte e
 * SSD do Identificar gargalo usam a mesma lista.
 */
export function budgetProducts(slot: BuildSlot, offers: BudgetOffer[] | undefined, now = Date.now(), mode: BudgetMode = 'buyable'): { price: number; offer: BudgetOffer; offers: Offer[] }[] {
  return productsOf(slot, offers, now, mode).map(({ price, offer, offers: all }) => ({ price, offer, offers: all }));
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
  /** V6: memória final quando o kit é somado à atual (slots livres), não trocado. */
  ramTotal?: number;
  cooler?: Product;
  /** V6: cooler com mais evidência térmica que o mais barato que passa (fronteira preço × folga). */
  altCooler?: Product;
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

/**
 * O motor preparado: dá o plano para um valor e, sem valor nenhum, todas as opções que ele considera válidas
 * (compatíveis, com o ganho mínimo no upgrade), da mais barata à mais cara. As dicas do Identificar gargalo
 * escolhem entre essas opções (picks.ts).
 */
export type BudgetPlanner = ((budget: number, audit?: boolean | 'primary') => BudgetPlan) & { options: () => BudgetOption[] };

/** Reaproveita as mesmas candidatas e checagens quando só muda o valor disponível. */
export function prepareBudget(req: Omit<BudgetRequest, 'budget'>, offers: Partial<Record<BuildSlot, BudgetOffer[]>>, now = Date.now()): BudgetPlanner {
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
  if (!upgrade && (!P.cpu.length || !P.psu.length)) return Object.assign((budget: number) => empty(budget, 'no-data'), { options: () => [] });

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
  /**
   * V6: evidência térmica do cooler para a carga (0 a 4): TDP declarado com folga de 25% (2) ou só acima da carga (1);
   * construção que a ficha comprova (radiador de 280 mm ou mais acima de 200 W, 240 mm abaixo; air com 6 heatpipes acima de
   * 145 W, 4 abaixo, e ventoinha de 120 mm). Preço e marca não entram.
   */
  const coolerEvidence = (x: Product, load: number) => {
    const s = x.specs;
    const sheet = x.offer.sheet;
    let e = s.coolerTdp === undefined ? 0 : s.coolerTdp >= load * 1.25 ? 2 : s.coolerTdp >= load ? 1 : 0;
    if (s.coolerType === 'water') e += Number((s.radiator ?? 0) >= (load > 200 ? 280 : 240)) + Number((s.radiator ?? 0) >= 360);
    else e += Number(Number(sheet?.heatpipes) >= (load > 145 ? 6 : 4)) + Number(Number(sheet?.fanMm) >= 120 && Number(sheet?.fans) >= 2);
    return Math.min(4, e);
  };
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
  /** A carga de trabalho do pedido (quem pede só vídeo integrado já disse que não vai acelerar pela placa: processador). */
  const workload = req.workload ?? (req.graphics === 'integrated' ? 'cpu' : undefined);
  /**
   * Índice de trabalho pela carga. O índice gráfico de 1080p aproxima as cargas aceleradas (não dependem do monitor; a
   * resolução e a frequência só entram em jogos). Não é desempenho profissional medido: só a parte gráfica da conta.
   */
  const taskOf = (work: number, gpu: number, vram?: number) => {
    switch (workload) {
      case 'cpu': case 'dev': return work;
      case 'gpu': return Math.sqrt(work * gpu);
      case 'video': return Math.pow(work, 0.75) * Math.pow(gpu, 0.25);
      // IA local: a placa e a memória de vídeo mandam (o modelo tem de caber nela); 8 GB de base, até o dobro do valor.
      case 'ai': return Math.pow(work, 0.2) * Math.pow(gpu * Math.min(2, Math.max(0.25, (vram ?? 2) / 8)), 0.8);
      // Uso geral: o processador manda; a placa ajuda até uma de entrada.
      default: return Math.pow(work, 0.8) * Math.pow(Math.min(gpu, GENERAL_GPU_CAP), 0.2);
    }
  };
  const objectiveOf = (fps: number, work: number, gpu: number, vram?: number) => {
    if (profile === 'games') return fps;
    const task = taskOf(work, gpu, vram);
    return profile === 'productivity' ? task : Math.sqrt(fps * task);
  };
  /** Memória que a configuração pede (GB): 16 de base; no trabalho, proporcional às threads do processador. */
  const ramNeed = (cpu: Specs, vram?: number) => Math.max(16, (cpu.threads ?? cpu.cores ?? 0) * RAM_PER_THREAD[profile] * (workload ? WORKLOAD_RAM[workload] ?? 1 : 1),
    workload ? WORKLOAD_RAM_FLOOR[workload] ?? 0 : 0, workload === 'ai' ? 2 * (vram ?? 0) : 0,
    // V6: jogos e misto pela configuração, não pelo orçamento: placa com muita memória de vídeo é feita para texturas e telas
    // maiores, em que 32 GB de memória do sistema evitam engasgos (o dobro da memória de vídeo, até 32 GB).
    profile !== 'productivity' ? Math.min(32, 2 * (vram ?? 0)) : 0);
  /** Memória que o PC atual tem (GB, capacidade do produto × unidades); 0 = não informada. */
  const ownedRam = (oRam?.ramCapacity ?? 0) * (owned.ram?.qty ?? 1);
  /**
   * V5: armazenamento pela capacidade e pelo tipo (NVMe vale meia duplicação a mais que SATA). No PC inteiro é sempre NVMe
   * (a parcela é igual em todas as opções); no upgrade, compara o SSD novo com o atual.
   */
  const storageValue = (capacity: number, kind: keyof typeof DRIVE_VALUE) => capacityBenefit(capacity, 500) + DRIVE_VALUE[kind];
  const driveKind = (d?: Specs): keyof typeof DRIVE_VALUE => d?.ssdInterface === 'nvme' ? 'nvme' : d?.ssdInterface === 'sata' ? 'sata' : 'unknown';
  const oSsd = owned.ssd?.specs;
  /** V6: capacidade de todos os discos atuais (o principal e os extras), só os com capacidade informada. */
  const extraGb = (owned.extraDrives ?? []).reduce((t, d) => t + (d.specs.ssdCapacity ?? 0), 0);
  const ownedGb = (oSsd?.ssdCapacity ?? 0) + extraGb;
  const ownedStorage = oSsd?.ssdCapacity ? storageValue(ownedGb, driveKind(oSsd)) : undefined;
  /**
   * V6: o SSD atual fica como disco extra quando o SSD novo entra (soma a capacidade), se houver onde ligar: SATA usa uma
   * porta SATA; NVMe precisa de um segundo M.2 na placa que fica (sem a informação, troca).
   */
  const keepsOldDrive = (board?: Specs) => !!oSsd?.ssdCapacity && (oSsd.ssdInterface !== 'nvme' || (board?.m2Slots ?? 0) >= 2);
  /**
   * Valor da memória perto do que a configuração pede: com retorno decrescente acima e negativo abaixo, cada metade a menos
   * pesando o mesmo (V6: antes parava em −2, e 8 GB e 16 GB valiam igual quando a configuração pedia 32).
   */
  const memValue = (capacity: number, need: number) => capacity >= need ? 2 * (1 - need / capacity) : Math.max(-6, -2 * Math.log2(need / Math.max(capacity, 1)));
  /** Upgrade: a placa-mãe nova tem de caber no gabinete atual (que não conhecemos): até o formato da placa atual. */
  const maxBoard = upgrade ? (oMb?.formFactor ?? 'atx') : 'eatx';

  /** Kit maior que a memória atual para a placa que fica (só com a memória atual informada e dentro do máximo da placa). */
  const moreRam = (board: Specs | undefined, cap: number) => board?.memory && oRam?.ramCapacity && cap > ownedRam && (!board.memoryMaxGb || cap <= board.memoryMaxGb)
    ? rams(`${board.memory}|${cap}`)[0] : undefined;
  /**
   * V6: somar memória sem trocar a atual, quando a placa que fica tem slots livres (informados) para mais 2 pentes: um kit da
   * mesma capacidade e tipo, dobrando o total. Pentes de kits diferentes podem rodar na frequência do mais lento (nota).
   */
  const ownedModules = (oRam?.ramModules ?? 0) * (owned.ram?.qty ?? 1);
  const addRam = (board: Specs | undefined) => {
    const slots = board?.memorySlots ?? (board?.formFactor === 'atx' ? 4 : undefined);
    if (!board?.memory || !oRam?.ramCapacity || oRam.memory !== board.memory || !ownedModules || !slots || ownedModules + 2 > slots) return undefined;
    if (board.memoryMaxGb && ownedRam * 2 > board.memoryMaxGb) return undefined;
    return rams(`${board.memory}|${ownedRam}`)[0];
  };

  // ---------- Opções de processador (com o que cada uma arrasta junto) ----------
  function cpuOptions(tier: Tier): CpuOption[] {
    const out: CpuOption[] = [];
    if (upgrade && oCpu && curCpu) {
      out.push({ specs: oCpu, perf: curCpu, work: workOf(oCpu, curCpu), cost: 0, score: 0, notes: [] });
      // Mais memória na mesma placa: sozinha (quando a atual fica abaixo do que o processador e a carga pedem) ou junto com a
      // placa de vídeo nova (V5: a utilidade decide). Memória atual desconhecida não é zero: sem ela informada, não sugere.
      const ram = moreRam(oMb, tier.ram);
      if (ram) out.push({ specs: oCpu, perf: curCpu, work: workOf(oCpu, curCpu), ram, cost: ram.price, score: ram.score, notes: ['more-ram'] });
      // V6: somar um kit à memória atual (uma vez: na faixa de 32 GB, que existe em todos os perfis).
      const added = tier.ram === 32 ? addRam(oMb) : undefined;
      if (added) out.push({ specs: oCpu, perf: curCpu, work: workOf(oCpu, curCpu), ram: added, ramTotal: ownedRam * 2, cost: added.price, score: added.score, notes: ['ram-added'] });
    }
    /**
     * Placa-mãe nova para o processador (com a memória). V5: em vez de uma só por plataforma, a fronteira de Pareto entre
     * preço de escolha e construção (VRM com evidência, 4 slots de memória, 2 M.2): a mais barata e, se houver, a de melhor
     * construção que custa mais (até PLATFORM_BOARDS). No upgrade, manter a memória atual (se servir) e um kit novo são
     * opções separadas: reaproveitar é uma vantagem de preço, não uma regra (a utilidade decide).
     */
    const platform = memo((k) => {
      const [socket, family, high, power] = k.split('|');
      const watts = Number(power);
      const found: (Pick<CpuOption, 'board' | 'ram' | 'cost' | 'score' | 'notes'> & { build: number })[] = [];
      for (const b of P.motherboard) {
        const s = b.specs;
        if (s.socket !== socket || !s.chipset || !s.memory || !s.formFactor || rank(s.formFactor) > rank(maxBoard)) continue;
        if (chipsetSupport(s.chipset, family as Parameters<typeof chipsetSupport>[1]) !== 'ok') continue;
        const tested = vrmTested(b, watts);
        const vrmKnown = b.offer.sheet?.vrmHeatsink === true;
        const phases = typeof b.offer.sheet?.vrmPhases === 'string' ? Number(/^\d+/.exec(b.offer.sheet.vrmPhases)?.[0]) : 0;
        // O dissipador informa a construção, mas sozinho não sustenta uma recomendação de carga alta.
        const highLoadEvidence = vrmKnown && phases >= 8;
        if (high === '1' && !tested && (ENTRY_CHIPSETS.has(s.chipset) || b.offer.sheet?.vrmHeatsink === false || (watts >= 200 && !highLoadEvidence))) continue;
        // PC inteiro: só placa com gabinete à venda no formato dela.
        if (!upgrade && (s.m2Slots === 0 || !cases(s.formFactor).length)) continue;
        const expansion = Number((s.memorySlots ?? 0) >= 4) + Number((s.m2Slots ?? 0) >= 2);
        const sustainedPenalty = !tested && watts >= 200 ? (vrmKnown ? 0.05 : 0.10) : profile !== 'games' && high === '1' && !tested ? 0.05 : 0;
        const boardScore = b.score * (1 + sustainedPenalty - expansion * 0.025);
        const build = expansion + Number(vrmKnown) + Number(highLoadEvidence || tested);
        const vrmNote: BudgetNote[] = high === '1' && !tested && (!vrmKnown || watts >= 200) ? ['vrm-unverified'] : [];
        // Memória: a atual fica se for do tipo da placa (e couber nela); um kit novo é outra opção.
        const keep = upgrade && !!oRam?.ramCapacity && oRam.memory === s.memory && (!s.memoryMaxGb || ownedRam <= s.memoryMaxGb);
        const kit = !keep || tier.ram > ownedRam ? rams(`${s.memory}|${tier.ram}`)[0] : undefined;
        const fitsKit = kit && !(s.memoryMaxGb && tier.ram > s.memoryMaxGb) ? kit : undefined;
        if (keep) found.push({ board: b, cost: b.price, score: boardScore, build, notes: ['keeps-ram', ...vrmNote] });
        if (fitsKit) found.push({ board: b, ram: fitsKit, cost: b.price + fitsKit.price, score: boardScore + fitsKit.score, build, notes: vrmNote });
      }
      found.sort((x, y) => x.score - y.score || y.build - x.build);
      // Por forma de memória (mantida ou nova): a mais barata e as de construção melhor que todas as mais baratas.
      const out: Pick<CpuOption, 'board' | 'ram' | 'cost' | 'score' | 'notes'>[] = [];
      for (const keepRam of [true, false]) {
        let bestBuild = -1;
        let taken = 0;
        for (const f of found) {
          if (!!f.ram === keepRam || taken >= PLATFORM_BOARDS || f.build <= bestBuild) continue;
          bestBuild = f.build;
          taken++;
          out.push({ board: f.board, ram: f.ram, cost: f.cost, score: f.score, notes: f.notes });
        }
      }
      return out;
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
      // V6: o primeiro (mais barato) com evidência térmica maior que o escolhido, para a utilidade comparar (sem forçar).
      const load = coolingLoad(p);
      const altCooler = cooler ? coolers(coolerKey(p)).find((x) => coolerEvidence(x, load) > coolerEvidence(cooler, load) && coolerFitsCase(x.specs, owned.case?.specs)) : undefined;
      const coolerNotes: BudgetNote[] = box ? ['box-cooler'] : [];
      if ((support === 'ok' || support === 'bios') && cpuWatts(s) < 200 && !(vrmDemand(p) && ENTRY_CHIPSETS.has(oMb!.chipset!))) {
        const notes: BudgetNote[] = [...coolerNotes];
        if (support === 'bios') notes.push('bios');
        if (vrmDemand(p)) notes.push('vrm-unverified');
        out.push({ cpu: p, specs: s, perf, work, cost: p.price + (cooler?.price ?? 0), score: p.score + (cooler?.score ?? 0), cooler, altCooler, notes });
        // V5: o processador novo com mais memória na mesma placa (a utilidade decide se vale).
        const ram = moreRam(oMb, tier.ram);
        if (ram) out.push({ cpu: p, specs: s, perf, work, ram, cost: p.price + ram.price + (cooler?.price ?? 0), score: p.score + ram.score + (cooler?.score ?? 0), cooler, altCooler, notes: [...notes, 'more-ram'] });
        // V6: ou somando um kit à memória atual.
        const added = tier.ram === 32 ? addRam(oMb) : undefined;
        if (added) out.push({ cpu: p, specs: s, perf, work, ram: added, ramTotal: ownedRam * 2, cost: p.price + added.price + (cooler?.price ?? 0), score: p.score + added.score + (cooler?.score ?? 0), cooler, altCooler, notes: [...notes, 'ram-added'] });
        continue;
      }
      const plats = platform(`${s.socket}|${family}|${vrmDemand(p) ? 1 : 0}|${cpuWatts(s)}`);
      if (!plats.length) { rejectedBuilds.noSuitableBoard++; continue; }
      for (const plat of plats) {
        out.push({ cpu: p, specs: s, perf, work, ...plat, cooler, altCooler, cost: p.price + plat.cost + (cooler?.price ?? 0), score: p.score + plat.score + (cooler?.score ?? 0), notes: [...plat.notes, ...coolerNotes] });
      }
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
  const capacities = profile === 'games' ? [2000, 1000, 500] : [4000, 2000, 1000, 500];
  /**
   * SSD: no PC inteiro, um NVMe por capacidade. V5: no upgrade, manter o atual ou um NVMe maior (ou NVMe no lugar de um SATA),
   * só com o SSD atual informado (sem ele, não dá para saber se é melhor).
   */
  const storageOptions: { ssd?: Product; capacity?: number }[] = upgrade
    // V6: o SSD novo soma ao atual quando ele fica como extra (keepsOldDrive), então qualquer NVMe de 1 TB ou mais pode valer.
    ? [{}, ...(oSsd?.ssdCapacity ? capacities.filter((c) => c >= 1000).flatMap((capacity) => {
      const ssd = ssds(String(capacity))[0];
      return ssd ? [{ ssd, capacity }] : [];
    }) : [])]
    : capacities.flatMap((capacity) => {
      const ssd = ssds(String(capacity))[0];
      return ssd ? [{ ssd, capacity }] : [];
    });
  /** Armazenamento atual que limita: menos de 1 TB, ou SATA para edição de vídeo e programação (projetos grandes). */
  const storageLimits = !!oSsd?.ssdCapacity && (ownedGb < 1000 * 0.9 || driveKind(oSsd) === 'unknown' || (oSsd.ssdInterface !== 'nvme' && (workload === 'video' || workload === 'dev')));
  /** Memória atual abaixo do que o processador e a carga pedem. */
  const memoryLimits = !!oCpu && !!ownedRam && ownedRam < ramNeed(oCpu, oGpu?.vram);
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
        // Upgrade sem processador nem placa de vídeo: só memória e/ou SSD, quando o atual limita (V5: complementar, sem ganho de FPS).
        const complementOnly = upgrade && !c.cpu && !g.gpu;
        if (complementOnly && !(c.ram ? memoryLimits : storageLimits)) continue;
        const gPerf = g.perf;
        // Fonte: no PC inteiro, sempre; no upgrade, quando a atual não aguenta (ou é simples e a placa muda).
        const need = psuNeed(c.specs, g.specs, g.gpu?.offer.sheet, !!oPsu?.atx);
        const mustBuy = !upgrade || (!!oPsu?.watts && (oPsu.watts < need || (g.specs?.gpu16Pin === true && oPsu.pcie5 === false) || (!!g.gpu && basicPsu(oPsu))));
        const psu = mustBuy ? psuToBuy(c.specs, g.specs, g.gpu?.offer.sheet)[0] : undefined;
        if (mustBuy && !psu) continue;
        const psuUnknown = upgrade && !oPsu?.watts;
        const fps = g.igpu ? gPerf : budgetGamingScore(c.perf, gPerf, req.res, req.hz);
        const objective = objectiveOf(fps, c.work ?? c.perf, g.igpu ? gPerf : budgetGpuScore(g.specs, '1080p') ?? gPerf, g.igpu ? undefined : g.specs?.vram);
        // Upgrade: rende pelo menos MIN_GAIN a mais, ou é só mais memória para o que o processador e a carga pedem.
        if (objective <= 0 || (currentObjective !== undefined && !complementOnly && objective < currentObjective * (1 + MIN_GAIN))) continue;
        // Gabinete (PC inteiro): ventilação conforme o consumo da placa de vídeo.
        // Já sem os que a placa de vídeo não cabe (pela ficha dos dois), para o custo ser o de verdade.
        const len = g.igpu ? undefined : g.specs?.gpuLength;
        const gpuFitsCase = (s?: Specs) => !len || !s?.caseMaxGpu || s.caseMaxGpu >= len;
        // V6: o cooler mais barato que passa e, se houver, o de mais evidência térmica (a utilidade decide; sem diversidade forçada).
        let placed = false;
        for (const coolerChoice of c.altCooler ? [c.cooler, c.altCooler] : [c.cooler]) {
          let cooler = coolerChoice;
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
          if (!upgrade && !pcase) continue;
          placed = true;
          const caseQuality = (x: Product) => 2 * knownRoom(x.specs, g.specs, cooler?.specs) + Number((x.specs.caseFans ?? 0) >= 3) +
            Number(typeof x.offer.sheet?.front === 'string' && /mesh|perfurad/i.test(x.offer.sheet.front));
          const currentCaseQuality = pcase ? caseQuality(pcase) : 0;
          const roomier = pcase && currentCaseQuality < 6 ? availableCases.find((x) =>
            gpuFitsCase(x.specs) && coolerFitsCase(cooler?.specs, x.specs) && radiatorFitsGpu(x.specs, g.specs, cooler?.specs) &&
            caseQuality(x) > currentCaseQuality && !tightCase(x.specs, g.specs, cooler?.specs)) : undefined;
          const essentialCost = c.cost - (c.cooler?.price ?? 0) + (cooler?.price ?? 0) + (g.gpu?.price ?? 0) + (psu?.price ?? 0);
          const essentialScore = c.score - (c.cooler?.score ?? 0) + (cooler?.score ?? 0) + (g.gpu?.score ?? 0) + (psu?.score ?? 0);
          for (const selectedCase of roomier ? [pcase, roomier] : [pcase]) for (const { ssd, capacity } of storageOptions) {
            if (complementOnly && !c.ram && !ssd) continue; // nada muda
            const baseCost = essentialCost + (selectedCase?.price ?? 0);
            const baseScore = essentialScore + (selectedCase?.score ?? 0);
            const cost = round2(baseCost + (ssd?.price ?? 0));
            const score = baseScore + (ssd?.score ?? 0);
            combos.push({ tier: { ram, ssd: capacity }, c, g, igpu: g.igpu, psu, ssd, pcase: selectedCase, cooler, cost, score, fps, objective, gpuPerf: gPerf, psuUnknown });
          }
        }
        if (!upgrade && !placed) rejectedBuilds.noSuitableCooling++;
      }
    }
    return combos;
  }

  /** Rendimento do PC atual (upgrade): só entram opções que rendem pelo menos MIN_GAIN a mais. */
  const curFps = upgrade && curCpu && curGpu ? (curIgpu ?? budgetGamingScore(curCpu, curGpu, req.res, req.hz)) : undefined;
  const currentObjective = oCpu && curCpu && curFps !== undefined ? objectiveOf(curFps, workOf(oCpu, curCpu), budgetGpuScore(oGpu, '1080p') ?? curGpu!, oGpu?.vram) : undefined;
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
  // V5: o upgrade de produtividade também considera 64 GB (antes só 32 e 16).
  const combos = (profile === 'games' ? [32, 16] : [64, 32, 16]).flatMap(search);
  const gpuKey = (x: Combo) => (x.igpu ? 'igpu' : gpuVariant(x.g.specs));
  const cpuKey = (x: Combo) => `${x.c.specs.cpuLine} ${x.c.specs.cpuModel}`;
  const quality = (x: Combo) => {
    const board = x.c.board?.specs ?? oMb;
    const room = x.pcase ? knownRoom(x.pcase.specs, x.g.specs, x.cooler?.specs) : 0;
    return 2 * room + Number(board?.socket === 'AM5') + Number((board?.memorySlots ?? 0) >= 4) + Number((board?.m2Slots ?? 0) >= 2)
      + Number(x.c.board?.offer.sheet?.vrmHeatsink === true) + (x.psu ? psuEvidence(x.psu) : 0)
      // V6: o cooler pela evidência térmica para a carga (até 2 pontos) e o gabinete também pela ventilação (3 ventoinhas).
      + (x.cooler && x.c.cpu ? Math.min(2, coolerEvidence(x.cooler, coolingLoad(x.c.cpu))) : 0)
      + Number((x.pcase?.specs.caseFans ?? 0) >= 3)
      + Number(typeof x.pcase?.offer.sheet?.front === 'string' && /mesh|perfurad/i.test(x.pcase.offer.sheet.front));
  };
  // IA local: sem preferência informada, a placa NVIDIA (CUDA, o que a maior parte dos programas usa) conta como preferida.
  const preferences = req.preferences ?? (workload === 'ai' ? { gpu: 'nvidia' as const } : undefined);
  const preference = (x: Combo) => Number(!!preferences?.cpu && preferences.cpu === x.c.specs.cpuBrand)
    + Number(!!preferences?.gpu && preferences.gpu === x.g.specs?.gpuMaker);
  const supports = new Map(combos.map((x) => [x, { quality: quality(x), preference: preference(x) }]));
  const sortedByCost = [...combos].sort((a, b) => a.cost - b.cost);
  /** Memória da configuração final (GB): o kit novo, o kit somado à atual ou a atual. */
  const ramOf = (x: Combo) => x.c.ramTotal ?? (x.c.ram ? x.tier.ram : ownedRam);
  /** V6: armazenamento final (GB): o SSD novo mais os discos que ficam (o atual, se ainda tiver onde ligar, e os extras). */
  const storageGbOf = (x: Combo) => x.ssd ? (x.tier.ssd ?? 0) + (keepsOldDrive(x.c.board?.specs ?? oMb) ? ownedGb : extraGb) : upgrade ? ownedGb : 0;
  const storageOf = (x: Combo) => x.ssd ? storageValue(storageGbOf(x), 'nvme') : ownedStorage ?? 0;
  const dominates = (p: Combo, x: Combo) => p.cost <= x.cost && p.objective >= x.objective &&
    (p.g.specs?.vram ?? 0) >= (x.g.specs?.vram ?? 0) && ramOf(p) >= ramOf(x) && storageOf(p) >= storageOf(x) &&
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

  /**
   * V5: valor do PC atual na escala da utilidade (o que custaria comprar o desempenho dele novo). O custo do upgrade conta
   * sobre esse valor mais a compra, não sobre o orçamento: a nota de cada opção não muda com o valor disponível (mais
   * dinheiro nunca dá uma escolha pior) e um orçamento enorme não faz a troca mais cara parecer barata.
   */
  const ownedValue = upgrade ? Math.max(MIN_OWNED_VALUE, (currentObjective ?? 0) * BRL_PER_POINT) : 0;
  /**
   * Utilidade de uma opção: ln(índice do perfil) − PRICE_WEIGHT·ln(custo) + PRICE_WEIGHT·benefícios. Vale pagar x% a mais
   * quando o índice sobe pelo menos PRICE_WEIGHT·x%. Os benefícios estão em fração do custo que vale pagar por eles:
   * capacidade (memória e armazenamento, pelo perfil, pelo que o processador e a carga pedem e pelo nível da montagem; no
   * upgrade, contra o que o PC já tem), qualidade da plataforma e preferência de marca.
   */
  const utility = (x: Combo) => {
    const support = supports.get(x)!;
    const level = Math.min(1, x.objective / 100) + 0.30 * Math.min(1, Math.max(0, (x.objective - 150) / 75));
    const weights = CAPACITY_WEIGHT[profile];
    const need = ramNeed(x.c.specs, x.g.specs?.vram);
    const ssdWeight = weights.ssd * (workload ? WORKLOAD_SSD[workload] ?? 1 : 1);
    // A importância da memória e do armazenamento cresce com a capacidade da configuração final (level), no PC inteiro e
    // no upgrade (V5: antes o upgrade só contava a memória, sem o nível).
    // V6: memória e armazenamento da configuração final (com o que fica e o que é somado), no upgrade contra o PC atual.
    const ram = upgrade ? (x.c.ram ? memValue(ramOf(x), need) - memValue(ownedRam, need) : 0) : memValue(ramOf(x), need);
    const storage = upgrade ? (x.ssd ? storageOf(x) - (ownedStorage ?? 0) : 0) : storageOf(x);
    const capacity = (weights.ram * ram + ssdWeight * storage) * level * (1 + CAPACITY_LEVEL * Math.min(1, Math.max(0, (x.objective - 100) / 50)));
    const benefits = capacity + support.quality * Math.min(1, x.objective / 100) * QUALITY_VALUE + support.preference * PREFERENCE_VALUE;
    return Math.log(x.objective) - PRICE_WEIGHT * Math.log(x.cost + ownedValue) + PRICE_WEIGHT * benefits;
  };
  /** Utilidade de não trocar nada (upgrade): o mesmo índice, sem custo e sem benefícios. */
  const currentUtility = upgrade && currentObjective ? Math.log(currentObjective) - PRICE_WEIGHT * Math.log(ownedValue) : undefined;
  const utilities = new Map<Combo, number>();
  const u = (x: Combo) => {
    let v = utilities.get(x);
    if (v === undefined) utilities.set(x, (v = utility(x)));
    return v;
  };
  let ranked: Combo[] | undefined;
  let byObjective: Combo[] | undefined;
  /** V6: o PC atual no plano (upgrade) e o tamanho da busca. */
  const current = currentObjective !== undefined && currentUtility !== undefined
    ? { current: { objective: Math.round(currentObjective * 100) / 100, utility: Math.round(currentUtility * 10000) / 10000 } } : {};
  const stats = () => ({ candidates: combos.length, rejectedBuilds: { ...rejectedBuilds } });
  const planner = (budget: number, audit?: boolean | 'primary'): BudgetPlan => {
    let bestObjective: number | undefined;
    // A utilidade não depende do orçamento (V5: nem no upgrade), então a ordem é calculada uma vez e serve a todos os valores.
    ranked ??= [...sortedByCost].sort((a, b) => u(b) - u(a) || a.cost - b.cost || b.objective - a.objective || a.score - b.score);
    const order = ranked;
    /** A opção de maior utilidade entre as que passam no filtro (compatível e não dominada); empate: a mais barata. */
    const bestWhere = (keep: (x: Combo) => boolean): Combo | undefined => order.find((x) => keep(x) && verify(x) && undominated(x));
    /** A de maior índice entre as que passam no filtro (compatível e não dominada): "maior desempenho no valor". */
    const strongestWhere = (keep: (x: Combo) => boolean) => (byObjective ??= [...sortedByCost].sort((a, b) => b.objective - a.objective || a.cost - b.cost))
      .find((x) => keep(x) && verify(x) && undominated(x));
    if (!combos.length) return empty(budget, emptyStatus, audit === true ? { audit: { rejectedBuilds: { ...rejectedBuilds } } } : {});
    /**
     * Upgrade que compensa (V5): utilidade maior que a de não trocar (com os benefícios de capacidade e qualidade) e ganho
     * relativo de pelo menos MIN_UPGRADE_RATE por R$ 1.000, na escala do PC atual (não um número fixo de pontos por real). Só memória e/ou SSD (sem processador nem placa de vídeo)
     * entram quando a peça atual limita, como na V4.
     */
    const worthBuying = (x: Combo) => !upgrade || currentUtility === undefined || currentObjective === undefined || (!x.c.cpu && !x.g.gpu) ||
      (u(x) > currentUtility && (x.objective / currentObjective - 1) / (x.cost / 1000) >= MIN_UPGRADE_RATE);
    const fits = (x: Combo) => x.cost <= budget && worthBuying(x);
    bestObjective = strongestWhere(fits)?.objective;
    const first = bestWhere(fits);
    if (!first) {
      // Cabe alguma troca, mas nenhuma compensa: não trocar. Senão, falta valor para a primeira que compensa.
      if (upgrade && currentObjective !== undefined && sortedByCost.some((x) => x.cost <= budget && verify(x))) return empty(budget, 'no-gain');
      const minimum = sortedByCost.find((x) => worthBuying(x) && verify(x));
      return minimum ? empty(budget, 'too-low', { minTotal: Math.ceil(minimum.cost) }) : empty(budget, emptyStatus);
    }

    if (audit === 'primary') return { status: 'ok', mode, profile, budget, ...validated.get(first)!, utility: Math.round(u(first) * 10000) / 10000, reason: 'recommended', bestObjective, ...current, alternatives: [] };
    const picks = [first];
    const reasons = new Map<Combo, BudgetReason>([[first, 'recommended']]);
    const add = (x: Combo | undefined, reason: BudgetReason) => {
      if (!x || picks.includes(x)) return;
      picks.push(x);
      reasons.set(x, reason);
    };
    const worthIt = (x: Combo) => picks.every((p) => !dominates(p, x) && (
      x.cost <= p.cost * 0.95 || x.objective >= p.objective * 1.03 || ramOf(x) > ramOf(p) ||
      storageOf(x) > storageOf(p) || (x.g.specs?.vram ?? 0) > (p.g.specs?.vram ?? 0) ||
      (x.cost <= p.cost * 1.05 && x.objective >= p.objective * NEAR_BEST &&
        (supports.get(x)!.quality >= supports.get(p)!.quality + 2 || supports.get(x)!.preference > supports.get(p)!.preference))));
    const stretch = bestWhere((x) => x.cost > budget && x.cost <= budget * (1 + STRETCH) && worthBuying(x) &&
      x.objective >= bestObjective! * (1 + STRETCH_GAIN) &&
      x.objective / first.objective - 1 >= (x.cost - first.cost) / first.cost);
    const room = () => picks.length < OPTIONS - (stretch ? 1 : 0);
    // Cada alternativa tem um motivo (V6: o rótulo vem do motor, não de uma reclassificação depois).
    // Maior desempenho: entra sempre que render pelo menos STRONGER_GAIN a mais e não for dominada.
    add(strongestWhere((x) => fits(x) && x.objective >= first.objective * (1 + STRONGER_GAIN)), 'max-performance');
    // Custo-benefício: o maior índice (no upgrade, o maior ganho) por real entre as que entregam pelo menos VALUE_SHARE do
    // índice da recomendada, mais baratas que ela. Sem o piso, seria sempre a montagem mais simples.
    if (room()) {
      const base = currentObjective ?? 0;
      const ratio = (x: Combo) => (x.objective - base) / x.cost;
      // Filtros baratos primeiro; a validação (compatibilidade e dominância) só até achar a primeira, na ordem do custo-benefício.
      const pool: Combo[] = [];
      for (const x of sortedByCost) {
        if (x.cost >= first.cost) break;
        if (x.objective >= first.objective * VALUE_SHARE && ratio(x) > ratio(first) * 1.05 && fits(x)) pool.push(x);
      }
      pool.sort((a, b) => ratio(b) - ratio(a) || a.cost - b.cost);
      add(pool.find((x) => worthIt(x) && verify(x) && undominated(x)), 'value');
    }
    if (room()) {
      // Econômica: a de maior utilidade pelo menos CHEAPER_SAVING mais barata, de preferência com outra peça principal.
      const cheap = (x: Combo) => x.cost <= first.cost * (1 - CHEAPER_SAVING) && worthIt(x);
      add(bestWhere((x) => cheap(x) && (gpuKey(x) !== gpuKey(first) || cpuKey(x) !== cpuKey(first))) ?? bestWhere(cheap), 'economy');
    }
    while (room()) {
      // Outra peça principal ou vantagem técnica (mais memória, armazenamento ou construção), nunca uma opção dominada ou igual.
      const pool = (x: Combo) => fits(x) && worthIt(x);
      const next = bestWhere((x) => pool(x) && !picks.some((p) => gpuKey(p) === gpuKey(x))) ??
        bestWhere((x) => pool(x) && !picks.some((p) => cpuKey(p) === cpuKey(x))) ??
        bestWhere((x) => pool(x) && picks.some((p) => cpuKey(p) === cpuKey(x) && gpuKey(p) === gpuKey(x) &&
          (ramOf(x) > ramOf(p) || storageOf(x) > storageOf(p) || supports.get(x)!.quality > supports.get(p)!.quality)));
      if (!next) break;
      add(next, 'alternative');
    }
    if (stretch) add(stretch, 'stretch');
    const [best, ...rest] = picks.map((combo): BudgetOption => ({ ...validated.get(combo)!, utility: Math.round(u(combo) * 10000) / 10000,
      reason: reasons.get(combo), ...(combo.cost > budget && { stretch: true }) }));
    const strongest = (eligible: (x: Combo) => boolean) => {
      let top: Combo | undefined;
      for (const x of sortedByCost) {
        if (eligible(x) && (!top || x.objective > top.objective) && verify(x)) top = x;
      }
      return top && validated.get(top);
    };
    return { status: 'ok', mode, profile, budget, ...best!, bestObjective, ...current, stats: stats(), alternatives: rest, ...(audit === true && {
      audit: {
        strongerWithinBudget: strongest((x) => x.cost <= budget && x.objective > first.objective),
        betterOutsideBudget: strongest((x) => x.cost > budget && x.objective > bestObjective!),
        rejectedBuilds: { ...rejectedBuilds },
      },
    }) };
  };
  // V6: as opções levam a utilidade (testes de otimização comparam a escolhida com todas as válidas).
  return Object.assign(planner, { options: () => sortedByCost.filter(verify).map((x) => ({ ...validated.get(x)!, utility: Math.round(u(x) * 10000) / 10000 })) });

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
    const finalBoard = c.board?.specs ?? oMb;
    const keepsDrive = !!combo.ssd && keepsOldDrive(finalBoard);
    if (keepsDrive) notes.add('keeps-ssd');

    const buildOf = (): Build => {
      const b: Build = { extraDrives: owned.extraDrives };
      for (const slot of BUILD_SLOTS) if (owned[slot]) b[slot] = { ...owned[slot]!, current: true };
      // Plataforma nova: a placa-mãe e o processador antigos saem (a memória só se foi trocada).
      for (const [slot, p] of Object.entries(picked) as [BuildSlot, Product][]) b[slot] = { specs: slot === 'psu' && psuAtx3(p) ? { ...p.specs, atx: p.specs.atx ?? '3.0' } : p.specs, ...(p.qty && { qty: p.qty }) };
      // V6: kit somado à memória atual: a compatibilidade confere o total (pentes e capacidade) na placa que fica.
      if (c.ramTotal && c.ram && oRam) {
        const speeds = [oRam.ramSpeed, c.ram.specs.ramSpeed].filter((v): v is number => typeof v === 'number');
        b.ram = { specs: { ...oRam, ramCapacity: c.ramTotal, ramModules: ownedModules + (c.ram.specs.ramModules ?? 1) * (c.ram.qty ?? 1),
          ...(speeds.length && { ramSpeed: Math.min(...speeds) }) } };
      }
      // V6: o SSD atual vira disco extra quando o novo entra e ainda tem onde ligar.
      if (keepsDrive && owned.ssd) b.extraDrives = [{ ...owned.ssd, current: true }, ...(owned.extraDrives ?? [])];
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
    // ---------- V6: adequação da configuração final (inclui o que fica) ----------
    const adequacy: NonNullable<BudgetOption['adequacy']> = {};
    const cpuSpecs = c.specs;
    const load = c.cpu ? coolingLoad(c.cpu) : cpuWatts(cpuSpecs);
    const finalCooler = combo.cooler?.specs ?? (notes.has('box-cooler') ? undefined : oldCooler);
    adequacy.cooler = notes.has('box-cooler') ? 'estimated'
      : finalCooler?.coolerTdp !== undefined ? (finalCooler.coolerTdp >= load ? 'confirmed' : 'insufficient')
      : combo.cooler ? 'estimated' : 'unknown';
    const psuSpecs = combo.psu?.specs ?? oPsu;
    const psuNeeded = psuNeed(cpuSpecs, combo.g.specs, combo.g.gpu?.offer.sheet, !!psuSpecs?.atx);
    adequacy.psu = psuSpecs?.watts ? (psuSpecs.watts >= psuNeeded ? 'confirmed' : 'insufficient') : 'unknown';
    adequacy.vrm = !(tdpOf(cpuSpecs) >= 105 || cpuWatts(cpuSpecs) >= 145) ? 'estimated'
      : notes.has('vrm-unverified') ? 'unknown'
      : c.board?.offer.sheet?.vrmHeatsink === true ? 'confirmed' : 'estimated';
    const finalRam = ramOf(combo);
    const ramNeeded = ramNeed(cpuSpecs, combo.g.specs?.vram);
    adequacy.ram = !finalRam ? 'unknown' : finalRam >= ramNeeded ? 'confirmed' : 'insufficient';
    const finalStorage = storageGbOf(combo);
    const finalKind = combo.ssd ? 'nvme' : driveKind(oSsd);
    adequacy.storage = !finalStorage ? 'unknown' : finalStorage >= 900 && finalKind !== 'unknown' ? 'confirmed' : finalKind === 'unknown' ? 'unknown' : 'insufficient';
    const finalCase = combo.pcase?.specs ?? owned.case?.specs;
    adequacy.case = !finalCase ? 'unknown' : tightCase(finalCase, combo.g.specs, combo.cooler?.specs ?? oldCooler) ? 'estimated'
      : knownRoom(finalCase, combo.g.specs, combo.cooler?.specs ?? oldCooler) > 0 ? 'confirmed' : 'estimated';
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
      adequacy,
      final: { ...(finalRam ? { ramGb: finalRam } : {}), ...(finalStorage ? { storageGb: finalStorage } : {}), storageKind: finalKind },
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
