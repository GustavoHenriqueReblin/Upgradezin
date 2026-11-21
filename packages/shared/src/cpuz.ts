import { extractCpuSpecs } from './cpu.ts';
import { extractGpuSpecs } from './gpu.ts';
import { extractChipset, extractMotherboardSpecs } from './motherboard.ts';
import { CHIPSETS, RAM_SPEEDS, SOCKETS, type MemoryType, type Socket, type Specs } from './types.ts';

/**
 * Leitura do relatório do CPU-Z ("Save Report (.TXT)"), no navegador: as peças que a
 * pessoa tem hoje, no mesmo formato de specs das ofertas, para preencher a montagem e
 * sugerir upgrades. Só guarda campos de peça: números de série, UUID, caminhos de
 * dispositivo e nome da máquina ficam de fora.
 *
 * Formato do relatório: seções com o título sublinhado por traços; em cada linha,
 * `Chave<TABs>Valor`, com subitens indentados por TAB. Ver fixtures/cpuz.
 */

export interface PcPart {
  /** Nome para mostrar, no estilo dos títulos das lojas ("AMD Ryzen 7 5800X3D"). */
  title: string;
  brand?: string;
  specs: Specs;
}

export interface PcRam extends PcPart {
  modules: { sizeGb: number; maker?: string; part?: string }[];
  /** Frequência de fábrica do pente (MT/s): o maior perfil XMP/EXPO, ou o JEDEC. */
  ratedSpeed?: number;
  /** Frequência em que a memória está rodando agora (MT/s). */
  runningSpeed?: number;
  /** Perfil de overclock gravado no pente. */
  profile?: 'xmp' | 'expo';
}

export interface PcGpu extends PcPart {
  /** Linhas PCIe em uso agora (x8, x16). */
  pcieWidth?: number;
}

export interface PcDrive {
  name: string;
  kind: 'nvme' | 'ssd' | 'hdd' | 'unknown';
  capacityGb: number;
  /** Tem o volume C: (sistema). */
  system: boolean;
  /** Espaço livre do volume principal, em %. */
  freePercent?: number;
}

export interface PcMonitor {
  name?: string;
  width?: number;
  height?: number;
  /** Maior taxa de atualização aceita (Hz). */
  maxHz?: number;
  inches?: number;
}

export interface PcProfile {
  source: 'cpu-z';
  version?: string;
  cpu?: PcPart;
  motherboard?: PcPart;
  ram?: PcRam;
  /** Placa de vídeo dedicada (vídeo integrado fica em `cpu.specs.igpu`). */
  gpu?: PcGpu;
  /** Fonte: o CPU-Z não mostra; a pessoa informa na importação (potência, marca, PFC, eficiência). */
  psu?: PcPart;
  drives: PcDrive[];
  monitors: PcMonitor[];
  /** Erros de hardware corrigidos registrados pelo Windows (WHEA). */
  wheaErrors?: number;
}

// ---------- leitura genérica do formato ----------

/**
 * Proteção contra arquivo forjado: o texto vem da pessoa (ou de quem mandou o arquivo para ela).
 * Todo valor sai sem caracteres de controle (nem os invisíveis que invertem o texto) e com
 * tamanho máximo; listas têm teto. O arquivo é só lido (nada é executado) e o React escapa o
 * que aparece na tela.
 */
const MAX_VALUE = 200;
const MAX_TITLE = 160;
const MAX_LINES = 50_000;
export const PC_LIMITS = { drives: 16, monitors: 8, modules: 16 } as const;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
const safe = (s: string, max = MAX_VALUE) => s.replace(UNSAFE, '').slice(0, max);

interface Entry {
  depth: number;
  key: string;
  value: string;
}

type Sections = Map<string, Entry[][]>;

function readSections(text: string): Sections {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/, MAX_LINES);
  const out: Sections = new Map();
  let current: Entry[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^-{10,}\s*$/.test(lines[i + 1] ?? '') && line.trim() && !line.startsWith('\t')) {
      current = [];
      const title = safe(line, 80).trim();
      out.set(title, [...(out.get(title) ?? []), current]);
      i++;
      continue;
    }
    if (!current || !line.trim()) continue;
    const depth = line.length - line.replace(/^\t+/, '').length;
    const [key = '', ...rest] = line.slice(depth, depth + 2000).split(/\t+/);
    current.push({ depth: Math.min(depth, 8), key: safe(key, 80).trim(), value: safe(rest.join(' ')).trim() });
  }
  return out;
}

