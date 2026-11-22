import type { SpecSheet } from './specsheet.ts';
import type { BlockReason, CategoryId, Specs, StoreId } from './types.ts';

/** Tipos das respostas do admin (/api/admin), usados pelo servidor e pela tela /admin. */

/** Estado do servidor: versão, há quanto tempo está no ar, banco, memória, Chrome. */
export interface ServerStatus {
  version: string;
  commit: string | null;
  startedAt: string;
  uptimeS: number;
  node: string;
  memory: { rssMb: number; heapMb: number; systemFreeMb: number; systemTotalMb: number };
  db: { file: string; sizeMb: number; walMb: number; migration: number };
  browserOpen: boolean;
  /** Buscas e rodadas da rotina usando o navegador agora. */
  activeSessions: number;
}

/** Configuração de uma loja no admin (o que antes ficava em STORE_* no .env). */
export interface AdminStoreConfig {
  id: string;
  /** Tem configuração (no banco). Sem ela, a loja não existe para o app. */
  configured: boolean;
  /** Ligada: entra nas buscas e na rotina. */
  enabled: boolean;
  name: string;
  /** Origem do site (https://www.loja.com.br). */
  url: string;
  /** Caminho da busca com marcador: {q}, {q+} ou {slug}. */
  search: string;
  /** Caminho da categoria na loja, para o adapter filtrar (categoria do app -> caminho). */
  categories: Record<string, string>;
  /**
   * Página de cada categoria no site (começa com /), lida pela rotina de preços: um ou mais caminhos
   * separados por espaço (ex. "/hardware/coolers/air-cooler /hardware/coolers/water-cooler").
   */
  sweep: Record<string, string>;
  /** Cores (#rrggbb): uma lisa, ou 2–3 em degradê. */
  colors: string[];
  updatedAt: string | null;
}

/** O que o admin manda para salvar uma loja. `colors` vai como texto ("#a,#b"), como era no .env. */
export interface AdminStoreInput {
  enabled: boolean;
  name: string;
  url: string;
  search: string;
  categories: Record<string, string>;
  sweep: Record<string, string>;
  colors: string;
}

/** term: busca por texto ("Não achou? Buscar nas lojas"); sweep: página de categoria; sheet: ficha técnica. */
export type AttemptKind = 'term' | 'sweep' | 'sheet';
/** De onde veio a consulta: busca do site, rotina ou "varrer agora" do admin. */
export type AttemptOrigin = 'search' | 'routine' | 'admin';
/** "partial": leu parte e parou (bloqueio ou limite no meio); "limit": limite de páginas por hora. */
export type AttemptStatus = 'ok' | 'partial' | 'blocked' | 'limit' | 'error';

/** Uma consulta a uma loja (busca por texto, página de categoria ou ficha técnica). */
export interface StoreAttempt {
  id: number;
  store: StoreId;
  /** Fim da consulta (ISO). */
  at: string;
  kind: AttemptKind;
  origin: AttemptOrigin;
  category?: CategoryId;
  /** Texto buscado, ou o código do produto na ficha técnica. */
  term?: string;
  page?: number;
  status: AttemptStatus;
  /** Ofertas lidas. */
  count: number;
  reason?: BlockReason;
  detail?: string;
  ms: number;
}

/**
 * Ritmo da rotina numa loja: ela lê uma página de categoria a cada `seconds[modo]` (editável no
 * admin; padrão ROUTINE_NORMAL_GAP_S / _REDUCED_ / _SLOW_). Só a rotina: a busca por texto vai à
 * loja na hora ou não vai, conforme `live` da loja.
 */
export const ROUTINE_MODES = ['normal', 'reduced', 'slow'] as const;
export type RoutineMode = (typeof ROUTINE_MODES)[number];

/** Limites dos segundos de um modo no admin. */
export const MODE_SECONDS_MIN = 5;
export const MODE_SECONDS_MAX = 6 * 3600;

/** Rotina de coleta e busca ao vivo (do .env na primeira vez; depois, do admin). */
export interface RoutineSettings {
  enabled: boolean;
  stores: StoreId[];
  /** Modo da rotina em cada loja (só o intervalo da rotina). */
  modes: Record<StoreId, RoutineMode>;
  /** Busca ao vivo: o "Não achou? Buscar nas lojas" consulta a loja na hora. Desligada: só o banco. */
  live: Record<StoreId, boolean>;
  /** Segundos entre uma coleta da rotina e a próxima, em cada modo. */
  seconds: Record<RoutineMode, number>;
}

