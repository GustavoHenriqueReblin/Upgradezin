import type { CpuSpecs, MemoryType, Socket } from './types.ts';

/**
 * Fatos de plataforma que o título dos anúncios não traz: qual geração de processador
 * cada chipset aceita, frequência oficial de memória e consumo para dimensionar a fonte.
 * Tabelas fixas do repositório, a partir das especificações dos fabricantes; mudam só
 * quando sai plataforma ou geração nova.
 */

/**
 * Geração do processador, no nível que decide compatibilidade com chipset:
 *   AMD AM4: zen1 (Ryzen 1000, 2000G, Athlon), zen+ (2000, 3000G), zen2 (3000, 4000), zen3 (5000)
 *   AMD AM5: r7000, r8000, r9000
 *   Intel:   i6 … i14 (Core i e Pentium/Celeron), core1 (Core 3/5/7 série 1), ultra2 (Core Ultra 200)
 */
export type CpuFamily =
  | 'zen1' | 'zen+' | 'zen2' | 'zen3' | 'r7000' | 'r8000' | 'r9000'
  | 'i6' | 'i7' | 'i8' | 'i9' | 'i10' | 'i11' | 'i12' | 'i13' | 'i14' | 'core1' | 'ultra2';

type CpuInput = Pick<CpuSpecs, 'cpuBrand' | 'cpuLine' | 'cpuModel' | 'cpuGen'> & { socket?: Socket };

export function cpuFamily(c: CpuInput): CpuFamily | undefined {
  const model = c.cpuModel ?? '';
  const line = c.cpuLine ?? '';
  const suffix = model.replace(/^\d+/, '');
  if (c.cpuBrand === 'amd') {
    if (line === 'Athlon') return 'zen1';
    const series = Number(model[0]);
    const apu = suffix.startsWith('G');
    if (series === 1) return 'zen1';
    if (series === 2) return apu ? 'zen1' : 'zen+';
    if (series === 3) return apu ? 'zen+' : 'zen2';
    if (series === 4) return 'zen2';
    if (series === 5) return 'zen3';
    if (series === 7) return 'r7000';
    if (series === 8) return 'r8000';
    if (series === 9) return 'r9000';
    return undefined;
  }
  if (c.cpuBrand === 'intel') {
    if (line.startsWith('Core Ultra')) return 'ultra2';
    if (/^Core [357]$/.test(line)) return 'core1';
    const gen = Number(c.cpuGen?.match(/^(\d+)ª/)?.[1]);
    if (gen >= 6 && gen <= 14) return `i${gen}` as CpuFamily;
    // Pentium/Celeron série G: G44xx/G45xx 6ª, G456x/G46xx 7ª, G49xx/G5xxx 8ª–9ª, G59xx/G6xxx 10ª, G7xxx 12ª.
    const g = model.match(/^G(\d)(\d)(\d)/);
    if (g) {
      const [a, b, d] = [Number(g[1]), Number(g[2]), Number(g[3])];
      if (a === 7) return 'i12';
      if (a === 6 || (a === 5 && b === 9)) return 'i10';
      if (a === 5 || (a === 4 && b === 9)) return 'i8';
      if (a === 4) return b > 5 || (b === 5 && d >= 6) ? 'i7' : 'i6';
    }
  }
  return undefined;
}

// ---------- Chipset × geração ----------

/** 'ok' funciona; 'bios' funciona depois de atualizar a BIOS da placa; 'no' não funciona. */
export type ChipsetSupport = 'ok' | 'bios' | 'no';

