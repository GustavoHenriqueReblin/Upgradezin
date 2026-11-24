import { isWhite, stripAccents } from './normalize.ts';
import type { CoolerSpecs, CpuBrand } from './types.ts';

const plain = (title: string) => stripAccents(title).toLowerCase();

/**
 * Cooler de processador (air ou water). Descarta ventoinha de gabinete, cooler de notebook
 * ou de placa de vídeo, pasta térmica, suportes e kits com outras peças.
 */
export function isCooler(title: string): boolean {
  const t = plain(title);
  if (!/^\s*(?:air\s*cooler|water\s*cooler|watercooler|cooler)\b/.test(t)) return false;
  if (/notebook|laptop|gabinete|placa\s*de\s*video|\bvga\b|\bgpu\b|pasta\s*termica|suporte|controladora|\bhub\b|\+\s*(?:processador|placa|memoria)/.test(t)) return false;
  // Cooler avulso precisa ser para processador (ou water cooler, que sempre é).
  return /processador|\bcpu\b|water\s*cooler|watercooler|\baio\b/.test(t);
}

/** Encaixes que o título lista (os de Intel 115x viram um só). O número solto ("1700") ou grudado no "LGA" ("LGA1151"). */
const SOCKET_RES: [RegExp, string][] = [
  [/\bam5\b/, 'AM5'],
  [/\bam4\b/, 'AM4'],
  [/(?:\b|(?<=lga))1851p?\b/, 'LGA1851'],
  [/(?:\b|(?<=lga))1700p?\b/, 'LGA1700'],
  [/(?:\b|(?<=lga))1200p?\b/, 'LGA1200'],
  [/(?:\b|(?<=lga))115[0156x]p?\b/, 'LGA115X'],
];

export function extractCoolerSpecs(title: string): CoolerSpecs {
  const t = plain(title);
  const specs: CoolerSpecs = {};
  specs.coolerType = /water\s*cooler|watercooler|\baio\b|liquid/.test(t) ? 'water' : 'air';

  const mm = [...t.matchAll(/\b(\d{2,3})\s*mm\b/g)].map((m) => Number(m[1]));
  if (specs.coolerType === 'water') {
    const r = mm.find((v) => [120, 140, 240, 280, 360, 420].includes(v)) ?? Number(t.match(/\b(120|240|280|360|420)\b/)?.[1] ?? 0);
    if (r) specs.radiator = r;
  }

  const brands: CpuBrand[] = [];
  if (/intel|\blga\b|115x|1700|1851|1200/.test(t)) brands.push('intel');
  if (/\bamd\b|amdintel|\bam[45]\b/.test(t)) brands.push('amd');
  if (/universal/.test(t)) for (const b of ['intel', 'amd'] as const) if (!brands.includes(b)) brands.push(b);
  if (brands.length) specs.coolerBrands = brands;

  const sockets = SOCKET_RES.filter(([re]) => re.test(t)).map(([, s]) => s);
  if (sockets.length) specs.coolerSockets = sockets;

  const tdp = t.match(/\bt[dg]p\s*(?:de\s*)?(\d{2,3})\s*w/)?.[1] ?? t.match(/\b(\d{3})\s*w\b/)?.[1];
  if (tdp && Number(tdp) >= 35 && Number(tdp) <= 400) specs.coolerTdp = Number(tdp);
  return specs;
}

const NOISE = new Set([
  'cooler', 'air', 'water', 'para', 'processador', 'cpu', 'p', 'de', 'com', 'e', 'intel', 'amd', 'intelamd', 'mm', 'argb', 'rgb', 'led',
  'pwm', 'fan', 'fans', 'preto', 'black', 'branco', 'white', 'gamer', 'universal', 'display', 'lcd', 'digital',
]);

/** Chave de modelo: marca + linha (sem números soltos) + tipo + radiador + cor. */
export function coolerModelKey(title: string, brand?: string): string {
  const head = plain(title).split(/,| - /)[0]!;
  const s = extractCoolerSpecs(title);
  const b = brand ? plain(brand).replace(/[^a-z0-9 ]+/g, '') : '';
  const words = [...new Set(head.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/))]
    .filter((w) => w && !NOISE.has(w) && !b.split(' ').includes(w) && !/^\d+(mm)?$/.test(w))
    .sort();
  return [b, ...words, s.coolerType ?? '', s.radiator ? String(s.radiator) : '', isWhite(title) ? 'white' : ''].filter(Boolean).join(' ');
}
