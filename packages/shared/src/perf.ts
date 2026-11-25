import { cpuSheetOf, cpuSheetScore } from './cpuScore.ts';
import { cpuFamily, GPU_POWER, type CpuFamily } from './hardware.ts';
import type { CpuSpecs, GpuSpecs, Socket } from './types.ts';

/**
 * Desempenho relativo em jogos, aproximado, para achar gargalo e sugerir upgrade.
 * Não é benchmark: é a ordem de grandeza entre peças (médias de análises públicas de
 * jogos em 1080p), arredondada. Referências = 100: placa de vídeo RTX 3060 12 GB;
 * processador Ryzen 5 5600. Atualizar quando sair geração nova (docs/ARCHITECTURE.md §17.3).
 */

export const GPU_PERF: Record<string, number> = {
  'RTX 5090': 360, 'RTX 5080': 270, 'RTX 5070 Ti': 240, 'RTX 5070': 195, 'RTX 5060 Ti': 150, 'RTX 5060': 128, 'RTX 5050': 102,
  'RTX 4090': 310, 'RTX 4080 Super': 250, 'RTX 4080': 245, 'RTX 4070 Ti Super': 212, 'RTX 4070 Ti': 200, 'RTX 4070 Super': 185,
  'RTX 4070': 165, 'RTX 4060 Ti': 130, 'RTX 4060': 110,
  'RTX 3090 Ti': 200, 'RTX 3090': 185, 'RTX 3080 Ti': 180, 'RTX 3080': 165, 'RTX 3070 Ti': 142, 'RTX 3070': 135,
  'RTX 3060 Ti': 120, 'RTX 3060': 100, 'RTX 3050': 62,
  'RTX 2080 Ti': 125, 'RTX 2080 Super': 108, 'RTX 2080': 104, 'RTX 2070 Super': 98, 'RTX 2070': 88, 'RTX 2060 Super': 86, 'RTX 2060': 75,
  'GTX 1660 Ti': 64, 'GTX 1660 Super': 63, 'GTX 1660': 56, 'GTX 1650 Super': 50, 'GTX 1650': 40, 'GTX 1630': 25,
  'GTX 1080 Ti': 95, 'GTX 1080': 75, 'GTX 1070 Ti': 68, 'GTX 1070': 62, 'GTX 1060': 48, 'GTX 1050 Ti': 33, 'GTX 1050': 26,
  'GTX 950': 22, 'GTX 750 Ti': 18, 'GTX 750': 15, 'GT 1030': 14, 'GT 740': 8, 'GT 730': 6, 'GT 710': 4,
  // Antigas que ainda aparecem à venda (estoque velho e placas "para vídeo"): só para o PC importado.
  'GT 705': 3, 'GT 610': 3, 'GT 340': 3, 'GT 240': 3, 'GT 220': 2, 'GT 210': 1,
  // RX 9050 (TechPowerUp: 4% acima da RX 6600, 2% abaixo da RX 5700 XT) e RX 7650 GRE (entre a RX 7600, 98%, e a 7600 XT, 104%).
  'RX 9070 XT': 240, 'RX 9070 GRE': 190, 'RX 9070': 215, 'RX 9060 XT': 145, 'RX 9050': 96,
  'RX 7650 GRE': 114,
  'RX 7900 XTX': 255, 'RX 7900 XT': 225, 'RX 7900 GRE': 195, 'RX 7800 XT': 180, 'RX 7700 XT': 155, 'RX 7600 XT': 118, 'RX 7600': 112,
  'RX 6950 XT': 205, 'RX 6900 XT': 195, 'RX 6800 XT': 185, 'RX 6800': 160, 'RX 6750 XT': 138, 'RX 6700 XT': 130, 'RX 6700': 118,
  'RX 6650 XT': 112, 'RX 6600 XT': 108, 'RX 6600': 95, 'RX 6500 XT': 40, 'RX 6400': 33,
  'RX 5700 XT': 95, 'RX 5700': 85, 'RX 5600 XT': 75, 'RX 5600': 70, 'RX 5500 XT': 55,
  'RX 590': 55, 'RX 580': 50, 'RX 570': 45, 'RX 560': 22, 'RX 550': 15,
  // Polaris antigas e as RX da Mancer (TechPowerUp): RX 480 ~6% abaixo da RX 580, RX 470 ~6% abaixo da RX 570,
  // RX 460 um pouco abaixo da RX 560; RX 5500 (OEM, "Streaky V2") no nível da RX 5500 XT 8 GB e da GTX 1650 Super;
  // RX 560 XT (Polaris 10 cortada, "Streaky") no nível da RX 470D, da GTX 1060 3 GB e da GTX 1650.
  'RX 5500': 53, 'RX 480': 47, 'RX 470': 43, 'RX 560 XT': 40, 'RX 460': 19,
  'Arc B580': 120, 'Arc B570': 105, 'Arc A770': 105, 'Arc A750': 95, 'Arc A580': 85, 'Arc A380': 35, 'Arc A310': 25,
};

