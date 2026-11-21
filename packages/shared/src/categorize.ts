import { cpuModelKey, extractCpuSpecs, isCpu } from './cpu.ts';
import { extractGpuSpecs, gpuModelKey, isGpu } from './gpu.ts';
import { modelKeyFromTitle } from './group.ts';
import { extractMotherboardSpecs, isMotherboard, motherboardModelKey } from './motherboard.ts';
import { extractLookSpecs, extractPsuSpecs, isDesktopPsu } from './normalize.ts';
import { extractRamSpecs, isRam, ramModelKey } from './ram.ts';
import { extractSsdSpecs, isSsd, ssdModelKey } from './ssd.ts';
import { coolerModelKey, extractCoolerSpecs, isCooler } from './cooler.ts';
import { caseModelKey, extractCaseSpecs, isCase } from './pccase.ts';
import type { CategoryId, Specs } from './types.ts';

/**
 * Ponto único por categoria: o anúncio pertence à categoria? quais specs? qual
 * chave de modelo? Adapters chamam isto e não conhecem regras de categoria.
 */
interface CategoryRules {
  matches(title: string): boolean;
  specs(title: string): Specs;
  modelKey(title: string, brand?: string): string;
}

const RULES: Partial<Record<CategoryId, CategoryRules>> = {
  psu: { matches: isDesktopPsu, specs: extractPsuSpecs, modelKey: modelKeyFromTitle },
  motherboard: { matches: isMotherboard, specs: extractMotherboardSpecs, modelKey: motherboardModelKey },
  cpu: { matches: isCpu, specs: extractCpuSpecs, modelKey: (title) => cpuModelKey(title) },
  gpu: { matches: isGpu, specs: (t) => ({ ...extractLookSpecs(t), ...extractGpuSpecs(t) }), modelKey: gpuModelKey },
  ram: { matches: isRam, specs: (t) => ({ ...extractLookSpecs(t), ...extractRamSpecs(t) }), modelKey: ramModelKey },
  ssd: { matches: isSsd, specs: (t) => ({ ...extractLookSpecs(t), ...extractSsdSpecs(t) }), modelKey: ssdModelKey },
  cooler: { matches: isCooler, specs: (t) => ({ ...extractLookSpecs(t), ...extractCoolerSpecs(t) }), modelKey: coolerModelKey },
  case: { matches: isCase, specs: (t) => ({ ...extractLookSpecs(t), ...extractCaseSpecs(t) }), modelKey: caseModelKey },
};

function rules(category: CategoryId): CategoryRules {
  const r = RULES[category];
  if (!r) throw new Error(`Categoria sem normalizador: ${category}`);
  return r;
}

export function matchesCategory(category: CategoryId, title: string): boolean {
  return rules(category).matches(title);
}

export function normalizeListing(category: CategoryId, title: string, brand?: string): { specs: Specs; modelKey: string } {
  const r = rules(category);
  return { specs: r.specs(title), modelKey: r.modelKey(title, brand) };
}
