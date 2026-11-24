import { SOCKETS, type CategoryId, type Efficiency, type FormFactor, type Socket, type Specs } from '../types.ts';
import type { SheetValues } from './fields.ts';

/**
 * Specs de busca, filtro e compatibilidade a partir da ficha juntada do produto (página das lojas >
 * título > web > à mão). Os campos que a ficha cobre (SHEET_SPEC_KEYS) passam a vir só dela: o que
 * a ficha não tem fica sem valor, em vez do que o título dizia. O resto (linha e geração do
 * processador, série da placa de vídeo, cor, RGB) continua vindo do título.
 */

/** Campos de Specs que vêm da ficha, por categoria. */
export const SHEET_SPEC_KEYS: Record<CategoryId, (keyof Specs)[]> = {
  motherboard: ['socket', 'chipset', 'formFactor', 'memory', 'memorySlots', 'wifi', 'bluetooth', 'm2Slots', 'm2Pcie', 'pcieGen', 'sataPorts', 'memoryMaxGb', 'memoryMaxMhz'],
  cpu: ['socket', 'cores', 'threads', 'tdp', 'igpu'],
  gpu: ['gpuModel', 'vram', 'vramType', 'gpuLength', 'gpu16Pin', 'gpuTdp', 'gpuPsu', 'gpuPcieGen', 'gpuPcieLanes'],
  ram: ['memory', 'ramCapacity', 'ramModules', 'ramSpeed', 'ramLatency'],
  ssd: ['ssdInterface', 'ssdForm', 'ssdCapacity', 'ssdPcie', 'ssdRead'],
  psu: ['watts', 'efficiency', 'efficiencyCert', 'modular', 'atx', 'pcie5', 'sfx'],
  case: ['caseFormFactor', 'caseTower', 'caseMaxGpu', 'caseMaxCooler', 'caseFans', 'caseRadiators'],
  cooler: ['coolerType', 'radiator', 'coolerSockets', 'coolerBrands', 'coolerTdp', 'coolerHeight'],
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));
const list = (v: unknown): string[] => (str(v) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const lower = (v: unknown) => (str(v) ?? '').toLowerCase();

const socketOf = (v: unknown): Socket | undefined => SOCKETS.find((s) => s === str(v)?.toUpperCase().replace(/\s+/g, ''));

/** "Micro-ATX" → matx; "E-ATX" → eatx. */
function formFactorOf(v: unknown): FormFactor | undefined {
  const s = lower(v).replace(/[\s_]/g, '-');
  if (/e-?atx/.test(s)) return 'eatx';
  if (/micro|m-?atx/.test(s)) return 'matx';
  if (/itx/.test(s)) return 'mini-itx';
  if (/atx/.test(s)) return 'atx';
  return undefined;
}

const FORM_RANK: FormFactor[] = ['mini-itx', 'matx', 'atx', 'eatx'];

/** "4.0", "PCIe 5.0 x16" → 4, 5. */
const pcieGenOf = (v: unknown): 3 | 4 | 5 | undefined => {
  const g = Number(str(v)?.match(/([345])(?:\.0)?/)?.[1]);
  return g === 3 || g === 4 || g === 5 ? g : undefined;
};

const memoryOf = (v: unknown) => (/ddr5/i.test(str(v) ?? '') ? 'ddr5' : /ddr4/i.test(str(v) ?? '') ? 'ddr4' : undefined);

/** Soquetes do cooler como a compatibilidade conhece: os 115x viram um só (LGA115X). */
function coolerSocketsOf(v: unknown): string[] {
  const out = new Set<string>();
  for (const s of list(v)) out.add(/^LGA115[0156]$/.test(s) ? 'LGA115X' : s);
  return [...out];
}

const clean = (o: Specs): Specs => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as Specs;

export function sheetSpecs(category: CategoryId, v: SheetValues): Specs {
  switch (category) {
    case 'motherboard':
      return clean({
        socket: socketOf(v.socket),
        chipset: str(v.chipset),
        formFactor: formFactorOf(v.formFactor),
        memory: memoryOf(v.ramType),
        memorySlots: num(v.ramSlots),
        m2Slots: num(v.m2Slots),
        m2Pcie: pcieGenOf(v.m2Pcie),
        pcieGen: pcieGenOf(v.pcieX16),
        sataPorts: num(v.sataPorts),
        memoryMaxGb: num(v.ramMaxGb),
        memoryMaxMhz: num(v.ramMaxMhz),
        ...(str(v.wifi) && { wifi: true }),
        // Wi-Fi de placa-mãe vem em combo com Bluetooth.
        ...((str(v.bluetooth) || str(v.wifi)) && { bluetooth: true }),
      });
    case 'cpu': {
      const igpu = str(v.igpu);
      return clean({
        socket: socketOf(v.socket),
        cores: num(v.cores),
        threads: num(v.threads),
        tdp: num(v.tdpW),
        igpu: igpu === undefined ? undefined : !/^n[aã]o$/i.test(igpu),
      });
    }
    case 'gpu':
      return clean({
        gpuModel: str(v.chip),
        vram: num(v.vramGb),
        vramType: str(v.memType),
        gpuLength: num(v.lengthMm),
        gpu16Pin: v.power16Pin === undefined ? undefined : v.power16Pin === true || v.power16Pin === 1 || v.power16Pin === '1',
        gpuTdp: num(v.tdpW),
        gpuPsu: num(v.psuW),
        gpuPcieGen: pcieGenOf(v.pcie),
        gpuPcieLanes: num(str(v.pcie)?.match(/x(\d{1,2})\b/i)?.[1]),
      });
    case 'ram':
      return clean({ memory: memoryOf(v.type), ramCapacity: num(v.capacityGb), ramModules: num(v.modules), ramSpeed: num(v.mhz), ramLatency: num(v.cl) });
    case 'ssd': {
      const itf = lower(v.interface);
      const gen = Number(itf.match(/pcie\s*(\d)/)?.[1]);
      const form = lower(v.formFactor);
      return clean({
        ssdInterface: /nvme|pcie/.test(itf) ? 'nvme' : /sata/.test(itf) ? 'sata' : undefined,
        ssdForm: /m\.?2/.test(form) ? 'm2' : /2[,.]5/.test(form) ? '2.5' : undefined,
        ssdCapacity: num(v.capacityGb),
        ssdPcie: gen === 3 || gen === 4 || gen === 5 ? gen : undefined,
        ssdRead: num(v.readMbs),
      });
    }
    case 'psu': {
      const eff = lower(v.efficiency);
      const level = (['titanium', 'platinum', 'gold', 'silver', 'bronze', 'white'] as Efficiency[]).find((l) => eff.includes(l));
      const std = lower(v.standard);
      const atx = std.match(/atx\s*(3\.[01])/)?.[1] as '3.0' | '3.1' | undefined;
      const modular = lower(v.modular);
      return clean({
        watts: num(v.watts),
        efficiency: level,
        efficiencyCert: level ? (eff.includes('cybenetics') ? 'cybenetics' : '80plus') : undefined,
        modular: /total|full|sim/.test(modular) ? 'full' : /semi/.test(modular) ? 'semi' : /n[aã]o/.test(modular) ? 'none' : undefined,
        atx,
        pcie5: (num(v.pcie16) ?? 0) > 0 || !!atx || undefined,
        sfx: /sfx/.test(std) || undefined,
      });
    }
    case 'case': {
      const boards = list(v.mbFormats).map(formFactorOf).filter((f): f is FormFactor => !!f);
      const tower = lower(v.formFactor);
      return clean({
        caseFormFactor: boards.length ? boards.sort((a, b) => FORM_RANK.indexOf(b) - FORM_RANK.indexOf(a))[0] : undefined,
        caseTower: /full/.test(tower) ? 'full' : /mid/.test(tower) ? 'mid' : /mini|micro|cub/.test(tower) ? 'mini' : undefined,
        caseMaxGpu: num(v.maxGpuMm),
        caseMaxCooler: num(v.maxCoolerMm),
        caseFans: num(v.fansIncluded),
        caseRadiators: list(v.radiators).map(Number).filter((n) => n > 0),
      });
    }
    case 'cooler': {
      const sockets = coolerSocketsOf(v.sockets);
      const brands = [...(sockets.some((s) => s.startsWith('LGA')) ? ['intel' as const] : []), ...(sockets.some((s) => s.startsWith('AM')) ? ['amd' as const] : [])];
      const type = lower(v.type);
      return clean({
        coolerType: type === 'water' ? 'water' : type === 'ar' || type === 'air' ? 'air' : undefined,
        radiator: num(v.radiatorMm),
        coolerSockets: sockets,
        coolerBrands: brands,
        coolerTdp: num(v.tdpW),
        coolerHeight: num(v.heightMm),
      });
    }
  }
}

/**
 * Specs de uma oferta com a ficha: os campos que a ficha cobre vêm só dela (o que ela não tem fica
 * sem valor); os outros continuam os do título.
 */
export function withSheetSpecs(category: CategoryId, title: Specs, sheet: SheetValues): Specs {
  const out: Specs = { ...title };
  for (const k of SHEET_SPEC_KEYS[category]) delete out[k];
  const fromSheet = sheetSpecs(category, sheet);
  // Placa B650E/X670E: a ficha diz o chip ("Chipset B650"); o título, a versão. Vale a do título.
  if (category === 'motherboard' && title.chipset && fromSheet.chipset && title.chipset === `${fromSheet.chipset}E`) fromSheet.chipset = title.chipset;
  return { ...out, ...fromSheet };
}