/** Vídeo integrado, quando não há placa de vídeo. */
export const IGPU_PERF = 12;

export const gpuPerf = (g: Pick<GpuSpecs, 'gpuModel'> | undefined): number | undefined => (g?.gpuModel ? GPU_PERF[g.gpuModel] : undefined);

/** Médias de rasterização em Ultra para ajustar a base ao escalar resolução (§17.4). */
const GPU_RES_SCALING: Record<string, readonly [number, number, number]> = {
  'RTX 5090': [203.8, 167.3, 110.8], 'RTX 5080': [166.9, 128.3, 77.4], 'RTX 5070 Ti': [155.4, 116.8, 68.6],
  'RTX 5060': [88.5, 59.8, 21.8], 'RTX 5050': [69.3, 45.2, 17.0],
  'RTX 4090': [183.6, 143.4, 89.1], 'RTX 4080 Super': [158.9, 118.6, 69.4], 'RTX 4080': [157.3, 117.5, 67.5],
  'RTX 4070 Ti Super': [141.2, 104.0, 58.5],
  'RTX 4070 Ti': [135.1, 97.9, 53.9], 'RTX 4070 Super': [126.7, 91.2, 49.2], 'RTX 4070': [111.5, 77.8, 41.3],
  'RTX 4060': [71.5, 47.6, 17.4], 'RTX 3090': [122.9, 91.5, 53.1], 'RTX 3060 Ti': [74.2, 51.0, 19.4],
  'RX 9070 XT': [156.6, 116.5, 65.8], 'RX 9070': [140.9, 104.0, 57.7], 'RX 9070 GRE': [120.6, 86.6, 46.3],
  'RX 7900 XTX': [161.5, 122.3, 70.6], 'RX 7900 XT': [145.4, 108.0, 59.8], 'RX 7800 XT': [118.4, 84.7, 45.1],
  'RX 7700 XT': [102.9, 72.7, 38.0], 'RX 7600': [69.9, 45.4, 18.4], 'RX 6600': [51.9, 24.8, 14.5],
  'Arc B580': [71.5, 50.7, 27.6], 'Arc B570': [63.5, 44.3, 19.6],
};