const GROUPS: { chipsets: string[]; support: Partial<Record<CpuFamily, ChipsetSupport>> }[] = [
  // AM4: série 300 e 400 recebem Ryzen 3000/5000 por atualização; A520/B550 não aceitam Ryzen 1000/2000 nem 2000G/3000G.
  { chipsets: ['A320', 'B350', 'X370'], support: { zen1: 'ok', 'zen+': 'bios', zen2: 'bios', zen3: 'bios' } },
  { chipsets: ['B450', 'X470'], support: { zen1: 'ok', 'zen+': 'ok', zen2: 'bios', zen3: 'bios' } },
  { chipsets: ['A520', 'B550'], support: { zen1: 'no', 'zen+': 'no', zen2: 'ok', zen3: 'ok' } },
  { chipsets: ['X570'], support: { zen1: 'no', 'zen+': 'ok', zen2: 'ok', zen3: 'ok' } },
  // AM5: série 600 saiu com o Ryzen 7000; 8000G e 9000 pedem BIOS nova.
  { chipsets: ['A620', 'B650', 'B650E', 'X670', 'X670E'], support: { r7000: 'ok', r8000: 'bios', r9000: 'bios' } },
  { chipsets: ['B840', 'B850', 'X870', 'X870E'], support: { r7000: 'ok', r8000: 'ok', r9000: 'ok' } },
  { chipsets: ['H810', 'B860', 'Z890'], support: { ultra2: 'ok' } },
  // LGA1700: série 600 saiu com a 12ª; 13ª, 14ª e Core série 1 pedem BIOS nova.
  { chipsets: ['H610', 'B660', 'H670', 'Z690'], support: { i12: 'ok', i13: 'bios', i14: 'bios', core1: 'bios' } },
  { chipsets: ['B760', 'H770', 'Z790'], support: { i12: 'ok', i13: 'ok', i14: 'ok', core1: 'ok' } },
  // LGA1200: H410 e B460 não aceitam a 11ª; H470/Z490 aceitam com BIOS nova.
  { chipsets: ['H410', 'B460'], support: { i10: 'ok', i11: 'no' } },
  { chipsets: ['H470', 'Z490'], support: { i10: 'ok', i11: 'bios' } },
  { chipsets: ['H510', 'B560', 'H570', 'Z590'], support: { i10: 'ok', i11: 'ok' } },
  // LGA1151: mesmo encaixe, duas plataformas incompatíveis (6ª/7ª × 8ª/9ª).
  { chipsets: ['H110', 'B150', 'H170', 'Z170'], support: { i6: 'ok', i7: 'bios', i8: 'no', i9: 'no' } },
  { chipsets: ['B250', 'H270', 'Z270'], support: { i6: 'ok', i7: 'ok', i8: 'no', i9: 'no' } },
  { chipsets: ['H310', 'B360', 'H370', 'Z370'], support: { i6: 'no', i7: 'no', i8: 'ok', i9: 'bios' } },
  { chipsets: ['B365', 'Z390'], support: { i6: 'no', i7: 'no', i8: 'ok', i9: 'ok' } },
];

const SUPPORT = new Map(GROUPS.flatMap((g) => g.chipsets.map((c) => [c, g.support] as const)));

/** Se o chipset aceita a geração. undefined = chipset ou geração fora da tabela. */
export function chipsetSupport(chipset: string, family: CpuFamily): ChipsetSupport | undefined {
  const s = SUPPORT.get(chipset.toUpperCase());
  if (!s) return undefined;
  return s[family] ?? 'no';
}

/**
 * Chipsets Intel que travam a memória na frequência oficial do processador
 * (antes da série 500, só a linha Z libera; na 500, a H510 continua travada).
 */
export const MEMORY_LOCKED_CHIPSETS = new Set([
  'H110', 'B150', 'H170', 'B250', 'H270', 'H310', 'B360', 'H370', 'B365', 'H410', 'B460', 'H470', 'H510',
  // Da série 600 em diante só a de entrada fica travada (a Intel não libera overclock de memória nelas).
  'H610', 'H810',
]);

// ---------- Memória ----------

/** Frequência oficial de memória do processador (MHz), sem XMP/EXPO. */
export function cpuMemorySpeed(c: CpuInput, memory: MemoryType): number | undefined {
  const f = cpuFamily(c);
  if (!f) return undefined;
  if (c.cpuBrand === 'amd') {
    if (memory !== (f.startsWith('r') ? 'ddr5' : 'ddr4')) return undefined;
    if (c.cpuLine === 'Athlon') return 2666;
    const series = Number(c.cpuModel?.[0]);
    const apu = c.cpuModel?.replace(/^\d+/, '').startsWith('G');
    return ({ 1: 2666, 2: 2933, 3: apu ? 2933 : 3200, 4: 3200, 5: 3200, 7: 5200, 8: 5200, 9: 5600 } as Record<number, number>)[series];
  }
  const ddr4: Partial<Record<CpuFamily, number>> = {
    i6: 2133, i7: 2400, i8: 2666, i9: 2666, i10: /i[79]/.test(c.cpuLine ?? '') ? 2933 : 2666, i11: 3200,
    i12: 3200, i13: 3200, i14: 3200, core1: 3200,
  };
  const ddr5: Partial<Record<CpuFamily, number>> = { i12: 4800, i13: 5600, i14: 5600, core1: 4800, ultra2: 6400 };
  return (memory === 'ddr5' ? ddr5 : ddr4)[f];
}

