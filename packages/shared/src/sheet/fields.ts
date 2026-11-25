import type { CategoryId } from '../types.ts';

/**
 * Ficha técnica: os campos fixos de cada categoria (docs/ARCHITECTURE.md §8.3). Cada campo vira uma
 * coluna da tabela da categoria no banco (sheet_<categoria>); mudar esta lista muda as colunas (o
 * servidor cria ou apaga a coluna ao subir) e relê as fichas guardadas.
 *
 * Só o indispensável para quem monta ou faz upgrade. "Principal": sem ele a ficha está incompleta.
 */
export type SheetFieldType = 'int' | 'real' | 'text' | 'list' | 'bool';

export interface SheetField {
  /** Nome no código (camelCase); a coluna é o mesmo em snake_case. */
  key: string;
  /** Nome no admin. */
  label: string;
  type: SheetFieldType;
  unit?: string;
  /** Principal: a ficha só está completa com ele. `[campo, valor]`: só quando o outro campo tem esse valor. */
  main?: true | [string, string];
  /**
   * "Não tem": o valor que diz que o produto não tem o recurso ("Não", 0 ou false). Campo vazio é "não sei";
   * com este valor, a ficha sabe que não tem (e não vai à web perguntar de novo).
   */
  none?: SheetValue;
  /** Só faz sentido quando outro campo tem esse valor (altura e heatpipes: só no air cooler). */
  only?: [string, string];
}

export type SheetValue = number | string | boolean;
export type SheetValues = Record<string, SheetValue>;

/** Campos de toda ficha, antes dos da categoria. */
export const COMMON_FIELDS: SheetField[] = [
  { key: 'brand', label: 'Marca', type: 'text' },
  { key: 'model', label: 'Modelo', type: 'text' },
];

const f = (key: string, label: string, type: SheetFieldType, unit?: string, main?: SheetField['main'], more: Pick<SheetField, 'none' | 'only'> = {}): SheetField => ({
  key,
  label,
  type,
  ...(unit && { unit }),
  ...(main && { main }),
  ...more,
});
/** Campo opcional que o produto pode não ter. */
const NO_TEXT = { none: 'Não' } as const;
const NO_COUNT = { none: 0 } as const;
const NO_BOOL = { none: false } as const;
const AIR = { only: ['type', 'ar'] as [string, string] };
const M = true as const;

