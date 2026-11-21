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
  /** Página de cada categoria no site (começa com /), para a varredura da rotina. */
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

export type AttemptKind = 'term' | 'sweep' | 'sheet';
/** De onde veio a consulta: busca do site, rotina ou "coletar agora" do admin. */
export type AttemptOrigin = 'search' | 'routine' | 'admin';
/** "partial": leu parte e parou (bloqueio ou limite no meio); "limit": limite de páginas por hora. */
export type AttemptStatus = 'ok' | 'partial' | 'blocked' | 'limit' | 'error';

/** Uma consulta a uma loja (termo, página de varredura ou ficha técnica). */
export interface StoreAttempt {
  id: number;
  store: StoreId;
  /** Fim da consulta (ISO). */
  at: string;
  kind: AttemptKind;
  origin: AttemptOrigin;
  category?: CategoryId;
  /** Termo, ou o código do produto na ficha técnica. */
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
 * Ritmo da rotina numa loja: ela coleta uma coisa (um termo ou uma página da varredura) a cada
 * `seconds[modo]` (editável no admin; padrão ROUTINE_NORMAL_GAP_S / _REDUCED_ / _SLOW_). Só a
 * rotina: a busca do site vai na hora ou não vai, conforme `live` da loja.
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
  /** Busca ao vivo: a loja é consultada na hora quando alguém pesquisa no site. Desligada: a busca mostra só o banco. */
  live: Record<StoreId, boolean>;
  /** Segundos entre uma coleta da rotina e a próxima, em cada modo. */
  seconds: Record<RoutineMode, number>;
  /** Fichas técnicas do catálogo: ligada e quantas por loja por hora (dentro das vezes da rotina). */
  sheets: { enabled: boolean; perHour: number };
}

/** Limites das fichas por hora no admin. */
export const SHEETS_PER_HOUR_MAX = 60;

/** O que o admin manda para mudar a rotina (o que falta fica como está). */
export interface RoutineInput {
  enabled: boolean;
  stores: StoreId[];
  modes?: Partial<Record<StoreId, RoutineMode>>;
  live?: Partial<Record<StoreId, boolean>>;
  seconds?: Partial<Record<RoutineMode, number>>;
  sheets?: Partial<{ enabled: boolean; perHour: number }>;
}

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
  /** Consultada na hora quando alguém pesquisa no site. */
  live: boolean;
  /** Coletando para a rotina agora. */
  busy: boolean;
  /**
   * Fila da loja agora: consulta em andamento (rotina, busca do site ou admin) e quantas esperam
   * a vez. `priority`: busca do site, "coletar agora" e ficha técnica (passam na frente); `routine`: rotina.
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

/** Cobertura de uma loja numa categoria: quantos anúncios, quão frescos, quantos termos coletados. */
export interface CoverageRow {
  store: StoreId;
  category: CategoryId;
  listings: number;
  /** Anúncios vistos nas últimas 24 h e 7 dias. */
  seen24h: number;
  seen7d: number;
  /** Termos da categoria (sem a varredura) e quantos já tiveram coleta boa nessa loja. */
  terms: number;
  termsOk: number;
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
 * Ficha técnica de um produto do catálogo: lida (com medidas ou part number), vazia (a página não
 * tinha ficha), ainda não lida, ou a categoria não tem ficha física (só placa de vídeo, gabinete e cooler têm).
 */
export type SheetStatus = 'ok' | 'empty' | 'missing' | 'na';

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
}

export interface AdminProductPage {
  items: AdminProduct[];
  total: number;
  page: number;
  pageSize: number;
}

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
  empty: number;
  missing: number;
  /** Fichas lidas na última hora (rotina, montagem e admin) e a última. */
  lastHour: number;
  lastAt: string | null;
}

/** Rotina de fichas: configuração e andamento por loja. */
export interface SheetRoutineStatus {
  enabled: boolean;
  perHour: number;
  stores: SheetStoreStatus[];
}

/** Um termo da rotina, com a última coleta em cada loja. */
export interface AdminTerm {
  id: number;
  category: CategoryId;
  term: string;
  /** seed: do formulário; user: pesquisado pelo formulário; text: texto livre pesquisado. */
  origin: 'seed' | 'user' | 'text';
  createdAt: string;
  lastRequestedAt: string | null;
  runs: { store: StoreId; lastOkAt: string | null; lastTryAt: string; status: string; count: number }[];
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
  newTerms: number;
  newerRuns: number;
  newerSheets: number;
}
