import type { CategoryId } from '../types.ts';
import { SHEET_FIELDS, type SheetField, type SheetValue, type SheetValues } from './fields.ts';

/**
 * Busca na web: o que nenhuma página das lojas nem o título trouxe. Para cada categoria há um JSON de
 * resposta com chaves autoexplicativas para os campos em aberto. A IA do Google
 * recebe esse JSON e o devolve preenchido; o código lê cada chave direto, só validando o tipo (número
 * sem unidade, uma das opções, lista) e a faixa. O que vier fora disso fica de fora: nunca chuta.
 *
 *   {"produto": "...", "<campo>": null, ..., "confianca": null}
 */

/** Versão do leitor da resposta: mudou, o servidor relê as respostas guardadas (recupera o que o leitor antigo perdia). */
export const WEB_PARSER_VERSION = 4;
/** Versão da pergunta: mudou, os produtos que ficaram para uma pessoa voltam à web uma vez (o servidor faz ao subir). */
export const WEB_PROMPT_VERSION = 3;

/** Uma chave do JSON de resposta. */
export interface WebKey {
  /** Chave no JSON (português, com a unidade: "altura_mm"). */
  key: string;
  field: string;
  type: SheetField['type'];
  /** Opções aceitas (texto), comparadas sem maiúsculas: a chave é o que a IA escreve, o valor o que a ficha guarda. */
  options?: Record<string, string>;
  /** Faixa aceita (números). */
  min?: number;
  max?: number;
  /** Normaliza o texto ou cada item da lista ("LGA 1700" -> "LGA1700"); undefined: fora. */
  item?: (s: string) => string | undefined;
  /** "Não tem" do campo (lista vazia na resposta vale isto). */
  none?: SheetValue;
  /** Sim/não: texto que descreve o recurso conta como sim ("VRM Thermal Armor" no dissipador, "XMP 2.0" no XMP). */
  truthy?: RegExp;
}

/** Faixa pela unidade do campo. */
const RANGE: Record<string, [number, number]> = {
  mm: [10, 900],
  W: [5, 2500],
  GB: [1, 16000],
  MHz: [100, 12000],
  GHz: [0.5, 7],
  MB: [0.25, 1024],
  dBA: [5, 70],
  bits: [32, 1024],
  'MB/s': [50, 20000],
  CL: [4, 60],
  'GB/s': [1, 3000],
  // SSDs de IA chegam a 100 mil TBW (1 TB).
  TBW: [10, 250000],
};

const opts = (...xs: string[]) => Object.fromEntries(xs.map((x) => [x.toLowerCase(), x]));
const socket = (s: string) => {
  const m = s
    .toUpperCase()
    .replace(/^(INTEL|AMD)\s*/, '')
    .replace(/[\s-]/g, '')
    .match(/^(?:LGA)?(1851|1700|1200|1151|1150|1155|1156|2066|2011|1366|775)$|^(AM5|AM4|AM3\+?|AM2\+?|FM2\+?|FM1|TR4|STRX4|STR5)$/);
  return m ? (m[1] ? `LGA${m[1]}` : m[2]) : undefined;
};
const BOARDS = opts('E-ATX', 'ATX', 'Micro-ATX', 'Mini-ITX');
const board = (s: string) =>
  BOARDS[
    s
      .toLowerCase()
      .trim()
      .replace(/^(m-?atx|matx|micro ?atx)$/, 'micro-atx')
      .replace(/^(mini ?itx|itx)$/, 'mini-itx')
      .replace(/^eatx$/, 'e-atx')
  ];