/** Índices de rasterização para o orçamento, com as referências e condições na arquitetura (§17.4). */
export function budgetGpuScore(gpu: Pick<GpuSpecs, 'gpuModel' | 'vram'> | undefined, res: Resolution): number | undefined {
  const base = gpuPerf(gpu);
  if (gpu?.gpuModel === 'RTX 3060' && gpu.vram === 8) return Math.round(100 / (res === '1080p' ? 1.17 : 1.18));
  if (gpu?.gpuModel === 'RTX 5060 Ti' && gpu.vram === 8) return Math.round(150 * { '1080p': 100.4 / 105.2, '1440p': 68.6 / 73.4, '4k': 28.1 / 40.2 }[res]);
  if (gpu?.gpuModel === 'RX 9060 XT' && gpu.vram === 8) return Math.round(145 * { '1080p': 93.2 / 98.3, '1440p': 62.5 / 67.3, '4k': 29.7 / 35.2 }[res]);
  if (gpu?.gpuModel === 'RTX 5070') return Math.round(GPU_PERF['RTX 4070']! * { '1080p': 1.16, '1440p': 1.20, '4k': 1.23 }[res]);
  if (gpu?.gpuModel === 'RTX 3070') return Math.round(GPU_PERF['RTX 4070']! / { '1080p': 1.33, '1440p': 1.30, '4k': 1.27 }[res]);
  const profile = gpu?.gpuModel ? GPU_RES_SCALING[gpu.gpuModel] : undefined;
  if (base && profile && res !== '1080p') {
    const i = res === '1440p' ? 1 : 2;
    const anchor = GPU_RES_SCALING['RTX 4070']!;
    return Math.round(base * (profile[i] / profile[0]) / (anchor[i] / anchor[0]));
  }
  return base;
}

/** Referências aproximadas para iGPU a 1080p baixo. Modelos sem referência usam o índice genérico. */
export function budgetIgpuScore(cpu: Pick<CpuSpecs, 'cpuBrand' | 'cpuModel' | 'igpu'>, sheet?: Record<string, unknown>): number | undefined {
  if (cpu.igpu !== true) return undefined;
  const model = cpu.cpuBrand === 'amd' ? cpu.cpuModel?.toUpperCase() : undefined;
  const chip = typeof sheet?.igpu === 'string' ? sheet.igpu : '';
  const score780m = GPU_PERF['RX 6600']! / 2.38;
  // Relações medidas em 1080p. Para o 740M, a estimativa escala as CUs de RDNA 3, sem alegar FPS medido.
  const scoreVega8 = score780m * 0.55;
  if (/\bUHD\s*(?:Graphics\s*)?730\b/i.test(chip)) return Math.round(scoreVega8 * 0.429);
  if (/\bUHD\s*(?:Graphics\s*)?770\b/i.test(chip)) return Math.round(score780m * 0.371);
  if (model === '8500G' || /\b740M\b/i.test(chip)) return Math.round(score780m / 1.10 / 2);
  if (model === '5700G' || model === '4750G' || model === '3400G') {
    return Math.round(scoreVega8 * (model === '3400G' ? 0.84 : model === '4750G' ? 0.94 : 1));
  }
  if (model === '5600G' || /\bVega\s*7\b/i.test(chip)) return Math.round(scoreVega8 * 0.96);
  if (/\bVega\s*8\b/i.test(chip)) return Math.round(scoreVega8 * 0.9);
  if (model === '8700G' || /\b780M\b/i.test(chip)) return Math.round(score780m);
  if (model === '8600G' || /\b760M\b/i.test(chip)) return Math.round(score780m / 1.10);
  return IGPU_PERF;
}

