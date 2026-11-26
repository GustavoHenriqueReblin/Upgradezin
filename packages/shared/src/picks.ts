import { budgetProducts, prepareBudget, type BudgetOffer, type BudgetOption, type BudgetRequest } from './budget.ts';
import type { Build, BuildSlot } from './compat.ts';
import type { Resolution } from './perf.ts';
import type { Offer } from './types.ts';
import { CPU_BOUND, GPU_BOUND, type UpgradeFilters } from './upgrade.ts';

/**
 * As melhores ofertas de agora para uma dica de upgrade (docs/ARCHITECTURE.md §17.3), pelo mesmo motor do
 * Montar pelo orçamento (budget.ts, modo upgrade):
 *
 * - Processador e placa de vídeo: as opções que o motor considera válidas para o PC da pessoa (mesmas candidatas,
 *   notas, compatibilidade completa, ganho mínimo), só trocando a peça da dica e o que ela arrasta junto (a fonte
 *   que não aguenta; o cooler; na plataforma nova, a placa-mãe e a memória). Uma por modelo, a de menor total.
 *   Primeiro as que resolvem o gargalo (o equilíbrio sai da faixa do gargalo), da mais barata; depois as que mais
 *   rendem em jogos por real. O ganho é o do orçamento: em jogos, na tela da pessoa.
 * - Memória, fonte e SSD: os produtos que o motor considera, na ordem dele (só da própria loja, uma entrada por
 *   produto, preferência de marca), entre os que servem.
 */

/** O que a dica de fonte precisa: potência mínima e só as com certificação (bronze ou melhor). */
export interface PickContext {
  minWatts?: number;
  certified?: boolean;
}

export interface PickRequest {
  slot: BuildSlot;
  filters: UpgradeFilters;
  context?: PickContext;
  /** Processador e placa de vídeo: o PC da pessoa e a tela (o motor compara com o que ela já tem). */
  owned?: Build;
  res?: Resolution;
  hz?: number;
  current?: BudgetRequest['current'];
}

export interface UpgradePick {
  offer: Offer;
  /** À vista com cupom, da peça da dica. */
  price: number;
  /** Total com o que a troca arrasta junto (fonte, cooler, placa-mãe e memória); ausente quando é só a peça. */
  total?: number;
  /** O que entra junto na troca, com o preço. */
  extras?: { slot: BuildSlot; offer: Offer; price: number }[];
  /** Desempenho da peça e quanto o PC sobe em jogos, na tela da pessoa (0.38 = +38%). Só processador e placa de vídeo. */
  perf?: number;
  gain?: number;
  /** Processador que a placa-mãe só aceita depois de atualizar a BIOS. */
  needsBios?: boolean;
  /** O equilíbrio sai da faixa do gargalo: resolve. */
  resolves?: boolean;
}

/** Quantas ofertas a dica mostra. */
export const PICKS = 3;

const has = <T>(list: T[] | undefined, v: T | undefined) => !list?.length || (v !== undefined && list.includes(v));

/** A oferta bate com os filtros da dica (os mesmos campos dos filtros da busca). */
export function matchesUpgradeFilters(o: Offer, f: UpgradeFilters): boolean {
  const s = o.specs;
  return (
    has(f.sockets, s.socket) &&
    has(f.cpuLines, s.cpuLine) &&
    has(f.gpuMakers, s.gpuMaker) &&
    has(f.gpuModels, s.gpuModel) &&
    has(f.vram, s.vram) &&
    has(f.memory, s.memory) &&
    has(f.ramCapacity, s.ramCapacity) &&
    has(f.ramModules, s.ramModules) &&
    has(f.ramSpeed, s.ramSpeed) &&
    has(f.ssdInterfaces, s.ssdInterface as 'nvme' | 'sata' | undefined) &&
    has(f.ssdCapacity, s.ssdCapacity)
  );
}

