import { checkBuild, coolerFits, type Build, type BuildIssue, type BuildSlot } from './compat.ts';
import { BASE_SYSTEM_POWER, chipsetSupport, cpuFamily, cpuPower, cpuTdp, GPU_POWER, PSU_HEADROOM, roundUp50 } from './hardware.ts';
import { caseFits } from './pccase.ts';
import { chipsetPcie, cpuNeeded, cpuScore, ENTRY_CHIPSETS, gpuMatching, gpuPerf, gpuX8, IGPU_PERF, type Resolution } from './perf.ts';
import { effectiveCash, FORM_FACTORS, type FormFactor, type MemoryType, type Offer, type Specs } from './types.ts';

/**
 * Montar pelo orçamento (docs/ARCHITECTURE.md §17.4). Função pura: recebe o orçamento, a tela e as
 * ofertas de agora (com a ficha) e devolve as peças a comprar.
 *
 * - **PC inteiro** (sem `owned`): escolhe o par processador + placa de vídeo que mais rende em jogos
 *   na tela da pessoa, com a plataforma (placa-mãe, memória de 32 GB em 2 pentes), fonte certificada
 *   com folga, SSD NVMe de 1 TB, cooler quando o processador pede e gabinete onde a placa cabe.
 * - **Upgrade** (`owned` = as peças do PC importado): para cada peça, manter ou trocar. Processador do
 *   mesmo encaixe (se a placa-mãe aceita), ou plataforma nova (processador, placa-mãe e memória;
 *   a memória atual fica se for do tipo da placa nova); placa de vídeo; fonte quando a atual não
 *   aguenta. Só sugere se render pelo menos 10% a mais.
 *
 * Rendimento em jogos: o menor entre a placa de vídeo e a placa que o processador consegue alimentar
 * (gpuMatching), na escala de perf.ts. Entre as opções que cabem no orçamento, a mais barata dentro
 * de 3% da melhor: gastar mais por quase nada não vale. Até OPTIONS opções, cada uma com outra placa de
 * vídeo (ou outro processador), para a pessoa comparar; a última pode passar até 25% do orçamento se
 * render bem mais (STRETCH). A montagem final passa pela compatibilidade
 * (checkBuild); gabinete, cooler ou fonte com erro trocam pelo seguinte mais barato.
 */

export interface BudgetRequest {
  /** Quanto a pessoa quer gastar (R$, à vista). */
  budget: number;
  res: Resolution;
  hz?: number;
  /** Peças que a pessoa já tem (upgrade). Sem processador nem placa de vídeo aqui: PC inteiro. */
  owned?: Build;
  /** Desempenho das peças atuais, calculado na tela (o processador pela ficha do modelo). */
  current?: { cpu?: number; gpu?: number };
}

export interface BudgetPart {
  /** À vista com cupom, da loja mais barata; com `qty`, o total das unidades. */
  price: number;
  /** Unidades (memória em pentes avulsos iguais: 2). Ausente = 1. */
  qty?: number;
  offer: Offer;
  /** O mesmo produto em todas as lojas (para a montagem comparar). */
  offers: Offer[];
}

/**
 * ok: montou. too-low: o orçamento não fecha nem a opção mais barata (minTotal diz quanto).
 * no-gain: upgrade sem troca que renda 10% dentro do valor. no-data: faltam ofertas para montar.
 */
export type BudgetStatus = 'ok' | 'too-low' | 'no-gain' | 'no-data';

/**
 * Observações do plano. igpu: sem placa de vídeo (vídeo integrado). ram-16: memória de 16 GB (32 não
 * coube). ssd-500: SSD de 500 GB. psu-unknown: upgrade sem a fonte informada (confira). keeps-ram:
 * plataforma nova com a memória atual. ram-32: sobrou para subir a memória para 32 GB. bios: a placa-mãe
 * atual aceita o processador depois de atualizar a BIOS. ram-pair: memória em 2 pentes avulsos iguais
 * (mais barata que o kit).
 */
