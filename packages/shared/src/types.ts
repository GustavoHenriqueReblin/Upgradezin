/**
 * Lojas são identificadas só por ID no código. Nome, domínio, busca e caminhos
 * de categoria de cada uma ficam no .env do servidor (STORE_S1_*, …).
 */
export const STORES = ['s1', 's2', 's3'] as const;
export type StoreId = (typeof STORES)[number];

/** O que a interface precisa saber de cada loja configurada (GET /api/stores). */
export interface StoreInfo {
  id: StoreId;
  name: string;
  /** URL completa da busca, com marcador ({q}, {q+} ou {slug}). */
  search: string;
  /** Cor da loja na tela (#rrggbb), do .env; sem ela, a interface usa uma cor padrão. */
  color?: string;
  /** Cores do degradê da bolinha (2 ou 3), quando o .env lista mais de uma. */
  colors?: string[];
}

/** Na ordem da montagem do PC (BUILD_SLOTS); a barra de categorias e a tela inicial seguem esta ordem. */
export const CATEGORIES = ['motherboard', 'cpu', 'ram', 'gpu', 'psu', 'ssd', 'cooler', 'case'] as const;
export type CategoryId = (typeof CATEGORIES)[number];

export interface CategoryDef {
  id: CategoryId;
  name: string;
  /** Termo base enviado à busca interna das lojas. */
  query: string;
  /** Categoria com adapter + normalizador prontos. */
  enabled: boolean;
}

/** Registro único de categorias: UI, validação da API e busca leem daqui. */
export const CATEGORY_DEFS: Record<CategoryId, CategoryDef> = {
  motherboard: { id: 'motherboard', name: 'Placa-Mãe', query: 'placa mae', enabled: true },
  cpu: { id: 'cpu', name: 'Processador', query: 'processador', enabled: true },
  ram: { id: 'ram', name: 'Memória RAM', query: 'memoria ram', enabled: true },
  gpu: { id: 'gpu', name: 'Placa de Vídeo', query: 'placa de video', enabled: true },
  psu: { id: 'psu', name: 'Fonte', query: 'fonte', enabled: true },
  ssd: { id: 'ssd', name: 'SSD', query: 'ssd', enabled: true },
  cooler: { id: 'cooler', name: 'Cooler', query: 'cooler', enabled: true },
  case: { id: 'case', name: 'Gabinete', query: 'gabinete', enabled: true },
};

export const ENABLED_CATEGORIES = CATEGORIES.filter((c) => CATEGORY_DEFS[c].enabled);

/** Ordem crescente de eficiência. Usado para filtros "a partir de". */
export const EFFICIENCY_LEVELS = ['white', 'bronze', 'silver', 'gold', 'platinum', 'titanium'] as const;
export type Efficiency = (typeof EFFICIENCY_LEVELS)[number];

export interface PsuSpecs {
  watts?: number;
  efficiency?: Efficiency;
  /** "80plus" ou "cybenetics"; algumas fontes só têm uma das certificações. */
  efficiencyCert?: '80plus' | 'cybenetics';
  modular?: 'full' | 'semi' | 'none';
  atx?: '3.0' | '3.1';
  /** Conector 12VHPWR / 12V-2x6 ou "PCIe 5" no título. */
  pcie5?: boolean;
  /** Formato compacto SFX/SFX-L (para gabinetes pequenos). Sem isso = ATX. */
  sfx?: boolean;
  /** PFC ativo (informado pela pessoa para a fonte que ela já tem; os títulos das lojas quase nunca trazem). */
  activePfc?: boolean;
}

/** Plataformas de desktop com DDR4 ou DDR5, da mais nova à mais antiga em cada fabricante. */
export const SOCKETS = ['AM5', 'AM4', 'LGA1851', 'LGA1700', 'LGA1200', 'LGA1151'] as const;
export type Socket = (typeof SOCKETS)[number];

