import { extractCoolerSpecs } from '../cooler.ts';
import { extractCpuSpecs } from '../cpu.ts';
import { extractGpuSpecs } from '../gpu.ts';
import { cpuFamily, GPU_POWER, type CpuFamily } from '../hardware.ts';
import { extractMotherboardSpecs } from '../motherboard.ts';
import { brandFromTitle, extractPsuSpecs, stripAccents } from '../normalize.ts';
import { extractCaseSpecs } from '../pccase.ts';
import { extractRamSpecs } from '../ram.ts';
import { extractSsdSpecs } from '../ssd.ts';
import type { CategoryId, FormFactor } from '../types.ts';
import { SHEET_FIELDS, type SheetValues } from './fields.ts';

/**
 * Campos da ficha pelo título do anúncio: o que a página não trouxe e o título diz ("750W, 80 Plus Gold,
 * Full Modular", "B550M, AM4, mATX, DDR4", "M.2 2280, PCIe 4.0"). Usa os mesmos extratores de título da
 * busca e devolve os valores no formato do leitor da ficha (read.ts). Também o que decorre do modelo,
 * sem chute: a arquitetura do processador pela geração, o consumo de referência do chip de vídeo.
 *
 * A ficha da página vale mais: o título só preenche o que faltou (sheets.ts, no servidor).
 */

const plain = (s: string) => stripAccents(s).toLowerCase();

const FORM_NAME: Record<FormFactor, string> = { 'mini-itx': 'Mini-ITX', matx: 'Micro-ATX', atx: 'ATX', eatx: 'E-ATX' };
const FORM_ORDER: FormFactor[] = ['eatx', 'atx', 'matx', 'mini-itx'];

/** Arquitetura de cada geração, no nome que o leitor da ficha usa ("Zen 3", "Raptor Lake"). */
const ARCH_OF: Record<CpuFamily, string> = {
  zen1: 'Zen',
  'zen+': 'Zen+',
  zen2: 'Zen 2',
  zen3: 'Zen 3',
  r7000: 'Zen 4',
  r8000: 'Zen 4',
  r9000: 'Zen 5',
  i6: 'Skylake',
  i7: 'Kaby Lake',
  i8: 'Coffee Lake',
  i9: 'Coffee Lake',
  i10: 'Comet Lake',
  i11: 'Rocket Lake',
  i12: 'Alder Lake',
  i13: 'Raptor Lake',
  // A 14ª é o "Raptor Lake Refresh", mas as fichas chamam de Raptor Lake.
  i14: 'Raptor Lake',
  core1: 'Raptor Lake',
  ultra2: 'Arrow Lake',
};

const num = (s: string | undefined) => (s === undefined ? undefined : Number(s.replace(',', '.')));

function cpu(title: string, t: string): SheetValues {
  const s = extractCpuSpecs(title);
  const fam = cpuFamily(s);
  // "3.4GHz (4.5GHz Turbo)", "Turbo até 4.6GHz"; a base só quando há as duas (um "4.5GHz" sozinho pode ser qualquer uma).
  // O maior dos dois jeitos: em "3.7ghz Turbo 4.4ghz" o "3.7ghz Turbo" é a base seguida da palavra turbo.
  const turbos = [
    ...[...t.matchAll(/(\d[.,]\d{1,2})\s*ghz\s*(?:max\.?\s*)?(?:turbo|boost)/g)].map((m) => num(m[1])!),
    ...[...t.matchAll(/(?:turbo|boost)\s*(?:max\.?\s*)?(?:de\s*|ate\s*|up to\s*)?(\d[.,]\d{1,2})\s*ghz/g)].map((m) => num(m[1])!),
  ];
  const boost = turbos.length ? Math.max(...turbos) : undefined;
  const all = [...t.matchAll(/(\d[.,]\d{1,2})\s*ghz/g)].map((m) => num(m[1])!);
  const base = boost !== undefined && all.length >= 2 ? all.find((n) => n < boost) : undefined;
  // "Cache 30MB": na Intel é o Smart Cache (L3); na AMD é L2 + L3 somados, então fica de fora.
  const cache = s.cpuBrand === 'intel' ? num(t.match(/\bcache\s*(?:de\s*)?(\d{1,3})\s*mb\b/)?.[1]) : undefined;
  const igpuName =t.match(/radeon\s*(?:vega\s*\d+\s*)?graphics|(?:intel\s*)?uhd\s*graphics\s*\d*/)?.[0];
  return {
    ...(s.socket && { socket: s.socket }),
    ...(fam && { architecture: ARCH_OF[fam] }),
    ...(s.cores && { cores: s.cores }),
    ...(s.threads && { threads: s.threads }),
    ...(base && { baseGhz: base }),
    ...(boost && { boostGhz: boost }),
    ...(cache && cache >= 2 && cache <= 128 && { l3Mb: cache }),
    ...(s.igpu === false ? { igpu: 'Não' } : igpuName ? { igpu: igpuName.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUhd\b/, 'UHD').trim() } : s.igpu ? { igpu: 'Sim' } : {}),
  };
}