/** "Não tem" num campo de texto: "não", "nao", "nenhum", "sem". */
const NO = /^(n[aã]o( possui| tem)?|nenhum|sem|none|no)$/i;
/** Bluetooth: a versão ("5.3") ou "Não". */
const btItem = (s: string) => (NO.test(s.trim()) ? 'Não' : s.match(/\d\.\d/)?.[0] ?? (/^\d$/.test(s.trim()) ? `${s.trim()}.0` : undefined));
/** Fases do VRM: "14+2+1" (sem espaços; placas topo têm até 5 grupos, "20+1+2+1+1"). */
const phases = (s: string) => s.replace(/\s/g, '').match(/^\d{1,2}(\+\d{1,2}){0,5}$/)?.[0];
/** Conectores de alimentação da placa de vídeo: "1x 8 pinos", "2x 8 pinos", "1x 16 pinos" ou "Não". */
const powerItem = (s: string) => {
  if (NO.test(s.trim())) return 'Não';
  const t = s.toLowerCase().replace(/12v-?2x6|12vhpwr|12\s*\+\s*4/g, '16');
  const items = [...t.matchAll(/(?:(\d)\s*x\s*)?(16|8|6\s*\+\s*2|6)\s*-?\s*(?:pinos?|pins?)/g)].map((m) => `${m[1] ?? 1}x ${m[2]!.replace(/\s/g, '')} pinos`);
  // Só o nome do conector de 16 pinos ("12V-2x6", "12VHPWR").
  if (!items.length && /12v-?2x6|12vhpwr/i.test(s)) return '1x 16 pinos';
  return items.length ? items.join(' + ') : undefined;
};
/** Frente do gabinete pelas palavras da resposta ("Vidro Temperado Frontal e Lateral" -> "Vidro"). */
const frontItem = (s: string) => /mesh|tela|perfura/i.test(s) ? 'Mesh' : /vidro|glass/i.test(s) ? 'Vidro' : /acr[ií]l/i.test(s) ? 'Acrílico'
  : /fechad|s[oó]lid|met[aá]l|alum[ií]n|pl[aá]stic|\babs\b/i.test(s) ? 'Fechada' : undefined;
/** Código do chip das AMD mais antigas: nome em vez de letras e número ("Ellesmere" da RX 580, "Polaris 20"). */
const AMD_CODENAME = /^(?:ellesmere|baffin|lexa|polaris \d{2}|vega \d{2}|tonga|fiji|hawaii|tahiti|pitcairn|bonaire|oland|cape verde)$/i;
/** Código do chip da placa de vídeo ("AD107", "GB206", "Navi 44", "Ellesmere"). */
const siliconItem = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  if (AMD_CODENAME.test(t)) return t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  // Do código completo fica o do chip: "GB206-250-A1" (variante e revisão) -> "GB206"; "Navi 44 XT" -> "NAVI 44".
  const u = t.toUpperCase();
  return u.match(/^[A-Z]{1,4}\d{2,3}[A-Z]?(?=$|-\d{3}(?:-[A-Z]\d)?$)/)?.[0] ?? u.match(/^NAVI \d{2}(?=$| (?:XTX|XT|XL|GRE)$)/)?.[0];
};
const radiator = (s: string) => (['120', '140', '240', '280', '360', '420', '480'].includes(s.replace(/\D/g, '')) ? s.replace(/\D/g, '') : undefined);