/** Chipsets por socket, do mais básico ao topo de linha. Muda raramente (lançamento de plataforma). */
export const CHIPSETS: Record<Socket, string[]> = {
  AM5: ['A620', 'B650', 'B650E', 'B840', 'B850', 'X670', 'X670E', 'X870', 'X870E'],
  AM4: ['A320', 'A520', 'B350', 'B450', 'B550', 'X370', 'X470', 'X570'],
  LGA1851: ['H810', 'B860', 'Z890'],
  LGA1700: ['H610', 'B660', 'H670', 'Z690', 'B760', 'H770', 'Z790'],
  LGA1200: ['H410', 'B460', 'H470', 'Z490', 'H510', 'B560', 'H570', 'Z590'],
  // 6ª/7ª geração (série 100/200) e 8ª/9ª (série 300) usam o mesmo encaixe, mas não são compatíveis entre si: o chipset decide.
  LGA1151: ['H110', 'B150', 'H170', 'Z170', 'B250', 'H270', 'Z270', 'H310', 'B360', 'H370', 'B365', 'Z370', 'Z390'],
};

export const MEMORY_TYPES = ['ddr4', 'ddr5'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Memória que cada plataforma aceita (LGA1700 tem placas DDR4 e DDR5). */
export const SOCKET_MEMORY: Record<Socket, MemoryType[]> = {
  AM5: ['ddr5'],
  AM4: ['ddr4'],
  LGA1851: ['ddr5'],
  LGA1700: ['ddr4', 'ddr5'],
  LGA1200: ['ddr4'],
  LGA1151: ['ddr4'],
};

export const FORM_FACTORS = ['mini-itx', 'matx', 'atx', 'eatx'] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export interface MotherboardSpecs {
  socket?: Socket;
  chipset?: string;
  formFactor?: FormFactor;
  memory?: MemoryType;
  /** Slots de memória ("4xDDR4" no título; Mini-ITX tem sempre 2). */
  memorySlots?: number;
  /** Ficha técnica: slots M.2, geração do M.2 e do slot da placa de vídeo, portas SATA, memória máxima (GB) e até quantos MHz. */
  m2Slots?: number;
  m2Pcie?: 3 | 4 | 5;
  pcieGen?: 3 | 4 | 5;
  sataPorts?: number;
  memoryMaxGb?: number;
  memoryMaxMhz?: number;
  wifi?: boolean;
  /** Bluetooth no título, ou Wi-Fi (módulos Wi-Fi de placa-mãe são combo Wi-Fi + Bluetooth). */
  bluetooth?: boolean;
}

/** Specs de qualquer categoria; cada uma preenche só os campos dela. */
/** Aparência, comum a todas as categorias (do título). */
export interface LookSpecs {
  /** Versão branca. Sem isso = preta (padrão do mercado). */
  white?: boolean;
  rgb?: boolean;
}

// ---------- Processador ----------

export type CpuBrand = 'amd' | 'intel';

/** Linhas de processador de desktop, da mais básica à topo, por fabricante. */
export const CPU_LINES: Record<CpuBrand, string[]> = {
  amd: ['Athlon', 'Ryzen 3', 'Ryzen 5', 'Ryzen 7', 'Ryzen 9'],
  intel: ['Pentium', 'Celeron', 'Core i3', 'Core i5', 'Core i7', 'Core i9', 'Core 3', 'Core 5', 'Core 7', 'Core Ultra 5', 'Core Ultra 7', 'Core Ultra 9'],
};

/** Plataforma de cada fabricante (para o formulário mostrar só as linhas que cabem no socket). */
export const SOCKET_BRAND: Record<Socket, CpuBrand> = {
  AM5: 'amd',
  AM4: 'amd',
  LGA1851: 'intel',
  LGA1700: 'intel',
  LGA1200: 'intel',
  LGA1151: 'intel',
};

/** O socket fica no campo `socket` (o mesmo da placa-mãe). */
export interface CpuSpecs {
  cpuBrand?: CpuBrand;
  /** "Ryzen 5", "Core i5", "Core Ultra 7". */
  cpuLine?: string;
  /** Modelo com sufixo: "5600X", "12400F", "265K". */
  cpuModel?: string;
  /** "Ryzen 5000", "12ª Geração", "Core Ultra Série 2". */
  cpuGen?: string;
  cores?: number;
  threads?: number;
  /** Vídeo integrado (do título ou do sufixo do modelo: F = sem, G = com). */
  igpu?: boolean;
  /** Acompanha cooler. Só quando o anúncio diz (ou o part number da AMD indica "sem fan"). */
  cooler?: boolean;
  /** Multiplicador desbloqueado (Intel K, Ryzen). */
  unlocked?: boolean;
  /** TDP de referência em W (do relatório do CPU-Z; o título das lojas raramente traz). */
  tdp?: number;
}

// ---------- Placa de vídeo ----------

export const GPU_MAKERS = ['nvidia', 'amd', 'intel'] as const;
export type GpuMaker = (typeof GPU_MAKERS)[number];

/**
 * Termo de busca de cada fabricante do chip. A busca das lojas não entende série
 * ("RTX 50" cai em outra categoria), então busca-se pelo fabricante e a série filtra o resultado.
 */
export const GPU_MAKER_QUERY: Record<GpuMaker, string> = { nvidia: 'NVIDIA GeForce', amd: 'AMD Radeon', intel: 'Intel Arc' };

/** Séries por fabricante, da mais nova à mais antiga (derivadas do chip, ver gpuSeriesOf). */
export const GPU_SERIES: { maker: GpuMaker; series: string; label: string }[] = [
  { maker: 'nvidia', series: 'RTX 50', label: 'GeForce RTX 50' },
  { maker: 'nvidia', series: 'RTX 40', label: 'GeForce RTX 40' },
  { maker: 'nvidia', series: 'RTX 30', label: 'GeForce RTX 30' },
  { maker: 'nvidia', series: 'RTX 20', label: 'GeForce RTX 20' },
  { maker: 'nvidia', series: 'GTX 16', label: 'GeForce GTX 16' },
  { maker: 'nvidia', series: 'GTX 10', label: 'GeForce GTX 10' },
  { maker: 'nvidia', series: 'GT', label: 'GeForce GT (Básica)' },
  { maker: 'amd', series: 'RX 9000', label: 'Radeon RX 9000' },
  { maker: 'amd', series: 'RX 7000', label: 'Radeon RX 7000' },
  { maker: 'amd', series: 'RX 6000', label: 'Radeon RX 6000' },
  { maker: 'amd', series: 'RX 500', label: 'Radeon RX 500' },
  { maker: 'intel', series: 'Arc B', label: 'Arc Série B' },
  { maker: 'intel', series: 'Arc A', label: 'Arc Série A' },
];

/** Memória de vídeo comum (GB), para montar a busca. */
export const GPU_VRAM = [4, 6, 8, 12, 16, 24, 32];

/** Marcas de placa de vídeo mais vendidas (o painel lateral mostra todas as do resultado). */
export const GPU_BRANDS = ['ASUS', 'MSI', 'Gigabyte', 'Galax', 'Zotac', 'PNY', 'Palit', 'Gainward', 'Inno3D', 'Sapphire', 'PowerColor', 'XFX', 'ASRock'];

export interface GpuSpecs {
  gpuMaker?: GpuMaker;
  /** Série: "RTX 50", "RX 9000", "Arc B". */
  gpuSeries?: string;
  /** Chip normalizado: "RTX 5060 Ti", "RX 9060 XT", "Arc B580". */
  gpuModel?: string;
  /** Memória de vídeo em GB. */
  vram?: number;
  /** "GDDR6", "GDDR6X", "GDDR7". */
  vramType?: string;
  lowProfile?: boolean;
  /** Comprimento da placa em mm (ficha técnica da loja: o maior lado de "Dimensões"). */
  gpuLength?: number;
  /** Usa o conector 12V-2x6/12VHPWR (ficha técnica). */
  gpu16Pin?: boolean;
  /** Ficha técnica: consumo (W), fonte recomendada pelo fabricante (W), geração PCIe e linhas (x16, x8). */
  gpuTdp?: number;
  gpuPsu?: number;
  gpuPcieGen?: 3 | 4 | 5;
  gpuPcieLanes?: number;
}

// ---------- Memória RAM ----------

/** Capacidades totais comuns (GB), para montar a busca. */
export const RAM_CAPACITIES = [8, 16, 32, 48, 64, 96, 128];

/**
 * Frequências vendidas (MHz) de cada tipo: padrão JEDEC e perfis XMP/EXPO de mercado.
 * O painel mostra também qualquer outra que aparecer no resultado.
 */
export const RAM_SPEEDS: Record<'ddr4' | 'ddr5', number[]> = {
  ddr4: [2133, 2400, 2666, 2933, 3000, 3200, 3466, 3600, 3733, 3866, 4000, 4133, 4266, 4400, 4600, 4800, 5000, 5100],
  ddr5: [4800, 5200, 5600, 6000, 6200, 6400, 6600, 6800, 7000, 7200, 7400, 7600, 7800, 8000, 8200, 8400, 8600, 8800, 9000, 9200, 9600],
};

/** O tipo (DDR4/DDR5) fica no campo `memory` (o mesmo da placa-mãe). */
export interface RamSpecs {
  /** Capacidade total em GB (kit 2x16 = 32). */
  ramCapacity?: number;
  /** Quantidade de pentes (1 = avulso, 2 = kit dual channel). */
  ramModules?: number;
  /** Frequência em MHz (MT/s). */
  ramSpeed?: number;
  /** Latência CAS (CL). */
  ramLatency?: number;
}

// ---------- SSD ----------

export const SSD_INTERFACES = ['nvme', 'sata'] as const;
export type SsdInterface = (typeof SSD_INTERFACES)[number];

export interface SsdSpecs {
  ssdInterface?: SsdInterface;
  /** M.2 (plaquinha na placa-mãe) ou 2,5" (cabo SATA). */
  ssdForm?: 'm2' | '2.5';
  /** Capacidade em GB, como no título (1 TB = 1000). */
  ssdCapacity?: number;
  /** Geração PCIe do NVMe. */
  ssdPcie?: 3 | 4 | 5;
  /** Leitura sequencial em MB/s. */
  ssdRead?: number;
}

// ---------- Cooler ----------

export const COOLER_TYPES = ['air', 'water'] as const;
export type CoolerType = (typeof COOLER_TYPES)[number];
/** Tamanhos de radiador de water cooler (mm). */
export const RADIATORS = [120, 240, 280, 360, 420];

export interface CoolerSpecs {
  coolerType?: CoolerType;
  /** Radiador do water cooler (mm). */
  radiator?: number;
  /** Fabricantes de processador que o título diz aceitar. */
  coolerBrands?: CpuBrand[];
  /** Encaixes que o título lista: AM4, AM5, LGA1851, LGA1700, LGA1200, LGA115X. */
  coolerSockets?: string[];
  /** TDP suportado (W), quando o título diz. */
  coolerTdp?: number;
  /** Altura do air cooler em mm (ficha técnica, quando informa). */
  coolerHeight?: number;
}

// ---------- Gabinete ----------

export interface CaseSpecs {
  /** Maior placa-mãe que cabe (do título; sem formato, pela torre). */
  caseFormFactor?: FormFactor;
  caseTower?: 'mini' | 'mid' | 'full';
  /** Lateral ou frente em vidro. */
  caseGlass?: boolean;
  /** Ventoinhas inclusas (0 = sem fans). */
  caseFans?: number;
  /** Comprimento máximo de placa de vídeo, em mm (ficha técnica). */
  caseMaxGpu?: number;
  /** Altura máxima de cooler do processador, em mm (ficha técnica). */
  caseMaxCooler?: number;
  /** Radiadores de water cooler que o gabinete aceita, em mm (ficha técnica). */
  caseRadiators?: number[];
}

export type Specs = PsuSpecs & MotherboardSpecs & LookSpecs & CpuSpecs & GpuSpecs & RamSpecs & SsdSpecs & CoolerSpecs & CaseSpecs;

/** Mesmo critério do filtro de ofertas novas vendidas pela própria loja. */
export const isOwnRetailOffer = (offer: Pick<Offer, 'marketplace' | 'openbox'>): boolean => !offer.marketplace && !offer.openbox;

export interface Offer {
  store: StoreId;
  /** Identificador do produto na loja. */
  storeSku: string;
  title: string;
  url: string;
  image?: string;
  brand?: string;
  /** Preço à vista (PIX/boleto). */
  priceCash: number;
  /** Preço total no cartão. */
  priceCard?: number;
  installments?: { count: number; value: number };
  /** Preço "de" exibido pela loja. */
  listPrice?: number;
  inStock: boolean;
  seller: string;
  /** Vendido por terceiro dentro da loja. */
  marketplace: boolean;
  openbox: boolean;
  ean?: string;
  mpn?: string;
  /** Cupom anunciado pela loja para o item (aplicado sobre o preço à vista). */
  coupon?: Coupon;
  /** Oferta temporária da loja: o preço volta ao normal quando acaba o prazo ou o estoque da oferta. */
  promo?: { endsAt?: string; left?: number };
  /** Resumo do histórico do anúncio (banco): menor preço à vista com cupom, com estoque, nos últimos 30 dias, e desde quando é acompanhado. */
  history?: { min30: number; since: string };
  specs: Specs;
  /**
   * Ficha técnica juntada do produto (campo → valor, ver sheet/fields.ts), posta pelo servidor ao
   * responder a busca; os filtros da ficha leem daqui. Sem ela: produto ainda sem ficha conhecida.
   */
  sheet?: Record<string, number | string | boolean>;
  /** Chave do produto (a da página /produto/<chave>), posta pelo servidor junto com a ficha. */
  productKey?: string;
  /** Chave de agrupamento entre lojas (ver group.ts). */
  modelKey: string;
  collectedAt: string;
}

/** Um ponto do histórico de preço: gravado quando preço, cupom, oferta ou estoque mudam. */
export interface PricePoint {
  at: string;
  priceCash: number;
  priceCard?: number;
  /** À vista com cupom. */
  effectiveCash: number;
  inStock: boolean;
}

/** Histórico de um anúncio (GET /api/prices/history). */
export interface ListingHistory {
  store: StoreId;
  sku: string;
  points: PricePoint[];
  /** Última coleta em que o anúncio apareceu: o último preço vale até aqui. */
  lastSeenAt?: string;
}

export interface Coupon {
  /** Código para digitar no carrinho, quando a loja informa. */
  code?: string;
  percent?: number;
  /** Desconto fixo em reais, quando o cupom é "R$ X OFF". */
  amount?: number;
  // Condições, quando a loja diz no texto do cupom (parseCouponConditions):
  /** Só vale a partir deste valor (R$). */
  minTotal?: number;
  /** "Cupons limitados": pode acabar antes de a pessoa comprar. */
  limited?: boolean;
  /** Vale até (ISO). */
  endsAt?: string;
  /** Só no PIX / à vista. */
  cashOnly?: boolean;
}

/** O cupom vale para este preço agora: atinge o valor mínimo e não venceu. */
export function couponApplies(o: Pick<Offer, 'priceCash' | 'coupon'>, now = Date.now()): boolean {
  const c = o.coupon;
  if (!c) return false;
  if (c.minTotal && o.priceCash < c.minTotal) return false;
  if (c.endsAt && Date.parse(c.endsAt) <= now) return false;
  return true;
}

/** Preço à vista com cupom (se houver e valer). Base de exibição, ordenação e filtros. */
export function effectiveCash(o: Pick<Offer, 'priceCash' | 'coupon'>, now = Date.now()): number {
  if (!couponApplies(o, now)) return o.priceCash;
  const c = o.coupon;
  if (c?.percent) return Math.round(o.priceCash * (1 - c.percent / 100) * 100) / 100;
  if (c?.amount && c.amount < o.priceCash) return Math.round((o.priceCash - c.amount) * 100) / 100;
  return o.priceCash;
}

/**
 * Condições do cupom no texto da loja: "corre que os cupons são limitados", "em compras acima de
 * R$ 500", "válido até 24/11", "somente no PIX". O que o texto não diz fica sem (vale a % cheia).
 * `now` decide o ano de "válido até dd/mm" sem ano (o próximo dd/mm a partir de hoje).
 */
export function parseCouponConditions(text: string, now = new Date()): Pick<Coupon, 'minTotal' | 'limited' | 'endsAt' | 'cashOnly'> {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const out: Pick<Coupon, 'minTotal' | 'limited' | 'endsAt' | 'cashOnly'> = {};
  if (/limitad|enquanto durar/.test(t)) out.limited = true;
  const min = t.match(/(?:acima de|a partir de|minimo de|minima de|valor minimo(?: de)?|compras? de)\s*r\$\s*([\d.]+(?:,\d{2})?)/);
  if (min) out.minTotal = Number(min[1]!.replace(/\./g, '').replace(',', '.'));
  const until = t.match(/(?:valido|valida|vale)\s+ate\s+(?:o dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (until) {
    const [d, m] = [Number(until[1]), Number(until[2])];
    let y = until[3] ? Number(until[3].length === 2 ? `20${until[3]}` : until[3]) : now.getFullYear();
    // Fim do dia no horário de Brasília.
    let end = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T23:59:59-03:00`);
    if (!until[3] && end.getTime() < now.getTime() - 180 * 86_400_000) end = new Date(`${++y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T23:59:59-03:00`);
    if (!Number.isNaN(end.getTime())) out.endsAt = end.toISOString();
  }
  if (/\bpix\b/.test(t)) out.cashOnly = true;
  return out;
}

/** Extrai % ou valor fixo de textos como "Cupom 10% OFF", "PROMO10OFF", "ganhe R$ 50 OFF". */
export function parseCouponText(text: string): Pick<Coupon, 'percent' | 'amount'> | null {
  const pct = text.match(/(\d{1,2})\s*%\s*off/i);
  if (pct) return { percent: Number(pct[1]) };
  const amt = text.match(/R\$\s*([\d.]+(?:,\d{2})?)\s*off/i);
  if (amt) return { amount: Number(amt[1]!.replace(/\./g, '').replace(',', '.')) };
  // Formato de código: letras grudadas no número ("PROMO10OFF").
  const code = text.match(/[a-z](\d{1,2})off\b/i);
  if (code) return { percent: Number(code[1]) };
  return null;
}

export type StoreRunState = 'queued' | 'running' | 'needs-human' | 'done' | 'cached' | 'blocked' | 'error' | 'cancelled';

/** Motivo de bloqueio em código; a UI decide o texto (nunca mostra detalhe técnico). */
/** Por que a loja não foi consultada. "paused": pausa manual no admin. */
export type BlockReason = 'needs-human' | 'unavailable' | 'too-many-requests' | 'denied' | 'hourly-limit' | 'paused';

export interface StoreStatusEvent {
  store: StoreId;
  state: StoreRunState;
  reason?: BlockReason;
  /** ISO: quando a loja volta a ser consultada (bloqueio) ou quando o cache foi gerado. */
  at?: string;
  count?: number;
  page?: number;
  totalPages?: number;
  ms?: number;
}

export interface SearchParams {
  category: CategoryId;
  /** Termos enviados às lojas, um por vez (ex. ["750W", "850W"]). Nunca vazio. */
  terms: string[];
  stores: StoreId[];
  /** Texto livre (o filtro de texto virou busca): a rotina só mantém o termo enquanto alguém pesquisa. */
  text?: boolean;
}

/** Termo completo como a loja recebe: "fonte 750W". */
export function storeQuery(category: CategoryId, term: string): string {
  const base = CATEGORY_DEFS[category].query;
  const extra = term.trim();
  // Termo que já traz o nome da categoria ("Air Cooler", "SSD NVMe") vai como está.
  return extra.toLowerCase().includes(base) ? extra : `${base} ${extra}`.trim();
}

/**
 * Preenche o modelo de URL de busca da loja (vem do .env):
 *   {q}    "fonte%20750W"   {q+}  "fonte+750W"   {slug}  "fonte-750w"
 */
export function fillSearchUrl(template: string, query: string): string {
  return template
    .replace('{slug}', encodeURIComponent(query.toLowerCase().replace(/\s+/g, '-')))
    .replace('{q+}', encodeURIComponent(query).replace(/%20/g, '+'))
    .replace('{q}', encodeURIComponent(query));
}

/** URL da busca no site da loja, para o usuário abrir no próprio navegador. */
export function storeSearchUrl(template: string, category: CategoryId, term: string): string {
  return fillSearchUrl(template, storeQuery(category, term));
}