/**
 * Rotina de fichas técnicas: separada da coleta (chave, lojas e intervalo próprios). Lê, em cada
 * loja, uma ficha do catálogo a cada `seconds` segundos (+ até 20% aleatório).
 */
export interface SheetRoutineSettings {
  enabled: boolean;
  stores: StoreId[];
  seconds: number;
}

/** O que o admin manda para mudar a rotina de fichas (o que falta fica como está). */
export type SheetRoutineInput = Partial<SheetRoutineSettings>;

/** Intervalo entre fichas no admin: de 10 segundos a 1 dia. */
export const SHEET_SECONDS_MIN = 10;
export const SHEET_SECONDS_MAX = 86_400;

/** O que o admin manda para mudar a rotina (o que falta fica como está). */
export interface RoutineInput {
  enabled: boolean;
  stores: StoreId[];
  modes?: Partial<Record<StoreId, RoutineMode>>;
  live?: Partial<Record<StoreId, boolean>>;
  seconds?: Partial<Record<RoutineMode, number>>;
}

/**
 * Aviso de mudança no canal ao vivo do admin (evento `change`): `store` (loja começou ou terminou
 * uma página, entrou ou saiu de pausa), `admin` (algo mudou pelo admin), `activity` (busca no site).
 */
export type AdminChange = 'store' | 'admin' | 'activity';

/** Estado da rotina no admin. */
export interface RoutineInfo extends RoutineSettings {
  /** Alguma loja coletando agora. */
  busy: boolean;
  lastTickAt: string | null;
  /** A próxima vez que alguma loja da rotina consulta. */
  nextTickAt: string | null;
}

/** Situação de uma loja agora, para o painel do admin. */
export interface AdminStoreState {
  id: StoreId;
  name: string;
  enabled: boolean;
  /** Está entre as lojas da rotina. */
  inRoutine: boolean;
  /** Modo da loja na rotina. */
  mode: RoutineMode;
  /** Consultada na hora pelo "Não achou? Buscar nas lojas". */
  live: boolean;
  /** Coletando para a rotina agora. */
  busy: boolean;
  /**
   * Fila da loja agora: consulta em andamento (rotina, busca do site ou admin) e quantas esperam
   * a vez. `priority`: busca por texto, "varrer agora" e ficha técnica (passam na frente); `routine`: rotina.
   */
  queue: { running: boolean; priority: number; routine: number };
  /** Pausa valendo agora (bloqueio ou manual, reason "paused"). step -1: pausa manual sem bloqueio antes. */
  pause: { until: string; step: number; reason: BlockReason } | null;
  /** Páginas pedidas na última hora e os limites. */
  pagesUsed: number;
  pagesPerHour: number;
  routinePagesPerHour: number;
  /**
   * Quando sai a próxima consulta: na rotina, a próxima vez dela nessa loja (respeitando pausa e
   * intervalo mínimo); fora dela, o fim do intervalo mínimo. null se não há nada marcado.
   */
  nextAt: string | null;
  lastOk: StoreAttempt | null;
  lastBlock: StoreAttempt | null;
  /** Consultas nas últimas 24 h, por resultado. */
  last24h: Partial<Record<AttemptStatus, number>>;
}

/** Cobertura de uma loja numa categoria: quantos anúncios, quão frescos, e a leitura da categoria na loja. */
export interface CoverageRow {
  store: StoreId;
  category: CategoryId;
  listings: number;
  /** Anúncios em estoque na última oferta vista. */
  inStock: number;
  /** Anúncios vistos nas últimas 24 h e 7 dias. */
  seen24h: number;
  seen7d: number;
  /** Caminhos de categoria configurados na loja (0: a rotina não lê esta categoria nesta loja). */
  paths: number;
  /** Volta em andamento: caminho (1, 2…) e página que a rotina lê agora; null sem volta em andamento. */
  sweeping: { path: number; page: number } | null;
  /** Fim da última volta completa. */
  sweptAt: string | null;
  /** Último anúncio visto (de qualquer coleta). */
  lastOkAt: string | null;
  /** Anúncios com ficha técnica lida (placa de vídeo, gabinete, cooler); null nas outras categorias. */
  sheets: number | null;
}

/**
 * Modelo de processador ou placa de vídeo à venda (visto nas lojas nos últimos dias) que a tabela de
 * desempenho (perf.ts) não conhece: fica fora do "Identificar Gargalo" e do ranking de upgrade.
 */