/** Por geração e linha. Modelos fora da curva (X3D, sem cache) ficam em CPU_MODEL_PERF. */
const CPU_PERF: Partial<Record<CpuFamily, Record<string, number>>> = {
  zen1: { Athlon: 35, 'Ryzen 3': 55, 'Ryzen 5': 62, 'Ryzen 7': 66 },
  'zen+': { 'Ryzen 3': 60, 'Ryzen 5': 68, 'Ryzen 7': 72 },
  zen2: { 'Ryzen 3': 76, 'Ryzen 5': 83, 'Ryzen 7': 87, 'Ryzen 9': 89 },
  zen3: { 'Ryzen 3': 88, 'Ryzen 5': 100, 'Ryzen 7': 106, 'Ryzen 9': 110 },
  r7000: { 'Ryzen 5': 125, 'Ryzen 7': 130, 'Ryzen 9': 135 },
  r8000: { 'Ryzen 3': 95, 'Ryzen 5': 110, 'Ryzen 7': 115 },
  r9000: { 'Ryzen 5': 135, 'Ryzen 7': 140, 'Ryzen 9': 145 },
  i6: { Celeron: 28, Pentium: 35, 'Core i3': 50, 'Core i5': 58, 'Core i7': 65 },
  i7: { Celeron: 30, Pentium: 38, 'Core i3': 53, 'Core i5': 61, 'Core i7': 68 },
  i8: { Celeron: 33, Pentium: 42, 'Core i3': 62, 'Core i5': 70, 'Core i7': 78 },
  i9: { Celeron: 33, Pentium: 42, 'Core i3': 64, 'Core i5': 74, 'Core i7': 82, 'Core i9': 85 },
  i10: { Celeron: 40, Pentium: 50, 'Core i3': 72, 'Core i5': 80, 'Core i7': 87, 'Core i9': 90 },
  i11: { 'Core i5': 88, 'Core i7': 94, 'Core i9': 96 },
  i12: { Celeron: 45, Pentium: 60, 'Core i3': 92, 'Core i5': 105, 'Core i7': 122, 'Core i9': 128 },
  i13: { 'Core i3': 95, 'Core i5': 110, 'Core i7': 140, 'Core i9': 150 },
  i14: { 'Core i3': 97, 'Core i5': 113, 'Core i7': 148, 'Core i9': 155 },
  core1: { 'Core 3': 95, 'Core 5': 110, 'Core 7': 135 },
  ultra2: { 'Core Ultra 5': 128, 'Core Ultra 7': 140, 'Core Ultra 9': 148 },
};

/** Modelos que fogem da linha: X3D (cache extra, muito melhores em jogos) e versões sem cache. */
export const CPU_MODEL_PERF: Record<string, number> = {
  '5600X3D': 122, '5700X3D': 125, '5800X3D': 132,
  '7600X3D': 158, '7800X3D': 165, '7900X3D': 150, '7950X3D': 168,
  '9800X3D': 185, '9900X3D': 172, '9950X3D': 188,
  '5500': 92, '5600G': 88, '5700G': 94, '4600G': 76, '5600GT': 90,
};

export function cpuPerf(c: Pick<CpuSpecs, 'cpuBrand' | 'cpuLine' | 'cpuModel' | 'cpuGen'> | undefined): number | undefined {
  if (!c?.cpuModel || !c.cpuLine) return undefined;
  const exact = CPU_MODEL_PERF[c.cpuModel];
  if (exact) return exact;
  const family = cpuFamily(c);
  const base = family ? CPU_PERF[family]?.[c.cpuLine] : undefined;
  if (!base) return undefined;
  // Intel K (desbloqueado) a partir da 12ª: mais núcleos e clock que o mesmo i5/i7 sem K.
  if (c.cpuBrand === 'intel' && /K/.test(c.cpuModel) && ['i12', 'i13', 'i14'].includes(family!)) return Math.round(base * (c.cpuLine === 'Core i5' ? 1.2 : 1.07));
  return base;
}

/**
 * Desempenho do processador: pela ficha técnica (arquitetura, clock boost, cache, núcleos; ver
 * cpuScore.ts) quando ela tem esses campos; senão, pela tabela por modelo e linha.
 */
export function cpuScore(specs: Parameters<typeof cpuPerf>[0], sheet?: Record<string, unknown>): number | undefined {
  return cpuSheetScore(cpuSheetOf(sheet)) ?? cpuPerf(specs);
}

/**
 * Referências de jogos v1 para a montagem pelo orçamento, Ryzen 5 5600 = 100.
 * Os ensaios e as ligações entre eles estão na seção 17.4 da arquitetura.
 */