// ---------- Consumo ----------

/**
 * Consumo máximo aproximado do processador (W), pelo limite de potência de referência
 * (PPT da AMD, PL2 da Intel). Serve para dimensionar a fonte, não é medição.
 */
export function cpuPower(c: CpuInput): number | undefined {
  const f = cpuFamily(c);
  if (!f) return undefined;
  const line = c.cpuLine ?? '';
  const k = /K/.test(c.cpuModel?.replace(/^\d+/, '') ?? '');
  const x = /X/.test(c.cpuModel?.replace(/^\d+/, '') ?? '');
  if (c.cpuBrand === 'amd') {
    if (line === 'Athlon') return 40;
    const tier = Number(line.match(/Ryzen (\d)/)?.[1]);
    if (f.startsWith('r')) return tier >= 9 ? 230 : tier === 7 || x ? 145 : 90; // 65 W → 88 PPT; 105 W → 142; 170 W → 230
    return tier >= 7 ? 145 : 90;
  }
  const tier = Number(line.match(/(\d)$/)?.[1]); // "Core i5" → 5, "Core Ultra 7" → 7; Pentium/Celeron → NaN
  if (!tier) return 60;
  if (f === 'ultra2') return tier === 5 ? 160 : 250;
  if (['i12', 'i13', 'i14', 'core1'].includes(f)) return tier === 3 ? 90 : tier === 5 ? (k ? 180 : 150) : tier === 7 ? (k ? 253 : 220) : 253;
  if (['i10', 'i11'].includes(f)) return tier === 3 ? 90 : tier === 5 ? (k ? 180 : 135) : tier === 7 ? (k ? 230 : 200) : 250;
  return tier === 3 ? 65 : tier === 5 ? 95 : tier === 7 ? 120 : 170; // 6ª a 9ª
}

/** Ryzen com sufixo X cujo TDP foge da regra da série (o resto: X = 105 W; AM5 Ryzen 9 = 170 W). */
const AMD_X_TDP: Record<string, number> = {
  '1600X': 95, '1700X': 95, '1800X': 95, '2600X': 95, '3600X': 95, '3600XT': 95, '3700X': 65,
  '5600X': 65, '5600XT': 65, '5700X': 65,
  '7800X3D': 120, '7900X3D': 120, '7950X3D': 120,
  '9600X': 65, '9700X': 65, '9900X': 120, '9800X3D': 120, '9900X3D': 120, '9950X3D': 170,
};

/**
 * TDP de referência do processador (W): o da AMD e o PBP da Intel, que é o que os coolers
 * informam ("para até 150 W"). Vem do relatório do CPU-Z no PC importado; para o que está à
 * venda, sai desta regra por família e sufixo, porque o título raramente traz.
 */
export function cpuTdp(c: CpuInput): number | undefined {
  const f = cpuFamily(c);
  if (!f) return undefined;
  const model = (c.cpuModel ?? '').toUpperCase();
  const suffix = model.replace(/^\d+/, '');
  const line = c.cpuLine ?? '';
  if (c.cpuBrand === 'amd') {
    if (line === 'Athlon') return 35;
    if (!suffix.includes('X')) return 65; // sem X, G, GT, F
    if (AMD_X_TDP[model]) return AMD_X_TDP[model];
    const tier = Number(line.match(/Ryzen (\d)/)?.[1]);
    if (f.startsWith('r')) return suffix.includes('X3D') ? 120 : tier >= 9 ? 170 : 105;
    return tier >= 7 || suffix.includes('X3D') ? 105 : 95;
  }
  const tier = Number(line.match(/(\d)$/)?.[1]);
  if (!tier) return 58; // Pentium/Celeron
  if (suffix.includes('T')) return 35;
  if (suffix.includes('KS')) return 150;
  const k = suffix.includes('K');
  if (['i6', 'i7', 'i8', 'i9'].includes(f)) return k ? 95 : 65;
  if (k) return 125;
  return tier === 3 && ['i12', 'i13', 'i14', 'core1'].includes(f) ? 60 : 65;
}