/** As chaves de cada categoria: nome da chave, opções e normalização (o tipo e a faixa vêm do campo). */
const KEYS: Record<CategoryId, Record<string, Partial<WebKey> & { key: string }>> = {
  cpu: {
    socket: { key: 'soquete', item: socket },
    architecture: { key: 'arquitetura' },
    cores: { key: 'nucleos', min: 1, max: 128 },
    threads: { key: 'threads', min: 1, max: 256 },
    baseGhz: { key: 'clock_base_ghz' },
    boostGhz: { key: 'clock_boost_ghz' },
    l2Mb: { key: 'cache_l2_mb' },
    l3Mb: { key: 'cache_l3_mb' },
    tdpW: { key: 'tdp_w', min: 5, max: 500 },
    igpu: { key: 'video_integrado' },
    ramType: { key: 'memoria', options: opts('DDR4', 'DDR5', 'DDR4, DDR5') },
  },
  motherboard: {
    chipset: { key: 'chipset' },
    socket: { key: 'soquete', item: socket },
    formFactor: { key: 'formato', options: { ...BOARDS, matx: 'Micro-ATX', 'micro atx': 'Micro-ATX', 'mini itx': 'Mini-ITX' } },
    ramType: { key: 'memoria', options: opts('DDR4', 'DDR5', 'DDR3') },
    ramSlots: { key: 'slots_memoria', min: 1, max: 8 },
    ramMaxGb: { key: 'memoria_max_gb', min: 8, max: 1024 },
    ramMaxMhz: { key: 'memoria_max_mhz' },
    pcieX16: { key: 'pcie_x16_versao', options: opts('3.0', '4.0', '5.0') },
    m2Slots: { key: 'slots_m2', min: 0, max: 8 },
    m2Pcie: { key: 'm2_pcie_versao', options: opts('3.0', '4.0', '5.0') },
    sataPorts: { key: 'portas_sata', min: 0, max: 12 },
    lan: { key: 'rede', options: opts('1 Gb', '2.5 Gb', '5 Gb', '10 Gb') },
    wifi: { key: 'wifi', options: opts('Wi-Fi 5', 'Wi-Fi 6', 'Wi-Fi 6E', 'Wi-Fi 7', 'Wi-Fi', 'Não') },
    bluetooth: { key: 'bluetooth_versao', item: btItem },
    vrmPhases: { key: 'fases_vrm', item: phases },
    vrmHeatsink: { key: 'dissipador_vrm', truthy: /dissip|heat ?sink|armor|aleta|heat-?pipe|t[eé]rmic|thermal/i },
    biosFlashback: { key: 'bios_flashback', truthy: /flash ?back|q-?flash|bios ?flash/i },
    m2SharesSata: { key: 'm2_desativa_portas_sata' },
    m2SharesGpu: { key: 'm2_divide_linhas_do_slot_x16' },
  },
  gpu: {
    chip: { key: 'chip' },
    silicon: { key: 'codigo_do_chip', item: siliconItem },
    vramGb: { key: 'vram_gb', min: 1, max: 48 },
    memType: { key: 'tipo_memoria', options: opts('GDDR5', 'GDDR5X', 'GDDR6', 'GDDR6X', 'GDDR7') },
    busBits: { key: 'barramento_bits' },
    baseMhz: { key: 'clock_base_mhz', min: 300, max: 4000 },
    boostMhz: { key: 'clock_boost_mhz', min: 300, max: 4000 },
    tdpW: { key: 'consumo_w', min: 20, max: 700 },
    psuW: { key: 'fonte_recomendada_w', min: 200, max: 1600 },
    lengthMm: { key: 'comprimento_mm', min: 100, max: 450 },
    pcie: { key: 'pcie' },
    power16Pin: { key: 'conector_16_pinos' },
    fans: { key: 'ventoinhas', min: 0, max: 4 },
    architecture: { key: 'arquitetura', options: opts('Blackwell', 'Ada Lovelace', 'Ampere', 'Turing', 'Pascal', 'NVIDIA Kepler', 'RDNA 4', 'RDNA 3', 'RDNA 2', 'RDNA', 'Polaris', 'Battlemage', 'Alchemist') },
    shaders: { key: 'nucleos_cuda_ou_stream', min: 16, max: 32768 },
    bandwidthGbs: { key: 'largura_banda_gbs' },
    powerConnectors: { key: 'conectores_alimentacao', item: powerItem },
  },
  ram: {
    capacityGb: { key: 'capacidade_total_gb', min: 1, max: 512 },
    modules: { key: 'modulos', min: 1, max: 8 },
    type: { key: 'tipo', options: opts('DDR3', 'DDR4', 'DDR5') },
    mhz: { key: 'frequencia_mhz', min: 800, max: 12000 },
    cl: { key: 'latencia_cl' },
    xmp: { key: 'xmp', truthy: /xmp/i },
    expo: { key: 'expo', truthy: /expo/i },
  },
  ssd: {
    capacityGb: { key: 'capacidade_gb', min: 60, max: 16000 },
    formFactor: { key: 'formato', options: { ...opts('M.2 2280', 'M.2 2242', 'M.2 2230', '2,5"', 'mSATA'), '2.5"': '2,5"', '2,5 pol': '2,5"', '2.5 pol': '2,5"', '2,5': '2,5"', '2.5': '2,5"' } },
    interface: { key: 'interface', options: opts('SATA', 'NVMe PCIe 3.0', 'NVMe PCIe 4.0', 'NVMe PCIe 5.0') },
    readMbs: { key: 'leitura_mbs' },
    writeMbs: { key: 'gravacao_mbs' },
    pcieGen: { key: 'geracao_pcie', options: opts('3.0', '4.0', '5.0', 'Não') },
    nand: { key: 'tipo_nand', options: opts('SLC', 'MLC', 'TLC', 'QLC') },
    dram: { key: 'cache_dram', truthy: /dram|ddr|cache/i },
    tbw: { key: 'durabilidade_tbw' },
  },
  psu: {
    watts: { key: 'potencia_w', min: 150, max: 2500 },
    efficiency: {
      key: 'certificacao',
      options: opts(
        '80 Plus White',
        '80 Plus Bronze',
        '80 Plus Silver',
        '80 Plus Gold',
        '80 Plus Platinum',
        '80 Plus Titanium',
        'Cybenetics Bronze',
        'Cybenetics Silver',
        'Cybenetics Gold',
        'Cybenetics Platinum',
        'Cybenetics Titanium',
        'Sem certificação',
      ),
    },
    modular: { key: 'modular', options: { total: 'Total', semi: 'Semi', nao: 'Não', 'não': 'Não' } },
    standard: { key: 'padrao', options: opts('ATX', 'ATX 3.0', 'ATX 3.1', 'SFX', 'SFX-L') },
    eps: { key: 'conectores_cpu_eps', min: 0, max: 4 },
    pcie8: { key: 'conectores_pcie_6_mais_2', min: 0, max: 12 },
    pcie16: { key: 'conectores_16_pinos', min: 0, max: 4 },
    sata: { key: 'conectores_sata', min: 0, max: 20 },
  },
  case: {
    formFactor: { key: 'tamanho', options: opts('Mid Tower', 'Mini Tower', 'Full Tower', 'Micro Tower', 'SFF') },
    mbFormats: { key: 'placas_mae', item: board },
    maxGpuMm: { key: 'placa_de_video_max_mm', min: 150, max: 600 },
    maxCoolerMm: { key: 'cooler_max_mm', min: 50, max: 300 },
    dimensions: { key: 'dimensoes_mm' },
    front: { key: 'frente', item: frontItem, options: opts('Mesh', 'Vidro', 'Fechada', 'Acrílico', 'Acrílico e ABS') },
    fansIncluded: { key: 'ventoinhas_inclusas', min: 0, max: 12 },
    fansMax: { key: 'ventoinhas_max', min: 1, max: 20 },
    radiators: { key: 'radiadores_mm', item: radiator },
  },
  cooler: {
    type: { key: 'tipo', options: { air: 'ar', ar: 'ar', water: 'water' } },
    heightMm: { key: 'altura_mm', min: 20, max: 200 },
    radiatorMm: { key: 'radiador_mm', options: opts('120', '140', '240', '280', '360', '420', '480') },
    tdpW: { key: 'tdp_w', min: 50, max: 500 },
    noiseDba: { key: 'ruido_dba' },
    sockets: { key: 'soquetes', item: socket },
    fans: { key: 'ventoinhas', min: 1, max: 6 },
    heatpipes: { key: 'heatpipes', min: 0, max: 12 },
    fanMm: { key: 'ventoinha_mm', options: { ...opts('80', '92', '120', '140', '200'), 90: '92', 135: '140', 150: '140' } },
  },
};

