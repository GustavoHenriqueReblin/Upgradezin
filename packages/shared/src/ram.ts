import { isWhite, stripAccents } from './normalize.ts';
import type { MemoryType, RamSpecs } from './types.ts';

const plain = (title: string) => stripAccents(title).toLowerCase();

/** Memória RAM de PC desktop, DDR4 ou DDR5 (descarta notebook/SODIMM, servidor/ECC, DDR3 e kits com outras peças). */
export function isRam(title: string): boolean {
  const t = plain(title);
  if (!/^\s*memoria\b/.test(t)) return false;
  if (/notebook|laptop|so-?dimm|servidor|server|\becc\b|registered|rdimm|lrdimm|\bmac\b|imac|\bkit\s+upgrade|\+\s*(?:processador|placa)/.test(t)) return false;
  return /ddr[45]\b/.test(t) && !/ddr[23]\b/.test(t);
}

export function extractRamSpecs(title: string): RamSpecs & { memory?: MemoryType } {
  const t = plain(title);
  const specs: RamSpecs & { memory?: MemoryType } = {};
  if (/ddr5/.test(t)) specs.memory = 'ddr5';
  else if (/ddr4/.test(t)) specs.memory = 'ddr4';

  // "32GB (2x16GB)", "Kit 2x16GB", "2 x 8GB": kit; senão "16GB" avulso.
  const kit = t.match(/(\d)\s*x\s*(\d{1,3})\s*gb\b/);
  if (kit) {
    specs.ramModules = Number(kit[1]);
    specs.ramCapacity = Number(kit[1]) * Number(kit[2]);
  } else {
    const gb = t.match(/\b(\d{1,3})\s*gb\b/)?.[1];
    if (gb) {
      specs.ramCapacity = Number(gb);
      specs.ramModules = 1;
    }
  }

  // "3200MHz", "3200 Mhz", "6000MT/s"
  const speed = t.match(/\b(\d{4})\s*(?:mhz|mt\/s)/)?.[1];
  if (speed && Number(speed) >= 1600 && Number(speed) <= 12000) specs.ramSpeed = Number(speed);

  const cl = t.match(/\bcl\s*-?\s*(\d{2})\b/)?.[1];
  if (cl) specs.ramLatency = Number(cl);

  return specs;
}

/** Palavras que não distinguem a linha do pente. */
const NOISE = new Set([
  'memoria', 'ram', 'para', 'desktop', 'pc', 'dimm', 'udimm', 'gamer', 'gaming', 'kit', 'de', 'com', 'e', 'mhz', 'mt',
  'gb', 'cl', 'intel', 'amd', 'xmp', 'expo', 'rgb', 'argb', 'led', 'preta', 'preto', 'black', 'branca', 'branco', 'white', 'snow',
]);

/**
 * Chave de modelo: marca + palavras da linha (sem números, em ordem alfabética)
 * + capacidade, pentes, tipo e frequência, + RGB e cor.
 *   "Memória RAM Kingston Fury Beast, 16GB, 3200MHz, DDR4, CL16, Preto" -> "kingston beast fury 16gb 1x ddr4 3200"
 */
export function ramModelKey(title: string, brand?: string): string {
  const head = plain(title).split(/,| - /)[0]!;
  const s = extractRamSpecs(title);
  const b = brand ? plain(brand).replace(/[^a-z0-9 ]+/g, '') : '';
  const words = [...new Set(head.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/))]
    .filter((w) => w && !/\d/.test(w) && !NOISE.has(w) && !b.split(' ').includes(w))
    .sort();
  const rgb = /\ba?rgb\b/.test(plain(title)) ? 'rgb' : '';
  return [
    b,
    ...words,
    s.ramCapacity ? `${s.ramCapacity}gb` : '',
    s.ramModules ? `${s.ramModules}x` : '',
    s.memory ?? '',
    s.ramSpeed ? String(s.ramSpeed) : '',
    rgb,
    isWhite(title) ? 'white' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
