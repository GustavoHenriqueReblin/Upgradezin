import { ssdTier } from './ssd.ts';
import { FORM_FACTORS, type CategoryId, type Offer } from './types.ts';

/**
 * Quantos produtos há para cada opção do formulário da busca (GET /api/search/options): por campo
 * ("watts", "chipset"…), valor → produtos em estoque. Conta produtos, não anúncios (o mesmo produto em
 * três lojas conta uma vez), pelas specs que a busca usa (as da ficha). Memória: capacidade e
 * frequência por tipo ("ddr4:16").
 */
export type SearchOptionCounts = Record<string, Record<string, number>>;

/** Valor (ou valores) da oferta no campo. */
type Pick = (o: Offer) => string | number | (string | number)[] | undefined;

/** Campos de cada categoria e o valor de cada oferta neles. */
const FACETS: Record<CategoryId, Record<string, Pick>> = {
  psu: { watts: (o) => o.specs.watts, efficiency: (o) => o.specs.efficiency, modular: (o) => o.specs.modular },
  motherboard: { socket: (o) => o.specs.socket, chipset: (o) => o.specs.chipset, formFactor: (o) => o.specs.formFactor, memory: (o) => o.specs.memory },
  cpu: { socket: (o) => o.specs.socket, cpuLine: (o) => o.specs.cpuLine },
  gpu: { gpuMaker: (o) => o.specs.gpuMaker, gpuSeries: (o) => o.specs.gpuSeries, vram: (o) => o.specs.vram, brand: (o) => o.brand },
  ram: {
    memory: (o) => o.specs.memory,
    capacity: (o) => (o.specs.memory && o.specs.ramCapacity ? `${o.specs.memory}:${o.specs.ramCapacity}` : undefined),
    speed: (o) => (o.specs.memory && o.specs.ramSpeed ? `${o.specs.memory}:${o.specs.ramSpeed}` : undefined),
    modules: (o) => o.specs.ramModules,
  },
  ssd: { ssdInterface: (o) => o.specs.ssdInterface, ssdTier: (o) => ssdTier(o.specs.ssdCapacity) },
  cooler: { coolerType: (o) => o.specs.coolerType, radiator: (o) => o.specs.radiator },
  // Gabinete: conta em cada formato de placa que cabe nele (o ATX conta em ATX, Micro-ATX e Mini-ITX).
  case: { caseFormFactor: (o) => (o.specs.caseFormFactor ? FORM_FACTORS.slice(0, FORM_FACTORS.indexOf(o.specs.caseFormFactor) + 1) : undefined) },
};

export function searchOptionCounts(category: CategoryId, offers: Offer[]): SearchOptionCounts {
  const facets = FACETS[category];
  const seen: Record<string, Map<string, Set<string>>> = {};
  for (const name of Object.keys(facets)) seen[name] = new Map();
  for (const o of offers) {
    if (!o.inStock || o.marketplace || o.openbox) continue;
    const product = o.productKey ?? `${o.store}|${o.storeSku}`;
    for (const [name, pick] of Object.entries(facets)) {
      const v = pick(o);
      if (v === undefined || v === '') continue;
      const m = seen[name]!;
      for (const x of Array.isArray(v) ? v : [v]) {
        const k = String(x);
        if (!m.has(k)) m.set(k, new Set());
        m.get(k)!.add(product);
      }
    }
  }
  return Object.fromEntries(Object.entries(seen).map(([name, m]) => [name, Object.fromEntries([...m].map(([k, s]) => [k, s.size]))]));
}
