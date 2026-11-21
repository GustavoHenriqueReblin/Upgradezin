import { isWhite, stripAccents } from './normalize.ts';
import type { GpuMaker, GpuSpecs } from './types.ts';

const plain = (title: string) => stripAccents(title).toLowerCase();

const cap = (s?: string) => (s ? ` ${s.replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}` : '');

/** Chip da placa: "RTX 5060 Ti", "RX 9060 XT", "GTX 1650", "Arc B580". */
export function extractGpuModel(title: string): { maker: GpuMaker; model: string } | undefined {
  const t = plain(title);
  let m: RegExpMatchArray | null;
  // RTX de jogos: x050–x090 ("RTX 4060"). RTX 2000/4000/4500/5000/6000 são placas profissionais: fora.
  if ((m = t.match(/\brtx\s*(\d{4})\s*(ti\s*super|ti|super)?\b/)))
    return /^\d0[5-9]0$/.test(m[1]!) ? { maker: 'nvidia', model: `RTX ${m[1]}${cap(m[2])}` } : undefined;
  if ((m = t.match(/\bgtx\s*(\d{3,4})\s*(ti|super)?\b/))) return { maker: 'nvidia', model: `GTX ${m[1]}${cap(m[2])}` };
  if ((m = t.match(/\bgt\s*(\d{3,4})\b/))) return { maker: 'nvidia', model: `GT ${m[1]}` };
  if ((m = t.match(/\brx\s*(\d{3,4})\s*(xtx|xt|gre)?\b/))) return { maker: 'amd', model: `RX ${m[1]}${m[2] ? ` ${m[2].toUpperCase()}` : ''}` };
  if ((m = t.match(/\barc\s*([ab]\d{3})\b/))) return { maker: 'intel', model: `Arc ${m[1]!.toUpperCase()}` };
  return undefined;
}

/** Série do chip: "RTX 5060 Ti" → "RTX 50", "GTX 1660 Super" → "GTX 16", "RX 7600" → "RX 7000", "Arc B580" → "Arc B". */
export function gpuSeriesOf(model: string): string | undefined {
  let m: RegExpMatchArray | null;
  if ((m = model.match(/^RTX (\d{2})\d{2}/))) return `RTX ${m[1]}`;
  if ((m = model.match(/^GTX (\d{2})\d{2}/))) return `GTX ${m[1]}`;
  if (/^GTX \d{3}\b/.test(model) || /^GT \d/.test(model)) return 'GT';
  if ((m = model.match(/^RX (\d)\d{3}/))) return `RX ${m[1]}000`;
  if (/^RX \d{3}\b/.test(model)) return 'RX 500';
  if ((m = model.match(/^Arc ([AB])/))) return `Arc ${m[1]}`;
  return undefined;
}

/** Placa de vídeo avulsa (descarta suporte, cabo, riser, placa de captura, kits). */
export function isGpu(title: string): boolean {
  const t = plain(title);
  if (!/^\s*(?:placa\s*de\s*video|gpu)\b/.test(t)) return false;
  if (/suporte|\bcabo\b|riser|captura|\bkit\b|combo|\+\s*(?:processador|placa)/.test(t)) return false;
  return !!extractGpuModel(title);
}

export function extractGpuSpecs(title: string): GpuSpecs {
  const t = plain(title);
  const specs: GpuSpecs = {};
  const chip = extractGpuModel(title);
  if (chip) {
    specs.gpuMaker = chip.maker;
    specs.gpuModel = chip.model;
    const series = gpuSeriesOf(chip.model);
    if (series) specs.gpuSeries = series;
  }
  // "8GB", "8 GB", "12G" (Gigabyte: "OC 12G"). Faixa plausível de VRAM.
  const vram = t.match(/\b(\d{1,2})\s*gb\b/)?.[1] ?? t.match(/\b(\d{1,2})g\b/)?.[1];
  if (vram && Number(vram) >= 1 && Number(vram) <= 48) specs.vram = Number(vram);
  const type = t.match(/\bgddr\s*(7|6x|6|5x|5)\b/)?.[1];
  if (type) specs.vramType = `GDDR${type.toUpperCase()}`;
  if (/low[\s-]*profile|\blp\b/.test(t)) specs.lowProfile = true;
  return specs;
}

/** Palavras que não distinguem o modelo da placa (fabricante do chip, specs, marketing). */
const NOISE = new Set([
  'placa', 'de', 'video', 'vga', 'gpu', 'nvidia', 'geforce', 'amd', 'radeon', 'intel', 'arc', 'rtx', 'gtx', 'gt', 'rx',
  'ti', 'super', 'xt', 'xtx', 'gre', 'gb', 'gddr', 'bits', 'bit', 'edition', 'graphics', 'card', 'com', 'e', 'rev',
  'preta', 'preto', 'black', 'branca', 'branco', 'white', 'snow', 'gaming', 'gamer', 'nova', 'versao',
]);

/**
 * Chave de modelo: marca da placa + chip + VRAM + palavras da linha (em ordem
 * alfabética, porque cada loja escreve numa ordem).
 *   "Placa de Vídeo Gigabyte RTX 5060 EAGLE MAX OC 8GB NVIDIA GeForce, 8GB GDDR7" -> "gigabyte rtx 5060 8gb eagle max oc"
 */
export function gpuModelKey(title: string, brand?: string): string {
  const head = plain(title).split(/,| - /)[0]!;
  const chip = extractGpuModel(title)?.model.toLowerCase() ?? '';
  const vram = extractGpuSpecs(title).vram;
  const b = brand ? plain(brand).replace(/[^a-z0-9 ]+/g, '') : '';
  const words = [...new Set(head.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/))]
    .filter((w) => w && !/\d/.test(w) && !NOISE.has(w) && !b.split(' ').includes(w))
    .sort();
  return [b, chip, vram ? `${vram}gb` : '', ...words, isWhite(title) ? 'white' : ''].filter(Boolean).join(' ');
}