export const SHEET_FIELDS: Record<CategoryId, SheetField[]> = {
  motherboard: [
    f('chipset', 'Chipset', 'text', undefined, M),
    f('socket', 'Soquete', 'text', undefined, M),
    f('formFactor', 'Formato', 'text', undefined, M),
    f('ramType', 'Memória', 'text', undefined, M),
    f('ramSlots', 'Slots de memória', 'int', undefined, M),
    f('ramMaxGb', 'Memória máxima', 'int', 'GB', M),
    f('ramMaxMhz', 'Memória até', 'int', 'MHz'),
    f('pcieX16', 'PCIe x16', 'text', undefined, M),
    f('m2Slots', 'Slots M.2', 'int', undefined, M),
    f('m2Pcie', 'M.2 até', 'text'),
    f('sataPorts', 'Portas SATA', 'int', undefined, M),
    f('m2SharesSata', 'M.2 compartilha portas SATA', 'bool'),
    f('m2SharesGpu', 'M.2 compartilha linhas com a placa de vídeo', 'bool'),
    f('lan', 'Rede', 'text', undefined, M),
    f('wifi', 'Wi-Fi', 'text', undefined, undefined, NO_TEXT),
    f('bluetooth', 'Bluetooth', 'text', undefined, undefined, NO_TEXT),
    f('vrmPhases', 'Fases do VRM', 'text'),
    f('vrmHeatsink', 'Dissipador no VRM', 'bool', undefined, undefined, NO_BOOL),
    f('biosFlashback', 'BIOS Flashback', 'bool', undefined, undefined, NO_BOOL),
  ],
  cpu: [
    f('socket', 'Soquete', 'text', undefined, M),
    f('architecture', 'Arquitetura', 'text', undefined, M),
    f('cores', 'Núcleos', 'int', undefined, M),
    f('threads', 'Threads', 'int', undefined, M),
    f('baseGhz', 'Clock base', 'real', 'GHz', M),
    f('boostGhz', 'Clock boost', 'real', 'GHz', M),
    f('l2Mb', 'Cache L2', 'real', 'MB'),
    f('l3Mb', 'Cache L3', 'real', 'MB', M),
    f('tdpW', 'TDP', 'int', 'W', M),
    f('igpu', 'Vídeo integrado', 'text', undefined, M),
    f('ramType', 'Memória', 'text'),
  ],
  gpu: [
    f('chip', 'Chip', 'text', undefined, M),
    f('silicon', 'Código do chip', 'text'),
    f('vramGb', 'VRAM', 'int', 'GB', M),
    f('memType', 'Tipo de memória', 'text', undefined, M),
    f('busBits', 'Barramento', 'int', 'bits', M),
    f('baseMhz', 'Clock base', 'int', 'MHz'),
    f('boostMhz', 'Clock boost', 'int', 'MHz', M),
    f('tdpW', 'Consumo', 'int', 'W', M),
    f('psuW', 'Fonte recomendada', 'int', 'W'),
    f('lengthMm', 'Comprimento', 'int', 'mm', M),
    f('pcie', 'PCIe', 'text'),
    f('power16Pin', 'Conector 16 pinos', 'bool', undefined, undefined, NO_BOOL),
    f('fans', 'Ventoinhas', 'int'),
    f('architecture', 'Arquitetura', 'text'),
    f('shaders', 'Unidades de processamento (CUDA / stream)', 'int'),
    f('bandwidthGbs', 'Largura de banda', 'int', 'GB/s'),
    f('powerConnectors', 'Conectores de alimentação', 'text', undefined, undefined, NO_TEXT),
  ],
  ram: [
    f('capacityGb', 'Capacidade', 'int', 'GB', M),
    f('modules', 'Módulos', 'int', undefined, M),
    f('type', 'Tipo', 'text', undefined, M),
    f('mhz', 'Frequência', 'int', 'MHz', M),
    f('cl', 'Latência', 'int', 'CL', M),
    f('xmp', 'XMP', 'bool', undefined, undefined, NO_BOOL),
    f('expo', 'EXPO', 'bool', undefined, undefined, NO_BOOL),
  ],
  ssd: [
    f('capacityGb', 'Capacidade', 'int', 'GB', M),
    f('formFactor', 'Formato', 'text', undefined, M),
    f('interface', 'Interface', 'text', undefined, M),
    f('readMbs', 'Leitura', 'int', 'MB/s', M),
    f('writeMbs', 'Escrita', 'int', 'MB/s', M),
    f('pcieGen', 'Geração PCIe', 'text', undefined, undefined, NO_TEXT),
    f('nand', 'Tipo de NAND', 'text'),
    f('dram', 'Cache DRAM', 'bool', undefined, undefined, NO_BOOL),
    f('tbw', 'Durabilidade', 'int', 'TBW'),
  ],
  // Fonte se escolhe pela potência, pelo selo e por ser modular; padrão e conectores, quando a loja diz.
  psu: [
    f('watts', 'Potência', 'int', 'W', M),
    f('efficiency', 'Eficiência', 'text', undefined, M),
    f('modular', 'Modular', 'text', undefined, M),
    f('standard', 'Padrão', 'text'),
    f('eps', 'Conectores CPU (EPS)', 'int'),
    f('pcie8', 'Conectores PCIe 6+2', 'int'),
    f('pcie16', 'Conectores 16 pinos', 'int', undefined, undefined, NO_COUNT),
    f('sata', 'Conectores SATA', 'int'),
  ],
  // Gabinete se escolhe pelo tamanho (mid, mini tower) e pela placa-mãe que cabe; o resto, quando a loja diz.
  case: [
    f('formFactor', 'Tamanho', 'text', undefined, M),
    f('mbFormats', 'Placas-mãe', 'list', undefined, M),
    f('maxGpuMm', 'Placa de vídeo até', 'int', 'mm'),
    f('maxCoolerMm', 'Cooler até', 'int', 'mm'),
    f('dimensions', 'Dimensões', 'text', 'mm'),
    f('front', 'Frente', 'text'),
    f('fansIncluded', 'Ventoinhas inclusas', 'int', undefined, undefined, NO_COUNT),
    f('fansMax', 'Ventoinhas máx.', 'int'),
    f('radiators', 'Radiadores', 'list', 'mm'),
  ],
  cooler: [
    f('type', 'Tipo', 'text', undefined, M),
    // Altura e ruído: opcionais (quando a loja diz, ótimo; não faltando, a ficha não fica incompleta).
    f('heightMm', 'Altura', 'int', 'mm', undefined, AIR),
    f('radiatorMm', 'Radiador', 'int', 'mm', ['type', 'water']),
    // TDP suportado: opcional (a loja quase nunca informa).
    f('tdpW', 'TDP suportado', 'int', 'W'),
    f('noiseDba', 'Ruído', 'real', 'dBA'),
    f('sockets', 'Soquetes', 'list', undefined, M),
    f('fans', 'Ventoinhas', 'int'),
    f('heatpipes', 'Heatpipes', 'int', undefined, undefined, AIR),
    f('fanMm', 'Ventoinha', 'int', 'mm'),
  ],
};