const BUDGET_CPU_GAMING = new Map<string, number>([
  ['amd:5600', 100],
  ['amd:7600', 135],
  ['intel:12400F', 105],
  ['amd:5800X3D', 128],
  ['amd:5700X3D', Math.round(128 * 0.95)],
  ['amd:7800X3D', Math.round(128 * 1.24)],
  ['amd:9800X3D', Math.round(128 * 1.37)],
  ['amd:9600X', Math.round(128 / 0.99)],
  ['intel:14600K', Math.round(128 / 1.02)],
  ['intel:14600KF', Math.round(128 / 1.02)],
  ['intel:285K', Math.round(128 / 0.98)],
]);

/** A mesma referência por modelo vale para a oferta e para a CPU que a pessoa já tem. */
export function budgetCpuScore(specs: Parameters<typeof cpuPerf>[0], sheet?: Record<string, unknown>, current?: number): number | undefined {
  const reference = specs?.cpuModel ? BUDGET_CPU_GAMING.get(`${specs.cpuBrand}:${specs.cpuModel.toUpperCase()}`) : undefined;
  return reference ?? current ?? cpuScore(specs, sheet);
}

/** Consumo da placa de vídeo (W): o de referência do chip; sem ele, o da ficha. */
export const gpuPower = (model: string | undefined, sheet?: Record<string, unknown>): number | undefined =>
  (model ? GPU_POWER[model] : undefined) ?? (typeof sheet?.tdpW === 'number' ? sheet.tdpW : undefined);

/** Placa de vídeo de 8 linhas PCIe ou menos: pela ficha ("4.0 x8"); sem ela, pela lista de chips. */
export function gpuX8(model: string | undefined, sheet?: Record<string, unknown>): boolean {
  const lanes = Number(String(sheet?.pcie ?? '').match(/x(\d{1,2})\b/i)?.[1]);
  return lanes ? lanes <= 8 : !!model && GPU_PCIE_X8.has(model);
}

/** Linhas de processador que existem para cada encaixe (melhor de cada uma), para saber se ainda dá para subir sem trocar a placa. */
export const SOCKET_FAMILIES: Record<Socket, CpuFamily[]> = {
  AM4: ['zen1', 'zen+', 'zen2', 'zen3'],
  AM5: ['r7000', 'r8000', 'r9000'],
  LGA1151: ['i6', 'i7', 'i8', 'i9'],
  LGA1200: ['i10', 'i11'],
  LGA1700: ['i12', 'i13', 'i14', 'core1'],
  LGA1851: ['ultra2'],
};

/** O melhor processador para jogos de cada encaixe (para dizer "você já está no topo"). */
export const SOCKET_TOP: Record<Socket, { name: string; perf: number }> = {
  AM4: { name: 'Ryzen 7 5800X3D', perf: 132 },
  AM5: { name: 'Ryzen 7 9800X3D', perf: 185 },
  LGA1151: { name: 'Core i9-9900K', perf: 85 },
  LGA1200: { name: 'Core i9-11900K', perf: 96 },
  LGA1700: { name: 'Core i9-14900K', perf: 155 },
  LGA1851: { name: 'Core Ultra 9 285K', perf: 148 },
};

/** Linhas (do encaixe) com desempenho pelo menos `min`, e a família de cada. */
export function cpuLinesAbove(socket: Socket, min: number): { family: CpuFamily; line: string; perf: number }[] {
  const out: { family: CpuFamily; line: string; perf: number }[] = [];
  for (const family of SOCKET_FAMILIES[socket]) for (const [line, perf] of Object.entries(CPU_PERF[family] ?? {})) if (perf >= min) out.push({ family, line, perf });
  return out;
}

/**
 * Placas de vídeo que usam só 8 linhas PCIe (ou 4): numa placa-mãe PCIe 3.0 perdem desempenho,
 * principalmente as de 8 GB. As demais usam 16 linhas.
 */
export const GPU_PCIE_X8 = new Set([
  'RTX 5060 Ti', 'RTX 5060', 'RTX 5050', 'RTX 4060 Ti', 'RTX 4060', 'RTX 3050',
  'RX 7650 GRE', 'RX 7600 XT', 'RX 7600', 'RX 6650 XT', 'RX 6600 XT', 'RX 6600', 'RX 6500 XT', 'RX 6400', 'RX 5500 XT', 'RX 5500', 'RX 560', 'RX 460',
  'Arc B580', 'Arc B570', 'Arc A380', 'Arc A310',
]);