/** As peças que o motor precisa para a dica: a da dica e as que a troca pode arrastar junto. */
export function pickSlots(req: Pick<PickRequest, 'slot' | 'filters' | 'owned'>): BuildSlot[] {
  if (req.slot === 'gpu') return ['gpu', 'psu'];
  if (req.slot !== 'cpu') return [req.slot];
  // Outro encaixe que o atual: plataforma nova (placa-mãe e memória juntas).
  const platform = !!req.filters.sockets?.length && !req.filters.sockets.includes(req.owned?.cpu?.specs.socket as never);
  return ['cpu', 'cooler', 'psu', ...(platform ? (['motherboard', 'ram'] as const) : [])];
}

const modelOf = (slot: 'cpu' | 'gpu', o: Offer) => (slot === 'gpu' ? o.specs.gpuModel : [o.specs.cpuLine, o.specs.cpuModel].filter(Boolean).join(' '));

function enginePicks(req: PickRequest & { slot: 'cpu' | 'gpu' }, offers: Partial<Record<BuildSlot, BudgetOffer[]>>, now: number): UpgradePick[] {
  if (!req.owned || !req.res) return [];
  const main = (offers[req.slot] ?? []).filter((o) => o.specs && matchesUpgradeFilters(o, { sockets: req.filters.sockets, cpuLines: req.filters.cpuLines }));
  const planner = prepareBudget(
    { res: req.res, ...(req.hz && { hz: req.hz }), mode: 'buyable', profile: 'games', owned: req.owned, ...(req.current && { current: req.current }) },
    { ...Object.fromEntries(pickSlots(req).map((slot) => [slot, offers[slot] ?? []])), [req.slot]: main },
    now,
  );
  const best = new Map<string, BudgetOption>();
  for (const option of planner.options()) {
    const part = option.parts[req.slot];
    if (!part || (req.slot === 'gpu' ? option.parts.cpu : option.parts.gpu)) continue;
    const model = modelOf(req.slot, part.offer);
    if (!model) continue;
    const prev = best.get(model);
    if (!prev || option.total < prev.total) best.set(model, option);
  }
  // Resolve: com a peça nova, o equilíbrio (processador ÷ o que a placa pede) sai da faixa do gargalo.
  const resolves = (o: BudgetOption) => o.ratio !== undefined && (req.slot === 'gpu' ? o.ratio < GPU_BOUND : o.ratio > CPU_BOUND);
  const value = (o: BudgetOption) => (o.gain ?? 0) / o.total;
  return [...best.values()]
    .sort((a, b) => Number(resolves(b)) - Number(resolves(a)) || (resolves(a) ? a.total - b.total : value(b) - value(a)))
    .slice(0, PICKS)
    .map((o) => {
      const part = o.parts[req.slot]!;
      const extras = Object.entries(o.parts).filter(([slot]) => slot !== req.slot).map(([slot, p]) => ({ slot: slot as BuildSlot, offer: p!.offer, price: p!.price }));
      return {
        offer: part.offer,
        price: part.price,
        ...(extras.length && { total: o.total, extras }),
        ...((req.slot === 'gpu' ? o.gpu : o.cpu) !== undefined && { perf: req.slot === 'gpu' ? o.gpu : o.cpu }),
        ...(o.gain !== undefined && { gain: o.gain }),
        ...(o.notes.includes('bios') && { needsBios: true }),
        ...(resolves(o) && { resolves: true }),
      };
    });
}

export function pickUpgrades(req: PickRequest, offers: Partial<Record<BuildSlot, BudgetOffer[]>>, now = Date.now()): UpgradePick[] {
  if (req.slot === 'gpu' || req.slot === 'cpu') return enginePicks(req as PickRequest & { slot: 'cpu' | 'gpu' }, offers, now);
  const ctx = req.context ?? {};
  const fits = (offers[req.slot] ?? []).filter((o) => {
    if (!o.specs || !matchesUpgradeFilters(o, req.filters)) return false;
    if (req.slot !== 'psu') return true;
    if (ctx.minWatts && !(o.specs.watts && o.specs.watts >= ctx.minWatts)) return false;
    if (ctx.certified && (!o.specs.efficiency || o.specs.efficiency === 'white')) return false;
    return true;
  });
  return budgetProducts(req.slot, fits, now).slice(0, PICKS).map(({ offer, price }) => ({ offer, price }));
}