/** Campos da ficha de uma categoria, com os comuns. */
export const sheetFields = (category: CategoryId): SheetField[] => [...COMMON_FIELDS, ...SHEET_FIELDS[category]];

/** Coluna do campo no banco ("ramMaxGb" -> "ram_max_gb"). */
export const fieldColumn = (key: string) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** O campo é principal para esta ficha (o principal condicional depende de outro campo). */
export function isMainFor(field: SheetField, values: SheetValues): boolean {
  if (!field.main) return false;
  if (field.main === true) return true;
  const [other, value] = field.main;
  return values[other] === value;
}

/** Campos principais que faltam na ficha. */
export function missingMain(category: CategoryId, values: SheetValues): string[] {
  return SHEET_FIELDS[category].filter((f) => isMainFor(f, values) && (values[f.key] === undefined || values[f.key] === '')).map((f) => f.key);
}

/** O campo faz sentido para esta ficha (`only`; o principal condicional também só vale na condição). */
export function appliesTo(field: SheetField, values: SheetValues): boolean {
  const cond = field.only ?? (Array.isArray(field.main) ? field.main : undefined);
  return !cond || values[cond[0]] === cond[1];
}

/**
 * Campos opcionais que faltam: vazios ("não sei"), dos que fazem sentido para o produto. O "não tem"
 * (`none`) conta como preenchido.
 */
export function missingOptional(category: CategoryId, values: SheetValues): string[] {
  return SHEET_FIELDS[category].filter((f) => !isMainFor(f, values) && appliesTo(f, values) && (values[f.key] === undefined || values[f.key] === '')).map((f) => f.key);
}

/** Valor para mostrar: "3,4 GHz", "AM4, AM5", "sim"; o "não tem" do campo, "não tem". */
export function formatSheetValue(field: SheetField, v: SheetValue | undefined | null): string {
  if (v === undefined || v === null || v === '') return '';
  if (field.none !== undefined && v === field.none) return 'não tem';
  if (field.type === 'bool') return v ? 'sim' : 'não';
  const s = typeof v === 'number' ? v.toLocaleString('pt-BR') : field.type === 'list' ? String(v).split(',').join(', ') : String(v);
  return field.unit && typeof v === 'number' ? (field.unit === 'CL' ? `CL${s}` : `${s} ${field.unit}`) : s;
}