/** As chaves do JSON de uma categoria, com o tipo e a faixa do campo. */
export function webKeys(category: CategoryId): WebKey[] {
  return SHEET_FIELDS[category].flatMap((f) => {
    const k = KEYS[category][f.key];
    if (!k) return [];
    const range = f.unit ? RANGE[f.unit] : undefined;
    return [{ field: f.key, type: f.type, ...(range && { min: range[0], max: range[1] }), ...(f.none !== undefined && { none: f.none }), ...k }];
  });
}

/**
 * Nome do produto para a pergunta: o título sem o tipo do produto e sem as especificações que as lojas
 * põem no nome ("Universal", "Intel/AMD", "TDP 95W", "120mm", "RGB", a cor), até a primeira vírgula, com o
 * código do fabricante do fim.
 */
export function webProductName(title: string): string {
  // Vírgula entre números ("3,7ghz") não separa.
  const parts = title.split(/,(?!\d)|\s-\s/).map((s) => s.trim()).filter(Boolean);
  const typeOnly = /^(?:water cooler|cooler|gabinete(?: gamer)?|placa de v[ií]deo|placa[ -]+m[aã]e|mem[oó]ria(?: ram)?|ssd|fonte|processador)$/i;
  let at = parts[0] && typeOnly.test(parts[0]) && parts[1] ? 1 : 0;
  let first = parts[at] ?? title;
  // Sem número, o nome não identifica o modelo ("Processador Intel Core - i3-6100 - ..."): junta o pedaço seguinte.
  while (!/\d/.test(first) && parts[at + 1]) first = `${first} ${parts[++at]}`;
  const head = first
    .replace(/^(water\s*cooler|cooler(\s+(para\s+)?processador)?|gabinete(\s+gamer)?|placa\s+de\s+v[ií]deo|placa[\s-]+m[aã]e|mem[oó]ria(\s+ram)?|ssd|fonte(\s+de\s+alimenta[cç][aã]o)?|processador)\s+/i, '')
    .replace(/\b(para\s+processador|universal|intel\s*[/&-]?\s*amd|amd\s*[/&-]?\s*intel|gamer|a?rgb|led|preto|preta|branco|branca|black|white)\b/gi, ' ')
    .replace(/\bt[dg]p\s*\d+\s*w\b|\b\d{2,3}\s*mm\b|\b\d+\s*fans?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Código do fabricante no fim ("RR-212A-20PD-R1"), se não estiver no começo.
  const last = parts.length > at + 1 ? parts[parts.length - 1]!.replace(/\s*-?\s*open\s*box$/i, '') : '';
  const code = /^[A-Z0-9][A-Z0-9-]{5,}$/i.test(last) && /\d/.test(last) && !head.toLowerCase().includes(last.toLowerCase()) ? ` ${last}` : '';
  return `${head}${code}`.replace(/\s+/g, ' ').trim();
}

const NOUN: Record<CategoryId, string> = {
  cpu: 'do processador',
  motherboard: 'da placa-mãe',
  gpu: 'da placa de vídeo',
  ram: 'da memória',
  ssd: 'do SSD',
  psu: 'da fonte',
  case: 'do gabinete',
  cooler: 'do cooler',
};

/**
 * Onde buscar o que o fabricante não divulga: placa de vídeo, processador e SSD têm bases técnicas com a ficha completa (o clock base
 * da RX 9070 EVO não está no site do fabricante, mas está no TechPowerUp). Só "pelo site do fabricante", a IA respondia null.
 */
const TECH_DB: Partial<Record<CategoryId, string>> = {
  ...Object.fromEntries((['gpu', 'cpu', 'ssd'] as const).map((c) => [c, ' ou, no que ele não divulgar, pelo TechPowerUp'])),
  // Cooler: o TechPowerUp não tem base, mas tem análises com a carga que ele dissipa (fabricante que não divulga TDP, como a Noctua).
  cooler: ' ou, no que ele não divulgar, por análises (TechPowerUp) e fichas técnicas de lojas',
};
/** Sem base técnica (gabinete, cooler, fonte, placa-mãe, memória): fichas de lojas e análises (o máximo de ventoinhas de um gabinete ABKO). */
const OTHER_SOURCES = ' ou, no que ele não divulgar, por fichas técnicas de lojas e análises';

/**
 * O pedido: preencher as chaves selecionadas da categoria com as especificações do produto,
 * com as opções das chaves fechadas e as regras curtas (o pedido vai no endereço da busca).
 */
export function webPrompt(category: CategoryId, title: string, fields?: readonly string[], known: SheetValues = {}): string {
  const name = webProductName(title);
  const keys = webKeys(category).filter((key) => !fields || fields.includes(key.field));
  const identity = [known.brand, known.model].filter((v) => typeof v === 'string' && /[a-z]/i.test(v)).join(' ');
  const search = fields
    ? ` Confirme a variante pelo título ("${title.slice(0, 180)}")${identity ? ` e pela identificação ("${identity.slice(0, 100)}")` : ''}. Busque também no manual ou datasheet. `
      + (category === 'motherboard' ? 'Separe o slot gráfico x16 do M.2. Pelo manual: true se usar um M.2 desliga portas SATA ou divide as linhas do slot x16. ' :
        category === 'ssd' ? 'Use a mesma capacidade e o mesmo código do SSD. ' :
        category === 'case' ? 'Procure folgas da GPU e do cooler e posições de radiador na tabela técnica. ' :
        category === 'cpu' ? 'Sem turbo: clock_boost_ghz igual ao clock_base_ghz. ' :
        category === 'cooler' ? 'tdp_w: o TDP máximo suportado que o fabricante ou as lojas divulgam ("suporta até 250 W"); sem isso, quantos watts as análises mostram que ele dissipa (o menor, se for faixa). ' :
        category === 'gpu' ? 'Sem boost: clock_boost_mhz igual ao clock_base_mhz. ' : '')
    : ' ';
  const legend = keys
    .filter((k) => k.options)
    .map((k) => `${k.key}: ${[...new Set(Object.values(k.options!))].join(' | ')}`)
    .join('; ');
  // Listas também começam em null: assim [] na resposta quer dizer "não tem" (e não "não preenchi").
  const template = JSON.stringify({ produto: name, ...Object.fromEntries(keys.map((k) => [k.key, null])), confianca: null });
  return (
    `Preencha este JSON com as especificações ${NOUN[category]} ${name}, pelo site do fabricante${TECH_DB[category] ?? OTHER_SOURCES}.${search}` +
    'Não invente: o que não achar fica null. Se o produto não tem o recurso (sem Wi-Fi, sem conector de 16 pinos, sem suporte a radiador), responda "Não", 0, false ou []; null só quando não souber. ' +
    'Números sem unidade; listas com os itens. confianca: alta, media ou baixa. ' +
    (legend ? `Opções: ${legend}. ` : '') +
    'RESPONDA SOMENTE O JSON PREENCHIDO, VÁLIDO, SEM TEXTO ANTES OU DEPOIS. ' +
    template
  );
}

/** A resposta lida: os valores aceitos (por campo da ficha), a confiança e o JSON como veio. */
export interface WebReply {
  values: SheetValues;
  confidence?: 'high' | 'medium' | 'low';
  raw: Record<string, unknown>;
}

/** Texto da tela que o buscador mistura na resposta (acessibilidade, botões). */
const SCREEN_TEXT = /\[\s*(?:in[ií]cio|fim) do texto destacado\s*\]|acesse a caixa de di[aá]logo de visualiza[cç][aã]o de produtos para esse item\.?|\[\s*(?:start|end) of highlighted text\s*\]/gi;

/** Conserta o JSON quebrado mais comum: aspas de polegada sem escape ("2.5"" -> "2.5 pol"). */
const repair = (s: string) => s.replace(/(\d)"(?=\s*[\w/(]|"\s*[,\]}])/g, '$1 pol');