/** Consumo típico de cada chip de vídeo (W, valor de referência do fabricante do chip). */
export const GPU_POWER: Record<string, number> = {
  'RTX 5090': 575, 'RTX 5080': 360, 'RTX 5070 Ti': 300, 'RTX 5070': 250, 'RTX 5060 Ti': 180, 'RTX 5060': 145, 'RTX 5050': 130,
  'RTX 4090': 450, 'RTX 4080 Super': 320, 'RTX 4080': 320, 'RTX 4070 Ti Super': 285, 'RTX 4070 Ti': 285, 'RTX 4070 Super': 220,
  'RTX 4070': 200, 'RTX 4060 Ti': 165, 'RTX 4060': 115,
  'RTX 3090 Ti': 450, 'RTX 3090': 350, 'RTX 3080 Ti': 350, 'RTX 3080': 320, 'RTX 3070 Ti': 290, 'RTX 3070': 220,
  'RTX 3060 Ti': 200, 'RTX 3060': 170, 'RTX 3050': 130,
  'RTX 2080 Ti': 250, 'RTX 2080 Super': 250, 'RTX 2080': 215, 'RTX 2070 Super': 215, 'RTX 2070': 175, 'RTX 2060 Super': 175, 'RTX 2060': 160,
  'GTX 1660 Ti': 120, 'GTX 1660 Super': 125, 'GTX 1660': 120, 'GTX 1650 Super': 100, 'GTX 1650': 75, 'GTX 1630': 75,
  'GTX 1080 Ti': 250, 'GTX 1080': 180, 'GTX 1070 Ti': 180, 'GTX 1070': 150, 'GTX 1060': 120, 'GTX 1050 Ti': 75, 'GTX 1050': 75,
  'GTX 750 Ti': 60, 'GTX 750': 55, 'GT 1030': 30, 'GT 740': 65, 'GT 730': 40, 'GT 710': 20, 'GT 610': 30, 'GT 210': 30,
  'RX 9070 XT': 304, 'RX 9070 GRE': 220, 'RX 9070': 220, 'RX 9060 XT': 160, 'RX 9050': 92, 'RX 7650 GRE': 170,
  'RX 7900 XTX': 355, 'RX 7900 XT': 315, 'RX 7900 GRE': 260, 'RX 7800 XT': 263, 'RX 7700 XT': 245, 'RX 7600 XT': 190, 'RX 7600': 165,
  'RX 6950 XT': 335, 'RX 6900 XT': 300, 'RX 6800 XT': 300, 'RX 6800': 250, 'RX 6750 XT': 250, 'RX 6700 XT': 230, 'RX 6700': 175,
  'RX 6650 XT': 180, 'RX 6600 XT': 160, 'RX 6600': 132, 'RX 6500 XT': 107, 'RX 6400': 53,
  'RX 5700 XT': 225, 'RX 5700': 180, 'RX 5600 XT': 150, 'RX 5600': 150, 'RX 5500 XT': 130,
  'RX 590': 225, 'RX 580': 185, 'RX 570': 150, 'RX 560': 75, 'RX 550': 50,
  'Arc B580': 190, 'Arc B570': 150, 'Arc A770': 225, 'Arc A750': 225, 'Arc A580': 185, 'Arc A380': 75, 'Arc A310': 75,
};

/** Resto do PC (placa-mãe, memória, SSD, ventoinhas) no consumo máximo. */
export const BASE_SYSTEM_POWER = 75;

/** Margem da fonte recomendada sobre o consumo máximo estimado (picos e envelhecimento). */
export const PSU_HEADROOM = 1.3;

export const roundUp50 = (w: number) => Math.ceil(w / 50) * 50;