export type BudgetNote = 'igpu' | 'ram-16' | 'ssd-500' | 'psu-unknown' | 'keeps-ram' | 'ram-32' | 'bios' | 'ram-pair';

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
  budget: number;
  /** too-low: o menor valor que monta. */
  minTotal?: number;
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
/** Placa de vídeo de 8 linhas numa placa-mãe PCIe 3.0: rende um pouco menos. */
const X8_ON_PCIE3 = 0.92;
/** Desempenho mínimo de placa de vídeo para entrar (escala de perf.ts; GTX 1050 Ti = 33). */
const MIN_GPU_PERF = 30;
/** TDP mínimo de air cooler (os de 65 W são os de 90 mm ou de perfil baixo). */
const MIN_AIR_TDP = 100;
/** Preferência do kit sobre 2 pentes avulsos iguais (na escolha). */
const PAIR_MARGIN = 0.05;
/** Folga da fonte comprada na montagem pelo orçamento (a compatibilidade usa PSU_HEADROOM, 1,3): sobra para picos e um upgrade de placa. */
const BUDGET_PSU_HEADROOM = 1.5;
/** Consumo estimado a partir do qual a fonte Gold (ou melhor) tem preferência sobre a Bronze. */
const GOLD_FROM_W = 400;
/** Quanto a mais a fonte abaixo de Gold "custa" na escolha, nesses PCs. */
const GOLD_MARGIN = 0.15;
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
  offer: Offer;
  offers: Offer[];
  specs: Specs;
  /** Unidades: memória em 2 pentes avulsos iguais (preço e preço de escolha já são das duas). */
  qty?: number;
}

