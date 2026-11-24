import type { Offer } from './types.ts';

/**
 * Desempenho do processador em jogos calculado da ficha técnica (docs/ARCHITECTURE.md §17.3), na
 * mesma escala de perf.ts (Ryzen 5 5600 = 100). Em jogos pesa o desempenho por núcleo:
 *
 *   nota = 100 × IPC da arquitetura × (boost ÷ 4,4 GHz) × cache × núcleos
 *
 * - IPC: quanto cada arquitetura faz por clock em jogos, relativo à Zen 3 (média de análises públicas
 *   de jogos com o clock igualado; Zen 5 rende pouco acima da Zen 4 em jogos).
 * - Cache: L3 grande (os X3D, 96 MB ou mais) rende muito em jogos; L3 pequeno (APUs AMD com 16 MB
 *   ou menos), menos.
 * - Núcleos: abaixo de 6 os jogos atuais já perdem; 4 núcleos sem threads extras, bem mais.
 *
 * Conferido com a tabela por modelo (perf.ts) nos pares conhecidos: fica dentro de ~10%.
 */

export interface CpuSheet {
  architecture?: string;
  boostGhz?: number;
  l3Mb?: number;
  cores?: number;
  threads?: number;
}

/** IPC em jogos, relativo à Zen 3. Inclui os codinomes que o CPU-Z mostra. */
const IPC: [RegExp, number][] = [
  [/zen\s*5|granite ridge/i, 1.1],
  [/zen\s*4|raphael|phoenix|dragon range/i, 1.13],
  [/zen\s*3|vermeer|cezanne|barcel[oó]/i, 1.0],
  [/zen\s*2|matisse|renoir|lucienne|mendocino/i, 0.88],
  [/zen\s*\+|zen\+|pinnacle ridge|picasso/i, 0.78],
  [/\bzen\b|summit ridge|raven ridge/i, 0.72],
  [/arrow lake/i, 1.04],
  [/raptor lake/i, 1.08],
  [/alder lake/i, 1.05],
  [/rocket lake/i, 0.84],
  [/comet lake|coffee lake|kaby lake|skylake|whiskey lake/i, 0.78],
];

export const cpuIpc = (architecture: string | undefined): number | undefined => (architecture ? IPC.find(([re]) => re.test(architecture))?.[1] : undefined);

/** AMD (Zen e os codinomes): o L3 pequeno das APUs pesa; nos Intel o L3 sempre foi menor e já está no IPC. */
const AMD_ARCH = /zen|vermeer|cezanne|barcel|matisse|renoir|lucienne|mendocino|pinnacle|picasso|summit|raven|raphael|phoenix|dragon|granite/i;

/** Fator do cache L3. */
function cacheFactor(l3: number | undefined, architecture: string): number {
  if (!l3) return 1;
  if (l3 >= 96) return 1.28;
  if (l3 <= 16 && AMD_ARCH.test(architecture)) return 0.9;
  return 1;
}

/** Fator dos núcleos e threads. */
function coreFactor(cores: number | undefined, threads: number | undefined): number {
  if (!cores) return 1;
  if (cores >= 8) return 1.04;
  if (cores >= 6) return 1;
  if (cores >= 4) return threads && threads > cores ? 0.9 : 0.85;
  return 0.6;
}

/** Nota pela ficha; undefined sem arquitetura conhecida ou sem clock boost. */
export function cpuSheetScore(s: CpuSheet | undefined): number | undefined {
  const ipc = cpuIpc(s?.architecture);
  if (!s || !ipc || !s.boostGhz || s.boostGhz < 1 || s.boostGhz > 7) return undefined;
  return Math.round(100 * ipc * (s.boostGhz / 4.4) * cacheFactor(s.l3Mb, s.architecture!) * coreFactor(s.cores, s.threads));
}

/** A ficha (valores soltos, como vêm na oferta) no formato da nota. */
export function cpuSheetOf(v: Record<string, unknown> | undefined): CpuSheet | undefined {
  if (!v) return undefined;
  const n = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() && Number.isFinite(Number(x)) ? Number(x) : undefined);
  return {
    architecture: typeof v.architecture === 'string' ? v.architecture : undefined,
    boostGhz: n(v.boostGhz),
    l3Mb: n(v.l3Mb),
    cores: n(v.cores),
    threads: n(v.threads),
  };
}

/**
 * Ficha do processador `model` ("5800X3D") entre as ofertas: a do mesmo modelo com mais campos da nota
 * (arquitetura, boost, cache, núcleos, threads). undefined: o catálogo não tem o modelo com ficha.
 */
export function cpuSheetFor(offers: Offer[], model: string): Record<string, number | string | boolean> | undefined {
  const want = model.toUpperCase();
  const filled = (v: Record<string, unknown>) => (['architecture', 'boostGhz', 'l3Mb', 'cores', 'threads'] as const).filter((k) => v[k] !== undefined && v[k] !== '').length;
  let best: Record<string, number | string | boolean> | undefined;
  for (const o of offers) {
    if (o.specs.cpuModel?.toUpperCase() !== want || !o.sheet) continue;
    if (!best || filled(o.sheet) > filled(best)) best = o.sheet;
  }
  return best;
}