function tryJson(s: string): Record<string, unknown> | undefined {
  for (const t of [s, repair(s)]) {
    try {
      const o = JSON.parse(t) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* tenta o próximo */
    }
  }
  return undefined;
}

/** Chave a chave, quando o JSON não abre: "chave": valor (texto, lista, número, null ou booleano). */
function looseObject(s: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of s.matchAll(/"\s*(\w+)\s*"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\]|-?\d+(?:[.,]\d+)?|null|true|false)/g)) {
    if (m[1]! in out) continue;
    const raw = m[2]!;
    out[m[1]!] = raw.startsWith('[')
      ? (tryJson(`{"a":${raw}}`)?.a ?? [...raw.matchAll(/"([^"]*)"/g)].map((x) => x[1]))
      : raw.startsWith('"')
        ? raw.slice(1, -1).replace(/\\"/g, '"')
        : raw === 'null'
          ? null
          : raw === 'true' || raw === 'false'
            ? raw === 'true'
            : Number(raw.replace(',', '.'));
  }
  return out;
}

/** Número de um valor: 155, "155", "155 mm", "158,5". */
const toNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const m = v.replace(/(\d)\.(\d{3})\b/g, '$1$2').match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : undefined;
};

/** O valor de uma chave, validado pelo tipo, pelas opções e pela faixa (undefined: fora). */
export function acceptWebValue(k: WebKey, v: unknown): SheetValue | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  // "Não tem" escrito de outro jeito ("Não", false, 0 num campo de texto) vale o "não tem" do campo.
  if (k.none !== undefined && k.type !== 'bool' && (v === false || (typeof v === 'string' && NO.test(v.trim())) || (v === 0 && k.type !== 'int' && k.type !== 'real'))) return k.none;
  // Número numa lista de opções "4.0" ("4" ou 4 = PCIe 4.0).
  if (k.options && (typeof v === 'number' || /^\d+$/.test(String(v).trim())) && k.options[`${String(v).trim()}.0`] !== undefined && k.options[String(v).trim()] === undefined) {
    return k.options[`${String(v).trim()}.0`];
  }
  // Contagem que veio como lista: soma as quantidades ({"quantidade": 3, ...}) ou conta os itens.
  if ((k.type === 'int' || k.type === 'real') && Array.isArray(v)) {
    const qty = v.map((x) => (x && typeof x === 'object' ? toNumber((x as Record<string, unknown>).quantidade ?? (x as Record<string, unknown>).quantity) : undefined));
    const n = qty.every((q) => q !== undefined) ? qty.reduce<number>((t, q) => t + q!, 0) : v.length;
    return acceptWebValue(k, n);
  }
  if (k.type === 'bool') {
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'string' && k.truthy?.test(v) && !NO.test(v.trim())) return true;
  }
  if (k.type === 'list') {
    const items = (Array.isArray(v) ? v : String(v).split(/[,;]|\s\/\s/)).map((x) => String(x).trim()).filter(Boolean);
    const ok = [...new Set(items.map((x) => (k.item ? k.item(x) : x)).filter((x): x is string => !!x))];
    return ok.length ? ok.join(',') : undefined;
  }
  if (k.type === 'bool') return typeof v === 'boolean' ? v : /^(sim|true|yes)$/i.test(String(v)) ? true : /^(n[aã]o|false|no)$/i.test(String(v)) ? false : undefined;
  if (k.options) {
    // Também com a unidade no fim ("480 mm" para a opção "480").
    const s = String(v).trim().toLowerCase();
    const o = k.options[s] ?? k.options[s.replace(/\s*mm$/, '')] ?? (k.item ? k.item(String(v)) : undefined);
    // Campo numérico com opções (radiador): o valor é o número, não o texto da opção.
    return o !== undefined && (k.type === 'int' || k.type === 'real') ? Number(o) : o;
  }
  if (k.type === 'int' || k.type === 'real') {
    const n = toNumber(v);
    if (n === undefined || (k.min !== undefined && n < k.min) || (k.max !== undefined && n > k.max)) return undefined;
    return k.type === 'int' ? Math.round(n) : n;
  }
  if (k.item) return k.item(String(v));
  const s = String(v).trim();
  return s.length <= 60 && !/^(null|n\/a|desconhecido|nao informado|não informado)$/i.test(s) ? s : undefined;
}

