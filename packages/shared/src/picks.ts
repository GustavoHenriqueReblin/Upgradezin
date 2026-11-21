import type { BuildSlot } from './compat.ts';
import { chipsetSupport, cpuFamily, GPU_POWER } from './hardware.ts';
import { cpuPerf, gpuPerf } from './perf.ts';
import { effectiveCash, type Offer } from './types.ts';
import type { UpgradeFilters } from './upgrade.ts';

/**
 * As melhores ofertas de agora para uma dica de upgrade (docs/ARCHITECTURE.md §17.3).
 * Processador e placa de vídeo: as que mais sobem o desempenho por real gasto (tabela de perf.ts),
 * uma por modelo, só as compatíveis com o PC. Memória, fonte e SSD: as mais baratas entre as que
 * servem (sem comparar desempenho, que a tabela não tem).
 */

/** O que a dica sabe do PC para escolher as ofertas (vai junto do filtro da busca). */
export interface PickContext {
  /** Desempenho atual da peça (escala de perf.ts): processador ou placa de vídeo. */
  current?: number;
  /** Chipset da placa-mãe: o processador tem de ser aceito por ele. */
  chipset?: string;
  /** Consumo máximo da placa de vídeo que a fonte atual aguenta (W). */
  maxGpuPower?: number;
  /** Fonte: potência mínima e só as com certificação (bronze ou melhor). */
  minWatts?: number;
  certified?: boolean;
}

export interface PickRequest {
  slot: BuildSlot;
  filters: UpgradeFilters;
  context?: PickContext;
}

export interface UpgradePick {
  offer: Offer;
  /** À vista com cupom. */
  price: number;
  /** Desempenho da peça e quanto sobe em relação à atual (0.38 = +38%). Só processador e placa de vídeo. */
  perf?: number;
  gain?: number;
  /** Processador que a placa-mãe só aceita depois de atualizar a BIOS. */
  needsBios?: boolean;
}

/** Quantas ofertas a dica mostra. */
export const PICKS = 5;
/** Ganho mínimo para valer a troca (abaixo disso não aparece). */
const MIN_GAIN = 0.15;

const has = <T>(list: T[] | undefined, v: T | undefined) => !list?.length || (v !== undefined && list.includes(v));

/** A oferta bate com os filtros da dica (os mesmos campos dos filtros da busca). */
export function matchesUpgradeFilters(o: Offer, f: UpgradeFilters): boolean {
  const s = o.specs;
  return (
    has(f.sockets, s.socket) &&
    has(f.cpuLines, s.cpuLine) &&
    has(f.gpuMakers, s.gpuMaker) &&
    has(f.gpuModels, s.gpuModel) &&
    has(f.memory, s.memory) &&
    has(f.ramCapacity, s.ramCapacity) &&
    has(f.ramModules, s.ramModules) &&
    has(f.ramSpeed, s.ramSpeed) &&
    has(f.ssdInterfaces, s.ssdInterface as 'nvme' | 'sata' | undefined) &&
    has(f.ssdCapacity, s.ssdCapacity)
  );
}

/** Oferta que dá para comprar nova: em estoque, da própria loja (sem marketplace) e sem ser open box. */
const buyable = (o: Offer) => o.inStock && !o.marketplace && !o.openbox;

export function pickUpgrades(req: PickRequest, offers: Offer[], now = Date.now()): UpgradePick[] {
  const ctx = req.context ?? {};
  const ok = offers.filter((o) => o.specs && buyable(o) && matchesUpgradeFilters(o, req.filters));

  if ((req.slot === 'gpu' || req.slot === 'cpu') && ctx.current) {
    const current = ctx.current;
    const best = new Map<string, UpgradePick>();
    for (const o of ok) {
      const s = o.specs;
      const perf = req.slot === 'gpu' ? gpuPerf(s) : cpuPerf(s);
      const model = req.slot === 'gpu' ? s.gpuModel : s.cpuModel;
      if (!perf || !model || perf < current * (1 + MIN_GAIN)) continue;
      if (req.slot === 'gpu' && ctx.maxGpuPower && (GPU_POWER[model] ?? Infinity) > ctx.maxGpuPower) continue;
      let needsBios = false;
      if (req.slot === 'cpu' && ctx.chipset) {
        const family = cpuFamily(s);
        const support = family ? chipsetSupport(ctx.chipset, family) : undefined;
        if (!family || support === 'no') continue;
        needsBios = support === 'bios';
      }
      const price = effectiveCash(o, now);
      if (!(price > 0)) continue;
      // Uma oferta por modelo (o chip ou o processador): a mais barata entre lojas e marcas.
      const prev = best.get(model);
      if (!prev || price < prev.price) best.set(model, { offer: o, price, perf, gain: perf / current - 1, ...(needsBios && { needsBios }) });
    }
    // Mais desempenho por real: pontos ganhos ÷ preço.
    const value = (p: UpgradePick) => (p.perf! - current) / p.price;
    return [...best.values()].sort((a, b) => value(b) - value(a)).slice(0, PICKS);
  }

  const fits = ok.filter((o) => {
    if (req.slot !== 'psu') return true;
    const s = o.specs;
    if (ctx.minWatts && !(s.watts && s.watts >= ctx.minWatts)) return false;
    if (ctx.certified && (!s.efficiency || s.efficiency === 'white')) return false;
    return true;
  });
  // Mais baratas, um anúncio por produto (o mesmo produto em duas lojas: a mais barata).
  const byModel = new Map<string, UpgradePick>();
  for (const o of fits) {
    const price = effectiveCash(o, now);
    if (!(price > 0)) continue;
    const prev = byModel.get(o.modelKey);
    if (!prev || price < prev.price) byModel.set(o.modelKey, { offer: o, price });
  }
  return [...byModel.values()].sort((a, b) => a.price - b.price).slice(0, PICKS);
}
