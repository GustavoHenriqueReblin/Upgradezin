import { budgetCpuScore, budgetGamingScore, budgetGpuScore, budgetIgpuScore, checkBuild, cpuScore, effectiveCash, gpuPerf, SOCKET_MEMORY, withSheetSpecs,
  type CategoryId, type PcProfile, type ProductPage, type Resolution, type Specs } from '@upgradezin/shared';
import { splitOffers } from './product.ts';

export function compareKeys(params: URLSearchParams): string[] {
  return [...new Set(params.getAll('peca').filter((key) => key.trim() && key.length <= 400))];
}

export function groupComparison(products: ProductPage[]): Map<CategoryId, ProductPage[]> {
  const groups = new Map<CategoryId, ProductPage[]>();
  for (const product of products) {
    const group = groups.get(product.category) ?? [];
    group.push(product);
    groups.set(product.category, group);
  }
  return groups;
}

export function compareUrl(keys: string[]): string {
  const params = new URLSearchParams();
  for (const key of keys) params.append('peca', key);
  return keys.length ? `/comparar?${params}` : '/comparar';
}

/** Mesmas peças, em qualquer ordem. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(b);
  return a.length === b.length && a.every((key) => set.has(key));
}

export function comparisonMetrics(page: ProductPage) {
  const { best, main } = splitOffers(page.offers);
  const catalogSpecs = (best ?? main[0] ?? page.offers[0])?.specs ?? {};
  const specs = { ...catalogSpecs, ...withSheetSpecs(page.category, catalogSpecs, page.values) };
  const score = page.category === 'cpu' ? cpuScore(specs, page.values) : page.category === 'gpu' ? gpuPerf(specs) : undefined;
  const price = best ? effectiveCash(best) : undefined;
  return { specs, score, price, best, value: score && price && price > 0 ? score / price * 1000 : undefined };
}

export type ComparisonSort = 'overall' | 'price' | 'score' | 'value';

export function comparisonName(page: ProductPage, specs: ReturnType<typeof comparisonMetrics>['specs']): string {
  if (page.category === 'cpu' && specs.cpuLine && specs.cpuModel) return `${specs.cpuLine} ${specs.cpuModel}`;
  if (page.category === 'gpu' && specs.gpuModel) return specs.vram ? `${specs.gpuModel} ${specs.vram} GB` : specs.gpuModel;
  return page.title;
}

export function rankComparison(pages: ProductPage[], sort: ComparisonSort = 'overall') {
  const entries = pages.map((page) => ({ page, ...comparisonMetrics(page) }));
  const topScore = Math.max(0, ...entries.map(({ score }) => score ?? 0));
  const topValue = Math.max(0, ...entries.map(({ value }) => value ?? 0));
  const lowestPrice = Math.min(Infinity, ...entries.map(({ price }) => price ?? Infinity));
  const ranked = entries.map((entry) => ({
    ...entry,
    overall: entry.score && entry.value ? 75 * entry.score / topScore + 25 * entry.value / topValue : undefined,
  }));
  const bestOverall = Math.max(-1, ...ranked.map(({ overall }) => overall ?? -1));
  const order = (a: typeof ranked[number], b: typeof ranked[number]) => sort === 'price'
    ? (a.price ?? Infinity) - (b.price ?? Infinity)
    : (b[sort] ?? -1) - (a[sort] ?? -1);
  ranked.sort((a, b) => order(a, b) || (b.overall ?? -1) - (a.overall ?? -1) ||
    (b.score ?? -1) - (a.score ?? -1) || (a.price ?? Infinity) - (b.price ?? Infinity) || a.page.key.localeCompare(b.page.key));
  return { ranked, topScore, topValue, lowestPrice, bestOverall };
}

export function relativeGain(score?: number, reference?: number): number | undefined {
  return score !== undefined && reference !== undefined && reference > 0 ? (score / reference - 1) * 100 : undefined;
}

export function comparisonCpuCompatibility(pc: PcProfile, specs: Specs): { status: string; parts: string } {
  const board = pc.motherboard?.specs;
  const installed = pc.cpu?.specs;
  const socket = board?.socket ?? installed?.socket;
  const platformMemory = socket ? SOCKET_MEMORY[socket] : undefined;
  const memory = pc.ram?.specs.memory ?? board?.memory ?? (platformMemory?.length === 1 ? platformMemory[0] : undefined);
  const boardForCheck = socket ? { specs: { ...board, socket } } : undefined;
  const issues = checkBuild({ motherboard: boardForCheck, cpu: { specs }, ram: memory ? { specs: { memory } } : undefined }).issues;
  const has = (code: string) => issues.some((issue) => issue.code === code);
  const changesPlatform = has('socket-mismatch');
  const needsBoard = changesPlatform || has('chipset-unsupported');
  const acceptedMemory = specs.socket ? SOCKET_MEMORY[specs.socket] : undefined;
  const needsMemory = has('memory-cpu-mismatch');
  const parts = [
    ...(needsBoard ? [`Placa-mãe ${specs.socket}`] : []),
    ...(needsMemory && acceptedMemory ? [acceptedMemory.join(' ou ').toUpperCase()] : []),
  ];
  const sameModel = !!specs.cpuBrand && !!specs.cpuModel && specs.cpuBrand === installed?.cpuBrand &&
    specs.cpuModel.toUpperCase() === installed?.cpuModel?.toUpperCase();
  const unknown = !socket || !specs.socket || has('chipset-unknown') || !memory;
  const status = changesPlatform ? 'Requer mudança de plataforma'
    : needsBoard ? 'Requer outra placa-mãe'
    : needsMemory ? 'Requer outra memória'
    : sameModel ? 'Compatível'
    : has('chipset-bios') ? 'Pode exigir atualização de BIOS'
    : unknown ? 'Compatibilidade a confirmar' : 'Compatível';
  if (needsBoard && !memory) parts.push('Verificar memória');
  return { status, parts: parts.join(' + ') || (unknown && !sameModel ? 'A confirmar' : 'Nenhum') };
}

/** Índice combinado ao trocar só a peça comparada e manter o restante do PC. */
export function comparisonComputer(pc: PcProfile, res: Resolution, hz?: number, cpuSheet?: ProductPage['values']) {
  const cpu = budgetCpuScore(pc.cpu?.specs, cpuSheet);
  const dedicated = pc.gpu ? budgetGpuScore(pc.gpu.specs, res) : undefined;
  const gpu = pc.gpu ? dedicated : pc.cpu && budgetIgpuScore(pc.cpu.specs, cpuSheet);
  const combined = (cpuScore?: number, gpuScore?: number) => cpuScore && gpuScore ? budgetGamingScore(cpuScore, gpuScore, res, hz) : undefined;
  return {
    baseline: combined(cpu, gpu),
    withPart: ({ page, specs }: ReturnType<typeof comparisonMetrics> & { page: ProductPage }) => {
      if (page.category === 'gpu') return combined(cpu, budgetGpuScore(specs, res));
      if (page.category === 'cpu') return combined(budgetCpuScore(specs, page.values), pc.gpu ? dedicated : budgetIgpuScore(specs, page.values));
      return undefined;
    },
  };
}

export async function fetchProduct(key: string, signal?: AbortSignal): Promise<ProductPage> {
  const response = await fetch(`/api/products/${encodeURIComponent(key)}`, { signal });
  if (!response.ok) throw new Error(response.status === 404 ? 'not-found' : 'failed');
  return response.json() as Promise<ProductPage>;
}