/** Todas as entradas de uma seção (ela pode aparecer mais de uma vez). */
const section = (s: Sections, title: string): Entry[] => (s.get(title) ?? []).flat();

/** Divide a seção em blocos que começam numa entrada de nível 0 com a chave indicada. */
function blocks(entries: Entry[], start: RegExp): Entry[][] {
  const out: Entry[][] = [];
  let cur: Entry[] | null = null;
  for (const e of entries) {
    if (e.depth === 0 && start.test(e.key)) out.push((cur = [e]));
    else if (cur && (e.depth > 0 || !start.test(e.key))) cur.push(e);
  }
  return out;
}

const norm = (k: string) => k.toLowerCase().replace(/\s+/g, ' ').trim();
const get = (entries: Entry[], key: string): string | undefined => {
  const k = norm(key);
  return entries.find((e) => norm(e.key) === k)?.value || undefined;
};
const all = (entries: Entry[], key: string): string[] => entries.filter((e) => norm(e.key) === norm(key)).map((e) => e.value);
const num = (s: string | undefined): number | undefined => {
  const m = s?.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

/** Valores que o fabricante não preencheu. */
const JUNK = /^(default string|to be filled.*|system (manufacturer|product name|version)|not applicable|n\/a|none|o\.?e\.?m\.?|base board.*|\s*)$/i;
const real = (s: string | undefined) => (s && !JUNK.test(s.trim()) ? s.trim() : undefined);

/** Tira (R), (TM), ® e ™ e espaços repetidos: "Intel(R) Arc(TM) B580" → "Intel Arc B580". */
const clean = (s: string) => s.replace(/\((R|TM|C)\)|[®™]/gi, '').replace(/\s+/g, ' ').trim();

const VENDORS: [RegExp, string][] = [
  [/asustek|^asus/i, 'ASUS'],
  [/micro-star|^msi/i, 'MSI'],
  [/gigabyte/i, 'Gigabyte'],
  [/asrock/i, 'ASRock'],
  [/biostar/i, 'Biostar'],
  [/evga/i, 'EVGA'],
  [/nzxt/i, 'NZXT'],
  [/sapphire/i, 'Sapphire'],
  [/powercolor|tul corp/i, 'PowerColor'],
  [/xfx/i, 'XFX'],
  [/zotac/i, 'Zotac'],
  [/galax|galaxy microsystems/i, 'Galax'],
  [/palit/i, 'Palit'],
  [/gainward/i, 'Gainward'],
  [/pny/i, 'PNY'],
  [/inno3d/i, 'Inno3D'],
  [/kingston/i, 'Kingston'],
  [/corsair/i, 'Corsair'],
  [/g\.?skill/i, 'G.Skill'],
  [/crucial|micron/i, 'Crucial'],
  [/adata|xpg/i, 'XPG'],
  [/team ?group/i, 'TeamGroup'],
  [/patriot/i, 'Patriot'],
  [/hyperx/i, 'HyperX'],
  [/samsung/i, 'Samsung'],
  [/sk ?hynix/i, 'SK Hynix'],
];
const vendor = (raw: string | undefined): string | undefined => {
  const v = real(raw?.replace(/\s*\(.*$/, ''));
  if (!v) return undefined;
  return VENDORS.find(([re]) => re.test(v))?.[1] ?? clean(v).replace(/,?\s*(inc|ltd|co|corp|corporation|technology|computer)\.?$/gi, '').trim();
};

// ---------- peças ----------

function socketOf(pkg: string | undefined): Socket | undefined {
  if (!pkg) return undefined;
  const am = pkg.match(/\bAM([45])\b/i);
  if (am) return `AM${am[1]}` as Socket;
  const lga = pkg.match(/\b(1851|1700|1200|1151)\b/);
  const s = lga ? (`LGA${lga[1]}` as Socket) : undefined;
  return s && (SOCKETS as readonly string[]).includes(s) ? s : undefined;
}

function readCpu(s: Sections): PcPart | undefined {
  const cpu = blocks(section(s, 'Processors Information'), /^Socket \d+/)[0];
  if (!cpu) return undefined;
  const name = clean(get(cpu, 'Name') ?? '');
  const spec = clean(get(cpu, 'Specification') ?? '');
  if (!name && !spec) return undefined;
  let specs: Specs = extractCpuSpecs(name);
  if (!specs.cpuModel && spec) specs = extractCpuSpecs(spec);
  const socket = socketOf(get(cpu, 'Package'));
  const cores = num(get(cpu, 'Number of cores'));
  const threads = num(get(cpu, 'Number of threads'));
  const tdp = num(get(cpu, 'TDP Limit'));
  specs = { ...specs, ...(socket && { socket }), ...(cores && { cores }), ...(threads && { threads }), ...(tdp && { tdp: Math.round(tdp) }) };
  const brand = specs.cpuBrand === 'amd' ? 'AMD' : specs.cpuBrand === 'intel' ? 'Intel' : undefined;
  return { title: name || spec, brand, specs };
}

const KNOWN_CHIPSETS = new Set(Object.values(CHIPSETS).flat());

function readMotherboard(s: Sections, cpu: PcPart | undefined): PcPart | undefined {
  const dmi = section(s, 'DMI');
  const board = blocks(dmi, /^DMI Baseboard$/)[0] ?? [];
  const chipsetSec = section(s, 'Chipset');
  const model = real(get(board, 'model'))?.replace(/\s*\((MS|MS-)?[\w-]*\d[\w-]*\)\s*$/, '');
  const brand = vendor(get(board, 'vendor'));
  const south = extractChipset(get(chipsetSec, 'Southbridge') ?? '');
  const fromModel = model ? extractMotherboardSpecs(model) : {};
  const chipset = south && KNOWN_CHIPSETS.has(south) ? south : fromModel.chipset;
  const memType = get(chipsetSec, 'Memory Type')?.toLowerCase();
  const memory = memType === 'ddr4' || memType === 'ddr5' ? (memType as MemoryType) : fromModel.memory;
  const array = blocks(dmi, /^DMI Physical Memory Array$/)[0] ?? [];
  const slots = num(get(array, 'max# of devices'));
  if (!model && !chipset) return undefined;
  const socket = cpu?.specs.socket ?? fromModel.socket;
  const specs: Specs = {
    ...fromModel,
    ...(socket && { socket }),
    ...(chipset && { chipset }),
    ...(memory && { memory }),
    ...(slots && slots <= 8 && { memorySlots: slots }),
  };
  const title = [brand, model ?? `Placa-Mãe ${chipset}`].filter(Boolean).join(' ');
  return { title, brand, specs };
}

const KNOWN_SPEEDS = [1600, 1866, 2133, 2400, 2666, 2933, 3000, 3200, 3600, ...RAM_SPEEDS.ddr4, ...RAM_SPEEDS.ddr5];
/** "1197.5 MHz" do relógio → 2400 MT/s (encaixa na frequência vendida mais próxima). */
function snapSpeed(mts: number): number {
  const near = KNOWN_SPEEDS.reduce((a, b) => (Math.abs(b - mts) < Math.abs(a - mts) ? b : a));
  return Math.abs(near - mts) / mts <= 0.015 ? near : Math.round(mts);
}
const ddrSpeed = (s: string | undefined) => num(s?.match(/DDR\d-(\d+)/i)?.[1]);

function readRam(s: Sections): PcRam | undefined {
  const chipsetSec = section(s, 'Chipset');
  const spd = blocks(section(s, 'Memory SPD'), /^DIMM #$/).filter((b) => get(b, 'Memory type'));
  // O CPU-Z repete cada pente no fim, só com os registradores; os blocos com dados não se repetem por endereço.
  const seen = new Set<string>();
  const dimms = spd.filter((b) => {
    const id = `${get(b, 'SMBus address') ?? ''}|${get(b, 'DIMM #') ?? ''}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let modules: PcRam['modules'] = [];
  let rated: number | undefined;
  let latency: number | undefined;
  let profile: PcRam['profile'];
  let type = get(chipsetSec, 'Memory Type')?.toLowerCase();

  if (dimms.length) {
    for (const d of dimms) {
      const sizeGb = Math.round((num(get(d, 'Size')) ?? 0) / 1024);
      if (!sizeGb) continue;
      modules.push({ sizeGb, maker: vendor(get(d, 'Module Manufacturer(ID)')), part: get(d, 'Part number')?.trim() || undefined });
      type ??= get(d, 'Memory type')?.toLowerCase();
      let best = ddrSpeed(get(d, 'Max bandwidth'));
      // Perfis XMP/EXPO: entrada "XMP profile" de nível 0, seguida dos campos do perfil. Vale o mais rápido.
      let top: { kind: PcRam['profile']; speed: number; cl?: number } | undefined;
      for (let i = 0; i < d.length; i++) {
        const m = d[i]!.depth === 0 && d[i]!.key.match(/^(XMP|EXPO) profile$/i);
        if (!m) continue;
        const fields: Entry[] = [];
        for (let j = i + 1; j < d.length && d[j]!.depth > 0; j++) fields.push(d[j]!);
        const speed = ddrSpeed(get(fields, 'Specification')) ?? num(d[i]!.value.match(/-(\d+)/)?.[1]);
        if (speed && (!top || speed > top.speed)) top = { kind: m[1]!.toLowerCase() as PcRam['profile'], speed, cl: num(get(fields, 'Max CL')) };
      }
      if (top) {
        profile = top.kind;
        latency = top.cl;
        if (!best || top.speed > best) best = top.speed;
      }
      if (best && (!rated || best > rated)) rated = best;
    }
  } else {
    // Sem leitura do SPD: os pentes pelo DMI (tamanho e part number).
    for (const d of blocks(section(s, 'DMI'), /^DMI Memory Device$/)) {
      const size = get(d, 'size');
      const sizeGb = size && /GB/i.test(size) ? num(size) : size && /MB/i.test(size) ? Math.round((num(size) ?? 0) / 1024) : undefined;
      if (!sizeGb) continue;
      modules.push({ sizeGb, maker: vendor(get(d, 'manufacturer')), part: real(get(d, 'part number')) });
      type ??= get(d, 'type')?.toLowerCase();
    }
  }
  if (!modules.length) return undefined;

  const freq = num(get(chipsetSec, 'Memory Frequency'));
  const runningSpeed = freq ? snapSpeed(freq * 2) : undefined;
  const memory = type === 'ddr4' || type === 'ddr5' ? (type as MemoryType) : undefined;
  const total = modules.reduce((a, m) => a + m.sizeGb, 0);
  const sizes = [...new Set(modules.map((m) => m.sizeGb))];
  const makers = [...new Set(modules.map((m) => m.maker).filter(Boolean))];
  const brand = makers.length === 1 ? makers[0] : undefined;
  const layout = sizes.length === 1 ? `${modules.length}x ${sizes[0]} GB` : modules.map((m) => `${m.sizeGb} GB`).join(' + ');
  const speed = rated ?? runningSpeed;
  const title = [brand, `${total} GB (${layout})`, memory?.toUpperCase(), speed && `${speed} MHz`].filter(Boolean).join(' ');
  const specs: Specs = {
    ...(memory && { memory }),
    ramCapacity: total,
    ramModules: modules.length,
    ...(speed && { ramSpeed: speed }),
    ...(latency && { ramLatency: Math.round(latency) }),
  };
  return { title, brand, specs, modules, ratedSpeed: rated, runningSpeed, profile };
}

function readGpu(s: Sections): PcGpu | undefined {
  const adapters = blocks(section(s, 'Display Adapters'), /^Display adapter \d+/i);
  for (const a of adapters) {
    const name = clean(get(a, 'Name') ?? '');
    const specs: Specs = extractGpuSpecs(name);
    if (!specs.gpuModel) continue; // vídeo integrado ("AMD Radeon Graphics", "Intel UHD Graphics")
    const size = get(a, 'Memory size');
    const vram = size ? (/GB/i.test(size) ? num(size) : Math.round((num(size) ?? 0) / 1024)) : undefined;
    const vramType = get(a, 'Memory type')?.toUpperCase();
    const brand = vendor(get(a, 'Board Manufacturer'));
    const width = num(get(a, 'Current Link Width'));
    return {
      title: [brand, name, vram && `${vram} GB`].filter(Boolean).join(' '),
      brand,
      specs: { ...specs, ...(vram && { vram }), ...(vramType && /^GDDR/.test(vramType) && { vramType }) },
      ...(width && { pcieWidth: width }),
    };
  }
  return undefined;
}

function readDrives(s: Sections): PcDrive[] {
  const out: PcDrive[] = [];
  for (const d of blocks(section(s, 'Storage'), /^Drive$/)) {
    const type = get(d, 'Type') ?? '';
    const bus = get(d, 'Bus Type') ?? '';
    if (/removable/i.test(type) || /usb/i.test(bus)) continue;
    const cap = get(d, 'Capacity');
    const capacityGb = cap ? Math.round((num(cap) ?? 0) * (/TB/i.test(cap) ? 1024 : 1)) : 0;
    const kind: PcDrive['kind'] = /nvme/i.test(bus) ? 'nvme' : /ssd/i.test(type) ? 'ssd' : get(d, 'Rotation speed') ? 'hdd' : 'unknown';
    const volumes = all(d, 'Volume').map((v) => ({ letter: v.match(/^([a-z]):/i)?.[1]?.toLowerCase(), free: num(v.match(/([\d.]+) percent/)?.[1]) }));
    const sys = volumes.find((v) => v.letter === 'c');
    const main = sys ?? volumes[0];
    out.push({
      name: clean(get(d, 'Name') ?? 'Disco'),
      kind,
      capacityGb,
      system: !!sys,
      ...(main?.free !== undefined && { freePercent: main.free }),
    });
  }
  return out;
}

function readMonitors(s: Sections): PcMonitor[] {
  return blocks(section(s, 'Display Adapters'), /^Monitor \d+$/).map((m) => {
    const res = get(m, 'Max Resolution')?.match(/(\d+)\s*x\s*(\d+)(?:\s*@\s*(\d+))?/);
    const range = get(m, 'Vertical Freq. Range')?.match(/(\d+)\s*-\s*(\d+)/);
    const maxHz = Math.max(Number(range?.[2] ?? 0), Number(res?.[3] ?? 0)) || undefined;
    const name = real(get(m, 'Model')?.replace(/\(\s*\)/g, ''));
    return {
      ...(name && { name }),
      ...(res && { width: Number(res[1]), height: Number(res[2]) }),
      ...(maxHz && { maxHz }),
      ...(num(get(m, 'Size')) && { inches: num(get(m, 'Size')) }),
    };
  });
}

const titled = <T extends PcPart>(p: T | undefined): T | undefined =>
  p && { ...p, title: p.title.slice(0, MAX_TITLE), ...(p.brand && { brand: p.brand.slice(0, 40) }) };

/** O texto é um relatório do CPU-Z? */
export const isCpuzReport = (text: string) => /CPU-Z TXT Report|CPU-Z version/i.test(text.slice(0, 4000));

/** Lê o relatório. `null` se o texto não for um relatório do CPU-Z. */
export function parseCpuzReport(text: string): PcProfile | null {
  if (!isCpuzReport(text)) return null;
  const s = readSections(text);
  const cpu = readCpu(s);
  const whea = num(get(section(s, 'Software'), 'WHEA errors'));
  const ram = titled(readRam(s));
  return {
    source: 'cpu-z',
    version: get(section(s, 'Binaries'), 'CPU-Z version')?.slice(0, 40),
    cpu: titled(cpu),
    motherboard: titled(readMotherboard(s, cpu)),
    ram: ram && { ...ram, modules: ram.modules.slice(0, PC_LIMITS.modules) },
    gpu: titled(readGpu(s)),
    drives: readDrives(s).slice(0, PC_LIMITS.drives),
    monitors: readMonitors(s).slice(0, PC_LIMITS.monitors),
    ...(whea !== undefined && { wheaErrors: Math.min(whea, 1_000_000) }),
  };
}