/** O valor de um campo da ficha validado como no JSON da web (tipo, opções, faixa); para o que se preenche à mão. */
export function acceptSheetValue(category: CategoryId, field: string, v: unknown): SheetValue | undefined {
  const k = webKeys(category).find((x) => x.field === field);
  return k ? acceptWebValue(k, v) : undefined;
}

/** Chaves com espaços em volta ("ventoinhas   "), como a IA às vezes devolve: valem como a chave sem eles. */
const trimKeys = (o: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = k.trim();
    if (!(key in out) || out[key] === null || out[key] === undefined) out[key] = v;
  }
  return out;
};

/** Sem turbo, a IA às vezes responde 0 (ou "Não") no turbo: vale o clock base. */
const NO_BOOST = (v: unknown) => v === 0 || v === '0' || v === false || (typeof v === 'string' && NO.test(v.trim()));

/**
 * A resposta no texto da página: o último JSON que começa em {"produto" (o pedido também aparece antes,
 * com tudo null) até a última } depois dele; sem o texto da tela que o buscador mistura; com as aspas de
 * polegada consertadas; se ainda não abrir, lido chave a chave. Cada chave da categoria é validada.
 * Confiança baixa: nenhum valor entra. undefined: a página não trouxe a resposta.
 * `question`: o pedido feito. Lista vazia vale "não tem" só se o pedido trazia a chave em null (pedidos antigos traziam []).
 */