/** Geração PCIe do slot da placa de vídeo, pelo chipset (com o processador da mesma geração). */
export function chipsetPcie(chipset: string | undefined): 3 | 4 | 5 | undefined {
  if (!chipset) return undefined;
  if (/^(A320|B350|X370|B450|X470|A520)$/.test(chipset)) return 3;
  if (/^(B550|X570)$/.test(chipset)) return 4;
  if (/^(H110|B150|H170|Z170|B250|H270|Z270|H310|B360|H370|B365|Z370|Z390|H410|B460|H470|Z490)$/.test(chipset)) return 3;
  if (/^(H510|B560|H570|Z590|H610|B660|H670|B760|H770|A620|B650|X670|B840|B850)$/.test(chipset)) return 4;
  if (/^(Z690|Z790|B650E|X670E|X870|X870E|H810|B860|Z890)$/.test(chipset)) return 5;
  return undefined;
}

/** Chipsets de entrada: menos recursos e, em geral, regulagem de energia (VRM) mais simples. */
export const ENTRY_CHIPSETS = new Set(['A320', 'B350', 'B450', 'A520', 'H310', 'H410', 'H510', 'H610', 'A620', 'H810']);

export type Resolution = '1080p' | '1440p' | '4k';
export const resolutionOf = (width?: number, height?: number): Resolution => {
  const px = (width ?? 1920) * (height ?? 1080);
  return px >= 3840 * 2160 * 0.8 ? '4k' : px >= 2560 * 1440 * 0.8 ? '1440p' : '1080p';
};

/** Em resolução maior a placa de vídeo trabalha mais e o processador pesa menos. */
const RES_FACTOR: Record<Resolution, number> = { '1080p': 1, '1440p': 0.8, '4k': 0.62 };

/**
 * Processador que a placa de vídeo pede para não ficar esperando, na mesma escala de cpuPerf.
 * Calibrado nos pares equilibrados: RTX 3060 + Ryzen 5 5600 (1080p) e RTX 4090 + Ryzen 7 9800X3D.
 * Monitor de 144 Hz ou mais pede um pouco mais do processador.
 */
export function cpuNeeded(gpu: number, res: Resolution, hz = 60): number {
  return (60 + 0.4 * gpu * RES_FACTOR[res]) * (hz >= 120 ? 1.05 : 1);
}

/** Placa de vídeo que o processador aguenta sem ser o gargalo (inverso de cpuNeeded). */
export function gpuMatching(cpu: number, res: Resolution, hz = 60): number {
  return (cpu / (hz >= 120 ? 1.05 : 1) - 60) / 0.4 / RES_FACTOR[res];
}

/** Teto de GPU estimado para orçamento. A resposta é moderada acima do par de referência 5600/3060 em 1080p. */
export function budgetCpuCapacity(cpu: number, res: Resolution, hz = 60): number {
  const exponent = 1.8;
  const refresh = 1 + 0.05 * Math.min(180 / 84, Math.max(0, (hz - 60) / 84));
  return 100 * Math.pow(cpu / 100, exponent) / (RES_FACTOR[res] * refresh);
}

/** Interpolação da transição em torno do gargalo, com perda limitada a 2,5% no ponto de equilíbrio. */
export function budgetGamingScore(cpu: number, gpu: number, res: Resolution, hz?: number): number {
  if (!(cpu > 0) || !(gpu > 0)) return 0;
  const ceiling = budgetCpuCapacity(cpu, res, hz);
  const lower = Math.min(ceiling, gpu);
  const band = lower * 0.10;
  if (!(band > 0)) return 0;
  const overlap = Math.max(0, band - Math.abs(ceiling - gpu));
  return lower - overlap * overlap / (4 * band);
}