function motherboard(title: string, t: string): SheetValues {
  const s = extractMotherboardSpecs(title);
  const wifi = t.match(/wi-?fi\s*(7|6e|6|5)\b/)?.[1];
  return {
    ...(s.chipset && { chipset: s.chipset }),
    ...(s.socket && { socket: s.socket }),
    ...(s.formFactor && { formFactor: FORM_NAME[s.formFactor] }),
    ...(s.memory && { ramType: s.memory.toUpperCase() }),
    ...(s.memorySlots && { ramSlots: s.memorySlots }),
    ...(wifi && { wifi: `Wi-Fi ${wifi.toUpperCase()}` }),
  };
}

function gpu(title: string, t: string): SheetValues {
  const s = extractGpuSpecs(title);
  const bus = Number(t.match(/\b(64|96|128|160|192|256|320|384|512)\s*-?\s*bits?\b/)?.[1]);
  return {
    ...(s.gpuModel && { chip: s.gpuModel }),
    ...(s.vram && { vramGb: s.vram }),
    ...(s.vramType && { memType: s.vramType }),
    ...(bus && { busBits: bus }),
    // Consumo de referência do chip (a placa de cada marca varia pouco em volta dele).
    ...(s.gpuModel && GPU_POWER[s.gpuModel] && { tdpW: GPU_POWER[s.gpuModel] }),
  };
}

function ram(title: string, t: string): SheetValues {
  const s = extractRamSpecs(title);
  const type = s.memory?.toUpperCase() ?? (/\bddr3l?\b/.test(t) ? 'DDR3' : undefined);
  // "CL40", "CL 16" e "C40".
  const cl = s.ramLatency ?? num(t.match(/\bc(\d{2})\b/)?.[1]);
  return {
    ...(s.ramCapacity && { capacityGb: s.ramCapacity }),
    ...(s.ramModules && { modules: s.ramModules }),
    ...(type && { type }),
    ...(s.ramSpeed && { mhz: s.ramSpeed }),
    ...(cl && cl >= 4 && cl <= 60 && { cl }),
  };
}

function ssd(title: string, t: string): SheetValues {
  const s = extractSsdSpecs(title);
  const size = t.match(/\b22(30|42|60|80|110)\b/)?.[1];
  const form = s.ssdForm === 'm2' ? `M.2${size ? ` 22${size}` : ''}` : s.ssdForm === '2.5' ? '2,5"' : undefined;
  const iface =
    s.ssdInterface === 'sata' ? 'SATA' : s.ssdInterface === 'nvme' ? (s.ssdPcie ? `NVMe PCIe ${s.ssdPcie}.0` : /pci-?e/.test(t) ? 'NVMe PCIe' : 'NVMe') : undefined;
  // "Gravação 11800MBs", "Escrita de até 5.000 MB/s".
  const w = t.match(/(?:gravacao|escrita|write)[^\d]{0,20}(\d{1,2}[.]?\d{3}|\d{3,5})\s*mb/)?.[1];
  const write = w ? Number(w.replace('.', '')) : undefined;
  return {
    ...(s.ssdCapacity && { capacityGb: s.ssdCapacity }),
    ...(form && { formFactor: form }),
    ...(iface && { interface: iface }),
    ...(s.ssdRead && { readMbs: s.ssdRead }),
    ...(write && write >= 100 && write <= 20000 && { writeMbs: write }),
  };
}

function psu(title: string, t: string): SheetValues {
  const s = extractPsuSpecs(title);
  const eff = s.efficiency && `${s.efficiencyCert === 'cybenetics' ? 'Cybenetics' : '80 Plus'} ${s.efficiency[0]!.toUpperCase()}${s.efficiency.slice(1)}`;
  const standard = /\bsfx[- ]?l\b/.test(t) ? 'SFX-L' : s.sfx ? 'SFX' : s.atx ? `ATX ${s.atx}` : /\batx\b/.test(t) ? 'ATX' : undefined;
  return {
    ...(s.watts && { watts: s.watts }),
    ...(eff && { efficiency: eff }),
    ...(s.modular && { modular: s.modular === 'full' ? 'Total' : s.modular === 'semi' ? 'Semi' : 'Não' }),
    ...(standard && { standard }),
  };
}