export function parseWebReply(category: CategoryId, text: string, question?: string): WebReply | undefined {
  const clean = text.replace(SCREEN_TEXT, ' ');
  const keys = webKeys(category);
  const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  const starts = [...clean.matchAll(/\{\s*"produto"\s*:/g)].map((m) => m.index!);
  for (const start of starts.reverse()) {
    const end = clean.lastIndexOf('}');
    if (end <= start) continue;
    const body = clean.slice(start, end + 1);
    const first = body.slice(0, body.indexOf('}') + 1);
    const raw = trimKeys(tryJson(first) ?? tryJson(body) ?? looseObject(first));
    // O pedido repetido: tudo vazio e sem confiança.
    if (keys.every((k) => empty(raw[k.key])) && empty(raw.confianca)) continue;
    const conf = String(raw.confianca ?? '').toLowerCase().trim();
    const confidence = /^(alta|high)/.test(conf) ? 'high' : /^(m[eé]dia|medium)/.test(conf) ? 'medium' : /^(baixa|low)/.test(conf) ? 'low' : undefined;
    const values: SheetValues = {};
    if (confidence !== 'low')
      for (const k of keys) {
        const r = raw[k.key];
        const v = acceptWebValue(k, r);
        if (v !== undefined) values[k.field] = v;
        else if (Array.isArray(r) && !r.length && k.none !== undefined && !question?.includes(`"${k.key}":[]`)) values[k.field] = k.none;
      }
    if (category === 'cpu' && values.boostGhz === undefined && values.baseGhz !== undefined && NO_BOOST(raw.clock_boost_ghz)) values.boostGhz = values.baseGhz;
    if (category === 'gpu' && values.boostMhz === undefined && values.baseMhz !== undefined && NO_BOOST(raw.clock_boost_mhz)) values.boostMhz = values.baseMhz;
    return { values, ...(confidence && { confidence }), raw };
  }
  return undefined;
}