export interface PerfGap {
  category: 'cpu' | 'gpu';
  /** Como o app leu o modelo do título ("RX 9050", "Ryzen 5 8400F"); vazio quando não leu nenhum. */
  model: string;
  listings: number;
  /** Um título de exemplo e a loja. */
  example: string;
  store: StoreId;
}

/**
 * Ficha técnica de um produto do catálogo: lida (com medidas ou part number), de outra loja (outro
 * anúncio do mesmo produto tem a ficha com medidas: vale para este), vazia (a página não tinha ficha),
 * ainda não lida, ou a categoria não tem ficha física (só placa de vídeo, gabinete e cooler têm).
 */
export type SheetStatus = 'ok' | 'shared' | 'empty' | 'missing' | 'na';

/** Um produto do catálogo (anúncio de uma loja) para a aba Produtos do admin. */
export interface AdminProduct {
  store: StoreId;
  sku: string;
  category: CategoryId;
  title: string;
  url: string;
  /** À vista com cupom, da última coleta. */
  price: number;
  inStock: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Specs lidas do título. */
  specs: Specs;
  /** Índice de desempenho em jogos (processador e placa de vídeo), quando a tabela conhece o modelo. */
  perf?: number;
  sheetStatus: SheetStatus;
  sheet?: SpecSheet;
  sheetAt?: string;
  /** Ficha de outro anúncio do mesmo produto (status 'shared'): de onde veio. */
  sheetFrom?: { store: StoreId; sku: string };
  /** Chave do produto (mesmo part number em todas as lojas) e quantos anúncios, nesta e nas outras lojas, são ele. */
  productKey?: string;
  siblings?: { store: StoreId; sku: string; title: string; url: string }[];
}

/** Uma página de uma tabela do admin (produtos, consultas): os itens, o total com os filtros e onde está. */
export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Itens por página nas tabelas do admin (padrão e máximo). */
export const ADMIN_PAGE_SIZE = 50;
export const ADMIN_PAGE_SIZE_MAX = 200;

export type AdminProductPage = AdminPage<AdminProduct>;

/** Filtros da lista de produtos. */
export interface AdminProductFilter {
  store?: StoreId;
  category?: CategoryId;
  sheet?: SheetStatus;
  inStock?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Andamento das fichas numa loja (produtos de placa de vídeo, gabinete e cooler vistos nos últimos 14 dias). */
export interface SheetStoreStatus {
  store: StoreId;
  name: string;
  /** A loja sabe ler a ficha da página do produto. */
  canRead: boolean;
  total: number;
  ok: number;
  /** Sem ficha própria, mas com a de outro anúncio do mesmo produto (outra loja): não precisa ler. */
  shared: number;
  empty: number;
  missing: number;
  /** Fichas lidas na última hora (rotina, montagem e admin) e a última. */
  lastHour: number;
  lastAt: string | null;
  /** Próxima ficha da rotina nesta loja (null: a rotina não está rodando nela). */
  nextAt: string | null;
}

/** Rotina de fichas: configuração e andamento por loja. */
export interface SheetRoutineStatus extends SheetRoutineSettings {
  /** Alguma loja lendo ficha agora. */
  busy: boolean;
  progress: SheetStoreStatus[];
}

/** Consultas por hora numa loja (linha do tempo de bloqueios). */
export interface TimelineBucket {
  store: StoreId;
  /** Início da hora (ISO). */
  hour: string;
  ok: number;
  blocked: number;
  other: number;
}

/** Uma busca feita no site (sem IP: `person` é um apelido que muda a cada reinício do servidor). */
export interface SearchActivity {
  at: string;
  person: string;
  category: CategoryId;
  terms: string[];
  stores: StoreId[];
  /** Tinha texto livre ("Buscar nas lojas"). */
  text: boolean;
  /** Pediu "Atualizar". */
  force: boolean;
}

/** Atividade agora: buscas recentes, conexões abertas e quem chegou a algum limite. */
export interface ActivityInfo {
  recent: SearchActivity[];
  /** Pessoas diferentes nas buscas guardadas (desde o reinício, até 500 buscas). */
  people: number;
  searchesOpen: number;
  watchesOpen: number;
  /** Pessoas no limite agora, por limite. */
  atLimit: { force: number; text: number; sheets: number; share: number };
}

/** Um arquivo em data/backups. */
export interface BackupFile {
  name: string;
  sizeMb: number;
  at: string;
}

/** O que um merge faria (ou fez): o que a fonte tem e o banco do servidor não. */
export interface MergeReport {
  newListings: number;
  newerListings: number;
  newPricePoints: number;
  newerSheets: number;
}