function pcCase(title: string, t: string): SheetValues {
  const s = extractCaseSpecs(title);
  const tower = t.match(/\b(full|mid|middle|mini|micro)[\s-]?tower\b/)?.[1];
  // Placas-mãe: só com o formato escrito no título (não pela torre). O maior formato recebe os menores.
  const named = /\b(e-?atx|atx|m-?atx|matx|micro[\s-]?atx|mini[\s-]?itx|itx)\b/.test(t) ? s.caseFormFactor : undefined;
  const formats = named ? FORM_ORDER.slice(FORM_ORDER.indexOf(named)).map((f) => FORM_NAME[f]) : [];
  return {
    ...(tower && { formFactor: `${tower === 'middle' ? 'Mid' : tower[0]!.toUpperCase() + tower.slice(1)} Tower` }),
    ...(formats.length && { mbFormats: formats.join(',') }),
    ...(s.caseFans !== undefined && { fansIncluded: s.caseFans }),
  };
}

function cooler(title: string, t: string): SheetValues {
  const s = extractCoolerSpecs(title);
  // TDP só escrito como TDP (o "360W" do código é "360 White").
  const tdp = Number(t.match(/\bt[dg]p\s*(?:de\s*)?(?:ate\s*)?(\d{2,3})\s*w/)?.[1]);
  const noise = num(t.match(/(\d{1,2}(?:[.,]\d)?)\s*db\(?a?\)?\b/)?.[1]);
  const sockets = (s.coolerSockets ?? []).map((x) => (x === 'LGA115X' ? 'LGA1151' : x));
  return {
    ...(s.coolerType && { type: s.coolerType === 'water' ? 'water' : 'ar' }),
    ...(s.radiator && { radiatorMm: s.radiator }),
    ...(tdp >= 35 && tdp <= 400 && { tdpW: tdp }),
    ...(noise && noise >= 5 && noise <= 70 && { noiseDba: noise }),
    ...(sockets.length && { sockets: [...new Set(sockets)].join(',') }),
  };
}

const READERS: Record<CategoryId, (title: string, t: string) => SheetValues> = { cpu, motherboard, gpu, ram, ssd, psu, case: pcCase, cooler };

/** Campos da ficha que o título diz (só os da lista da categoria). */
export function readTitle(category: CategoryId, title: string): SheetValues {
  const t = plain(title);
  const brand = brandFromTitle(title);
  const values: SheetValues = { ...(brand && { brand }), ...READERS[category](title, t) };
  const keys = new Set(['brand', ...SHEET_FIELDS[category].map((f) => f.key)]);
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => keys.has(k) && v !== undefined && v !== '')) as SheetValues;
}

/**
 * Valor que vale quando nem a página nem o título dizem, depois de ler a página: fonte não modular e sem
 * certificação (a modular e a certificada sempre dizem), gabinete sem ventoinhas (o que vem com
 * ventoinhas sempre diz).
 */
export const SHEET_DEFAULTS: Partial<Record<CategoryId, SheetValues>> = {
  psu: { modular: 'Não', efficiency: 'Sem certificação' },
  case: { fansIncluded: 0 },
};

/**
 * Estimativa pelo que já se sabe do produto, para o campo que nem a página, nem o título, nem a busca na
 * web trouxe: tamanho do gabinete pelas placas-mãe que cabem (ATX ou E-ATX: mid tower; E-ATX com 560 mm
 * ou mais: full tower) e, sem ATX, pela maior medida (440 mm ou mais: mid; menos: mini). Nos gabinetes
 * com o tamanho informado (nov/2026), acerta cerca de 4 em 5: os vendedores chamam de "mid" gabinetes de
 * tamanhos parecidos com os "mini". Por isso só depois da busca na web.
 */
export function estimateSheet(category: CategoryId, values: SheetValues): SheetValues {
  if (category !== 'case' || values.formFactor !== undefined) return {};
  const mb = typeof values.mbFormats === 'string' ? values.mbFormats.split(',') : [];
  const dims = typeof values.dimensions === 'string' ? values.dimensions.split(' x ').map(Number).filter(Number.isFinite) : [];
  const max = dims.length ? Math.max(...dims) : undefined;
  if (mb.includes('ATX') || mb.includes('E-ATX')) return { formFactor: mb.includes('E-ATX') && max !== undefined && max >= 560 ? 'Full Tower' : 'Mid Tower' };
  if (max !== undefined) return { formFactor: max >= 440 ? 'Mid Tower' : 'Mini Tower' };
  return mb.length ? { formFactor: 'Mini Tower' } : {};
}