/** Ofertas que dá para comprar, uma entrada por produto (a mais barata entre as lojas), da de menor preço de escolha à maior. */
function productsOf(slot: BuildSlot, offers: Offer[] | undefined, now: number): Product[] {
  const by = new Map<string, Product>();
  for (const o of offers ?? []) {
    if (!o.specs || !o.inStock || o.marketplace || o.openbox) continue;
    const price = effectiveCash(o, now);
    if (!(price > 0)) continue;
    const key = o.productKey ?? o.modelKey ?? `${o.store}|${o.storeSku}`;
    const p = by.get(key);
    if (!p) by.set(key, { price, score: price, offer: o, offers: [o], specs: o.specs });
    else {
      p.offers.push(o);
      if (price < p.price) Object.assign(p, { price, offer: o, specs: o.specs });
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
const cpuWatts = (s: Specs) => cpuPower(s) ?? tdpOf(s) * 1.4;
const gpuWatts = (s: Specs | undefined, sheet?: Offer['sheet']) =>
  !s ? 0 : ((s.gpuModel ? GPU_POWER[s.gpuModel] : undefined) ?? s.gpuTdp ?? (typeof sheet?.tdpW === 'number' ? sheet.tdpW : undefined) ?? 200);
/** Consumo máximo estimado do PC (W). */
const drawOf = (cpu: Specs, gpu: Specs | undefined, sheet?: Offer['sheet']) => cpuWatts(cpu) + gpuWatts(gpu, sheet) + BASE_SYSTEM_POWER;
/** Fonte recomendada: consumo com folga; a que o fabricante da placa de vídeo pede vale como piso. */
const psuNeed = (cpu: Specs, gpu: Specs | undefined, sheet?: Offer['sheet'], headroom = PSU_HEADROOM) =>
  Math.max(roundUp50(drawOf(cpu, gpu, sheet) * headroom), gpu?.gpuPsu ?? 0);
/** Fonte simples: sem PFC ativo e sem certificação. */
const basicPsu = (s: Specs) => s.activePfc === false && (!s.efficiency || s.efficiency === 'white');
/** Rendimento em jogos: o menor entre a placa de vídeo e a que o processador alimenta. */
const fpsOf = (cpu: number, gpu: number, res: Resolution, hz?: number) => Math.min(gpu, Math.max(0, gpuMatching(cpu, res, hz)));

interface CpuOption {
  /** Processador novo (sem: mantém o atual). */
  cpu?: Product;
  specs: Specs;
  perf: number;
  cost: number;
  /** Soma dos preços de escolha. */
  score: number;
  board?: Product;
  ram?: Product;
  cooler?: Product;
  /** Geração PCIe do slot da placa de vídeo na placa-mãe que fica. */
  pcie?: number;
  notes: BudgetNote[];
}

interface GpuOption {
  gpu?: Product;
  specs?: Specs;
  perf: number;
  /** Placa de vídeo de 8 linhas (perde em placa-mãe PCIe 3.0). */
  x8: boolean;
}

interface Tier {
  ram: number;
  ssd?: number;
}

export function planBudget(req: BudgetRequest, offers: Partial<Record<BuildSlot, Offer[]>>, now = Date.now()): BudgetPlan {
  const P = {
    motherboard: productsOf('motherboard', offers.motherboard, now),
    cpu: productsOf('cpu', offers.cpu, now),
    ram: productsOf('ram', offers.ram, now),
    gpu: productsOf('gpu', offers.gpu, now),
    psu: productsOf('psu', offers.psu, now),
    ssd: productsOf('ssd', offers.ssd, now),
    cooler: productsOf('cooler', offers.cooler, now),
    case: productsOf('case', offers.case, now),
  };
  const owned = req.owned ?? {};
  const upgrade = !!(owned.cpu || owned.gpu);
  const empty = (status: BudgetStatus, extra: Partial<BudgetPlan> = {}): BudgetPlan => ({ status, budget: req.budget, parts: {}, total: 0, fps: 0, notes: [], issues: [], alternatives: [], ...extra });
  if (!P.cpu.length || !P.gpu.length || !P.psu.length) return empty('no-data');

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
  /** Fonte a comprar: com a folga da montagem pelo orçamento e, no PC que puxa GOLD_FROM_W ou mais, preferência pela Gold. */
  const gold = (p: Product) => ['gold', 'platinum', 'titanium'].includes(p.specs.efficiency ?? '');
  const psusFor = memo((k) => {
    const [w, heavy] = k.split('|');
    const list = psus(w!);
    if (heavy !== '1') return list;
    const sc = (p: Product) => p.score * (gold(p) ? 1 : 1 + GOLD_MARGIN);
    return [...list].sort((a, b) => sc(a) - sc(b) || a.price - b.price);
  });
  const psuToBuy = (cpu: Specs, gpu: Specs | undefined, sheet?: Offer['sheet']) =>
    psusFor(`${psuNeed(cpu, gpu, sheet, BUDGET_PSU_HEADROOM)}|${drawOf(cpu, gpu, sheet) >= GOLD_FROM_W ? 1 : 0}`);
  /**
   * Cooler para o processador: serve no encaixe e dá conta do TDP com folga. Air cooler só com o TDP
   * informado (os sem ficha são, em geral, os de 90 mm que rendem menos que o da caixa), de 100 W ou
   * mais; water de 240 mm ou mais para processador de 105 W ou mais.
   */
  const coolers = memo((k) => {
    const [socket, t] = k.split('|');
    const tdp = Number(t);
    return P.cooler.filter((c) => {
      const s = c.specs;
      if (coolerFits(s, socket as Specs['socket']) !== 'ok') return false;
      if (s.coolerType === 'water') return (s.radiator ?? 0) >= (tdp >= 105 ? 240 : 120) && (!s.coolerTdp || s.coolerTdp >= tdp);
      // Folga: no turbo o processador passa do TDP (os Intel, bem acima).
      return !!s.coolerTdp && s.coolerTdp >= Math.max(MIN_AIR_TDP, tdp * 1.3);
    });
  });
  /** Gabinete onde a placa-mãe cabe, com ventilação: 1 ventoinha ou mais; 3 ou mais com placa de vídeo de 200 W ou mais. */
  const casesFor = (ff: FormFactor, gpuW: number) => cases(ff).filter((c) => (c.specs.caseFans ?? 0) >= (gpuW >= 200 ? 3 : 1));
  const needsCooler = (s: Specs, fresh: boolean) => (fresh ? s.cooler !== true || tdpOf(s) >= 105 : s.cooler === false);
  const coolerFor = (s: Specs) => coolers(`${s.socket}|${tdpOf(s)}`)[0];

  // ---------- Processadores e placas de vídeo à venda (um por modelo, o de menor preço de escolha) ----------
  const cpus = new Map<string, { p: Product; perf: number }>();
  for (const p of P.cpu) {
    const s = p.specs;
    const perf = cpuScore(s, p.offer.sheet);
    if (!perf || !s.socket || !s.cpuModel || !cpuFamily(s)) continue;
    const k = `${s.cpuLine} ${s.cpuModel}`;
    if (!cpus.has(k)) cpus.set(k, { p, perf });
  }
  const gpus = new Map<string, GpuOption>();
  // Upgrade: só variantes com pelo menos a memória de vídeo da placa atual (o mesmo chip sai com 8 e 16 GB);
  // com menos, ou sem a informação, seria downgrade.
  const vramFloor = upgrade ? owned.gpu?.specs.vram : undefined;
  for (const p of P.gpu) {
    if (vramFloor && (p.specs.vram ?? 0) < vramFloor) continue;
    const perf = gpuPerf(p.specs);
    const m = p.specs.gpuModel;
    // Placa abaixo de uma GTX 1050 Ti (GT 710, GT 730…) rende menos que o vídeo integrado atual: não é opção.
    if (perf && perf < MIN_GPU_PERF) continue;
    if (perf && m && !gpus.has(m)) gpus.set(m, { gpu: p, specs: p.specs, perf, x8: gpuX8(m, p.offer.sheet) });
  }

  const oCpu = owned.cpu?.specs;
  const oMb = owned.motherboard?.specs;
  const oRam = owned.ram?.specs;
  const oGpu = owned.gpu?.specs;
  const oPsu = owned.psu?.specs;
  const curCpu = req.current?.cpu ?? (oCpu ? cpuScore(oCpu) : undefined);
  const curGpu = req.current?.gpu ?? (oGpu ? gpuPerf(oGpu) : oCpu?.igpu ? IGPU_PERF : undefined);
  /** Upgrade: a placa-mãe nova tem de caber no gabinete atual (que não conhecemos): até o formato da placa atual. */
  const maxBoard = upgrade ? (oMb?.formFactor ?? 'atx') : 'eatx';

  // ---------- Opções de processador (com o que cada uma arrasta junto) ----------
  function cpuOptions(tier: Tier): CpuOption[] {
    const out: CpuOption[] = [];
    if (upgrade && oCpu && curCpu) out.push({ specs: oCpu, perf: curCpu, cost: 0, score: 0, pcie: chipsetPcie(oMb?.chipset), notes: [] });
    /** Placa-mãe nova para o processador: a de menor preço de escolha com placa + memória. */
    const platform = memo((k) => {
      const [socket, family, high] = k.split('|');
      let best: Pick<CpuOption, 'board' | 'ram' | 'cost' | 'score' | 'notes'> | undefined;
      for (const b of P.motherboard) {
        const s = b.specs;
        if (s.socket !== socket || !s.chipset || !s.memory || !s.formFactor || rank(s.formFactor) > rank(maxBoard)) continue;
        if (chipsetSupport(s.chipset, family as Parameters<typeof chipsetSupport>[1]) !== 'ok') continue;
        if (high === '1' && ENTRY_CHIPSETS.has(s.chipset)) continue;
        // Memória: a atual fica se for do tipo da placa; senão, um kit novo.
        const keep = upgrade && oRam?.memory === s.memory;
        const ram = keep ? undefined : rams(`${s.memory}|${tier.ram}`)[0];
        if (!keep && !ram) continue;
        // PC inteiro: só placa com gabinete à venda no formato dela.
        if (!upgrade && !cases(s.formFactor).length) continue;
        const cost = b.price + (ram?.price ?? 0);
        const score = b.score + (ram?.score ?? 0);
        if (!best || score < best.score) best = { board: b, ram, cost, score, notes: keep ? ['keeps-ram'] : [] };
      }
      return best;
    });
    for (const { p, perf } of cpus.values()) {
      const s = p.specs;
      if (upgrade && curCpu && perf <= curCpu) continue;
      const family = cpuFamily(s)!;
      // Mesmo encaixe: fica a placa-mãe (se ela aceita o processador).
      const support = upgrade && oCpu && oMb?.chipset && s.socket === oCpu.socket ? chipsetSupport(oMb.chipset, family) : undefined;
      if (support === 'ok' || support === 'bios') {
        const cooler = needsCooler(s, false) ? coolerFor(s) : undefined;
        if (needsCooler(s, false) && !cooler) continue;
        out.push({ cpu: p, specs: s, perf, cost: p.price + (cooler?.price ?? 0), score: p.score + (cooler?.score ?? 0), cooler, pcie: chipsetPcie(oMb?.chipset), notes: support === 'bios' ? ['bios'] : [] });
        continue;
      }
      const plat = platform(`${s.socket}|${family}|${tdpOf(s) >= 105 ? 1 : 0}`);
      if (!plat) continue;
      const cooler = needsCooler(s, true) ? coolerFor(s) : undefined;
      if (needsCooler(s, true) && !cooler) continue;
      out.push({ cpu: p, specs: s, perf, ...plat, cooler, cost: p.price + plat.cost + (cooler?.price ?? 0), score: p.score + plat.score + (cooler?.score ?? 0), pcie: chipsetPcie(plat.board!.specs.chipset), notes: [...plat.notes] });
    }
    return out;
  }

  function gpuOptions(): GpuOption[] {
    const out = [...gpus.values()].filter((g) => !upgrade || !curGpu || g.perf > curGpu);
    if (upgrade && curGpu) out.unshift({ specs: oGpu, perf: curGpu, x8: false });
    return out;
  }

  interface Combo {
    c: CpuOption;
    g: GpuOption;
    /** Sem placa de vídeo: vídeo integrado. */
    igpu?: boolean;
    psu?: Product;
    ssd?: Product;
    pcase?: Product;
    cost: number;
    score: number;
    fps: number;
    gpuPerf: number;
    psuUnknown?: boolean;
  }

  function search(tier: Tier) {
    const cs = cpuOptions(tier);
    const gs = gpuOptions();
    const ssd = tier.ssd ? ssds(String(tier.ssd))[0] : undefined;
    if (tier.ssd && !ssd) return { combos: [] as Combo[] };
    const combos: Combo[] = [];
    for (const c of cs) {
      const choices: (GpuOption & { igpu?: boolean })[] = [...gs];
      // Sem placa de vídeo, só no PC inteiro e com vídeo integrado (orçamento que não fecha com placa).
      if (!upgrade && c.specs.igpu === true) choices.push({ perf: IGPU_PERF, x8: false, igpu: true });
      for (const g of choices) {
        if (upgrade && !c.cpu && !g.gpu) continue; // nada muda
        const gPerf = g.x8 && c.pcie === 3 ? g.perf * X8_ON_PCIE3 : g.perf;
        // Fonte: no PC inteiro, sempre; no upgrade, quando a atual não aguenta (ou é simples e a placa muda).
        const need = psuNeed(c.specs, g.igpu ? undefined : g.specs, g.gpu?.offer.sheet);
        const mustBuy = !upgrade || (!!oPsu?.watts && (oPsu.watts < need || (!!g.gpu && basicPsu(oPsu))));
        const psu = mustBuy ? psuToBuy(c.specs, g.igpu ? undefined : g.specs, g.gpu?.offer.sheet)[0] : undefined;
        if (mustBuy && !psu) continue;
        const psuUnknown = upgrade && !oPsu?.watts;
        const fps = fpsOf(c.perf, gPerf, req.res, req.hz);
        if (curFps !== undefined && fps < curFps * (1 + MIN_GAIN)) continue;
        // Gabinete (PC inteiro): ventilação conforme o consumo da placa de vídeo.
        // Já sem os que a placa de vídeo não cabe (pela ficha dos dois), para o custo ser o de verdade.
        const len = g.igpu ? undefined : g.specs?.gpuLength;
        const pcase = upgrade
          ? undefined
          : casesFor(c.board!.specs.formFactor!, g.igpu ? 0 : gpuWatts(g.specs, g.gpu?.offer.sheet)).find((x) => !len || !x.specs.caseMaxGpu || x.specs.caseMaxGpu >= len);
        if (!upgrade && !pcase) continue;
        const cost = c.cost + (g.gpu?.price ?? 0) + (psu?.price ?? 0) + (ssd?.price ?? 0) + (pcase?.price ?? 0);
        const score = c.score + (g.gpu?.score ?? 0) + (psu?.score ?? 0) + (ssd?.score ?? 0) + (pcase?.score ?? 0);
        combos.push({ c, g, ...(g.igpu && { igpu: true }), psu, ssd, pcase, cost, score, fps, gpuPerf: gPerf, ...(psuUnknown && { psuUnknown }) });
      }
    }
    return { combos };
  }

  /** Rendimento do PC atual (upgrade): só entram opções que rendem pelo menos MIN_GAIN a mais. */
  const curFps = upgrade && curCpu && curGpu ? fpsOf(curCpu, curGpu, req.res, req.hz) : undefined;
  const tiers: Tier[] = upgrade ? [{ ram: 32 }, { ram: 16 }] : [{ ram: 32, ssd: 1000 }, { ram: 16, ssd: 1000 }, { ram: 16, ssd: 500 }];
  /** A melhor da lista: a mais barata (preço de escolha) entre as que rendem pelo menos NEAR_BEST da que mais rende. */
  const bestOf = (list: Combo[]) => {
    if (!list.length) return undefined;
    const top = Math.max(...list.map((x) => x.fps));
    return list.filter((x) => x.fps >= top * NEAR_BEST).sort((a, b) => a.score - b.score || b.fps - a.fps)[0];
  };
  const gpuKey = (x: Combo) => (x.igpu ? 'igpu' : (x.g.specs?.gpuModel ?? 'atual'));
  const cpuKey = (x: Combo) => `${x.c.specs.cpuLine} ${x.c.specs.cpuModel}`;

  let chosen: { combos: Combo[]; tier: Tier } | undefined;
  let minTotal: number | undefined;
  for (const tier of tiers) {
    const { combos } = search(tier);
    for (const x of combos) if (minTotal === undefined || x.cost < minTotal) minTotal = x.cost;
    const fit = combos.filter((x) => x.cost <= req.budget);
    const first = bestOf(fit);
    if (!first) continue;
    // Outras opções: cada uma com uma placa de vídeo que as anteriores não têm (sem outra placa, outro processador),
    // e só se valer a comparação: mais barata ou com placa de vídeo mais forte que todas as já escolhidas.
    // Mesma placa e mesmo rendimento por mais dinheiro não é opção.
    const picks = [first];
    const worthIt = (x: Combo) => !picks.some((p) => p.cost <= x.cost && p.fps >= x.fps && p.gpuPerf >= x.gpuPerf);
    // A última opção passa um pouco do orçamento quando isso rende bem mais: a melhor até STRETCH acima,
    // com pelo menos STRETCH_GAIN a mais de rendimento que a 1ª. As do meio ficam dentro do valor.
    const stretch = bestOf(combos.filter((x) => x.cost > req.budget && x.cost <= req.budget * (1 + STRETCH) && x.fps >= first.fps * (1 + STRETCH_GAIN)));
    while (picks.length < OPTIONS - (stretch ? 1 : 0)) {
      const pool = fit.filter(worthIt);
      const next = bestOf(pool.filter((x) => !picks.some((p) => gpuKey(p) === gpuKey(x)))) ?? bestOf(pool.filter((x) => !picks.some((p) => cpuKey(p) === cpuKey(x))));
      if (!next) break;
      picks.push(next);
    }
    if (stretch) picks.push(stretch);
    chosen = { combos: picks, tier };
    break;
  }
  // Nenhuma opção: no upgrade, nenhuma troca rende 10% (o PC já está no topo do que se vende); no PC inteiro, faltam ofertas.
  if (minTotal === undefined) return empty(upgrade ? 'no-gain' : 'no-data');
  if (!chosen) return empty('too-low', { minTotal: Math.ceil(minTotal) });

  const tier = chosen.tier;
  const [best, ...rest] = chosen.combos.map((combo) => finalize(combo, combo.cost > req.budget));
  return { status: 'ok', budget: req.budget, ...best!, alternatives: rest };

  /** A opção montada: peças, conferência da compatibilidade (com troca do que der erro) e observações. */
  function finalize(combo: Combo, stretch: boolean): BudgetOption {
    const picked: Partial<Record<BuildSlot, Product>> = {};
    const c = combo.c;
    if (c.cpu) picked.cpu = c.cpu;
    if (c.board) picked.motherboard = c.board;
    if (c.ram) picked.ram = c.ram;
    if (c.cooler) picked.cooler = c.cooler;
    if (combo.pcase) picked.case = combo.pcase;
    if (combo.g.gpu) picked.gpu = combo.g.gpu;
    if (combo.psu) picked.psu = combo.psu;
    if (combo.ssd) picked.ssd = combo.ssd;
    const notes = new Set<BudgetNote>(c.notes);
    if (combo.igpu) notes.add('igpu');
    if (combo.psuUnknown) notes.add('psu-unknown');
    if (!upgrade && tier.ram === 16) notes.add('ram-16');
    if (tier.ssd === 500) notes.add('ssd-500');

    const buildOf = (): Build => {
      const b: Build = {};
      for (const [slot, part] of Object.entries(owned) as [BuildSlot, NonNullable<Build[BuildSlot]>][]) b[slot] = { ...part, current: true };
      // Plataforma nova: a placa-mãe e o processador antigos saem (a memória só se foi trocada).
      for (const [slot, p] of Object.entries(picked) as [BuildSlot, Product][]) b[slot] = { specs: p.specs, ...(p.qty && { qty: p.qty }) };
      if (combo.igpu) delete b.gpu;
      return b;
    };

    // Gabinete, cooler e fonte com erro na montagem: o seguinte mais barato que não dá erro.
    const errorsOn = (slot: BuildSlot) => checkBuild(buildOf()).issues.some((i) => i.level === 'error' && i.parts.includes(slot));
    const alternatives: Partial<Record<BuildSlot, () => Product[]>> = {
      case: () => casesFor(picked.motherboard?.specs.formFactor ?? 'atx', combo.igpu ? 0 : gpuWatts(combo.g.specs, combo.g.gpu?.offer.sheet)),
      cooler: () => coolers(`${combo.c.specs.socket}|${tdpOf(combo.c.specs)}`),
      psu: () => psuToBuy(combo.c.specs, combo.igpu ? undefined : combo.g.specs, combo.g.gpu?.offer.sheet),
    };
    for (const slot of ['case', 'cooler', 'psu'] as const) {
      if (!picked[slot] || !errorsOn(slot)) continue;
      const first = picked[slot]!;
      for (const alt of alternatives[slot]!()) {
        picked[slot] = alt;
        if (!errorsOn(slot)) break;
      }
      if (errorsOn(slot)) picked[slot] = first;
    }

    let total = Object.values(picked).reduce((s, p) => s + p.price, 0);
    // Upgrade com memória abaixo de 32 GB e dinheiro sobrando: um kit de 32 GB do mesmo tipo.
    const ramNow = oRam?.ramCapacity ? oRam.ramCapacity * Math.max(1, owned.ram?.qty ?? 1) : undefined;
    if (upgrade && !picked.ram && oRam?.memory && ramNow && ramNow < 32) {
      const memory = picked.motherboard?.specs.memory ?? oMb?.memory ?? oRam.memory;
      const kit = memory === oRam.memory ? rams(`${memory}|32`)[0] : undefined;
      if (kit && !stretch && total + kit.price <= req.budget) {
        picked.ram = kit;
        total += kit.price;
        notes.add('ram-32');
        notes.delete('keeps-ram');
      }
    }

    if (picked.ram?.qty) notes.add('ram-pair');
    const final = checkBuild(buildOf());
    const parts: BudgetOption['parts'] = {};
    for (const [slot, x] of Object.entries(picked) as [BuildSlot, Product][]) parts[slot] = { price: round2(x.price), ...(x.qty && { qty: x.qty }), offer: x.offer, offers: x.offers };
    const cpuP = c.perf;
    const gpuP = combo.gpuPerf;
    return {
      parts,
      total: round2(total),
      cpu: Math.round(cpuP),
      gpu: Math.round(gpuP),
      ratio: Math.round((cpuP / cpuNeeded(gpuP, req.res, req.hz)) * 100) / 100,
      ...(curFps !== undefined && curFps > 0 && { gain: Math.round((combo.fps / curFps - 1) * 100) / 100 }),
      fps: Math.round(combo.fps * 10) / 10,
      ...(stretch && { stretch: true as const }),
      notes: [...notes],
      issues: final.issues.filter((i) => i.level !== 'info'),
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
