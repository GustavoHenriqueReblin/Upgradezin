import type { SheetValue, SheetValues } from './sheet/fields.ts';
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
 * Intervalo de uma loja: um tempo aleatório de `minS` a `maxS` segundos entre duas consultas. Cada loja
 * tem dois (`IntervalKind`): o de listagens (páginas de categoria, da busca e dos testes: "/fonte",
 * "/fonte?page=2"…; admin, Rotina de preços) e o de fichas (páginas de produto; admin, Rotina de fichas).
 */
export interface StoreInterval {
  minS: number;
  maxS: number;
}

export const INTERVAL_KINDS = ['list', 'sheet'] as const;
export type IntervalKind = (typeof INTERVAL_KINDS)[number];

/** Limites dos intervalos da loja no admin: de 2 segundos a 10 minutos. */
export const STORE_INTERVAL_S_MIN = 2;
export const STORE_INTERVAL_S_MAX = 600;

/** Rotina de coleta e busca ao vivo (do .env na primeira vez; depois, do admin). */
export interface RoutineSettings {
  enabled: boolean;
  stores: StoreId[];
  /** Busca ao vivo: o "Não achou? Buscar nas lojas" consulta a loja na hora. Desligada: só o banco. */
  live: Record<StoreId, boolean>;
}

/**
 * Rotina de fichas técnicas: separada da coleta (chave e lojas próprias). Lê, em cada loja, uma ficha
 * do catálogo a cada intervalo de fichas da loja.
 */
export interface SheetRoutineSettings {
  enabled: boolean;
  stores: StoreId[];
}

/** O que o admin manda para mudar a rotina de fichas (o que falta fica como está). */
export type SheetRoutineInput = Partial<SheetRoutineSettings>;

/** Varredura completa de uma loja (botão do admin e madrugada): as categorias que ela lê. O ritmo é o intervalo da loja. */
export interface FullSweepSettings {
  categories: CategoryId[];
}

/**
 * Teste do admin: uma página de categoria aberta direto (sem passar pelas anteriores). Como terminou,
 * quantos produtos vieram (e em estoque), o total de páginas da lista e o tempo.
 */
export interface ProbeResult {
  status: 'ok' | 'blocked' | 'error';
  url: string;
  count: number;
  inStock?: number;
  totalPages?: number;
  /** Como a página foi aberta: pelo clique no link dela ou pelo endereço. */
  via?: 'click' | 'url';
  detail?: string;
  ms: number;
}

/** O que o admin manda para mudar a rotina (o que falta fica como está). */
export interface RoutineInput {
  enabled: boolean;
  stores: StoreId[];
  live?: Partial<Record<StoreId, boolean>>;
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
  /** Varredura completa automática de madrugada: hora (null = desligada), próxima e última vez. */
  nightly?: { hour: number | null; nextAt: string | null; lastAt: string | null };
}

/** Situação de uma loja agora, para o painel do admin. */
export interface AdminStoreState {
  id: StoreId;
  name: string;
  enabled: boolean;
  /** Está entre as lojas da rotina. */
  inRoutine: boolean;
  /** Intervalo de listagens da loja: uma página de lista a cada `minS` a `maxS` segundos. */
  listInterval: StoreInterval;
  /** Consultada na hora pelo "Não achou? Buscar nas lojas". */
  live: boolean;
  /** Coletando para a rotina agora. */
  busy: boolean;
  /**
   * Fila da loja agora: consulta em andamento (rotina, busca do site ou admin) e quantas esperam
   * a vez. `priority`: busca por texto, "varrer agora" e ficha técnica (passam na frente); `routine`: rotina.
   */
  queue: { running: boolean; priority: number; routine: number };
  /** Varredura completa em andamento (todas as categorias, esgotados também): a categoria sendo lida e a posição dela. */
  fullSweep: { category: CategoryId; index: number; total: number } | null;
  /** Configuração da varredura completa da loja (botão e madrugada). */
  fullSweepSettings: FullSweepSettings;
  /** Categorias com página configurada na loja (as que a varredura completa pode ler). */
  sweepCategories: CategoryId[];
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
  inStock?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Andamento da rotina de fichas numa loja. */
export interface SheetStoreStatus {
  store: StoreId;
  name: string;
  /** A loja sabe ler a ficha da página do produto. */
  canRead: boolean;
  /** Páginas de produto lidas nesta loja (com e sem ficha). */
  read: number;
  /** Páginas na fila: anúncios desta loja de produtos sem ficha completa, ainda não lidos. */
  queue: number;
  /** Fichas lidas na última hora (rotina e admin) e a última. */
  lastHour: number;
  lastAt: string | null;
  /** Próxima ficha da rotina nesta loja (null: a rotina não está rodando nela). */
  nextAt: string | null;
  /** Intervalo de fichas da loja: uma página de produto a cada `minS` a `maxS` segundos. */
  interval: StoreInterval;
}

/** Rotina de fichas: configuração e andamento por loja. */
export interface SheetRoutineStatus extends SheetRoutineSettings {
  /** Alguma loja lendo ficha agora. */
  busy: boolean;
  progress: SheetStoreStatus[];
}

/**
 * Ficha de um produto: completa (todos os campos principais), incompleta (lida, mas faltam
 * principais) ou não lida (nenhuma página do produto lida ainda).
 */
export type SheetState = 'complete' | 'incomplete' | 'unread';

/** Cobertura das fichas numa categoria (produtos vistos nos últimos 14 dias). */
export interface SheetCoverageRow {
  category: CategoryId;
  name: string;
  products: number;
  complete: number;
  incomplete: number;
  unread: number;
  /** Incompletos com as páginas de todas as lojas já lidas: só a busca na web completaria. */
  exhausted: number;
  /** Desses, os que a web já foi perguntada de tudo o que falta: só uma pessoa completa. */
  needsHuman: number;
  /** Campo principal -> quantos produtos lidos ainda não o têm. */
  missing: Record<string, number>;
}

/** Um produto (os anúncios do mesmo produto nas lojas) com a ficha juntada, para a aba Fichas. */
export interface SheetProduct {
  /** Chave do produto (product_key) ou "id:<anúncio>". */
  key: string;
  category: CategoryId;
  title: string;
  state: SheetState;
  values: SheetValues;
  /** De qual página (loja + código) veio cada campo; from: do título desse anúncio, da busca na web, estimado ou o valor padrão da categoria. */
  origin: Record<string, { store: StoreId; sku: string; from?: SheetValueFrom }>;
  /** Campos principais que faltam. */
  missing: string[];
  /** Incompleta, com todas as páginas lidas e a web já perguntada de tudo o que falta: só uma pessoa completa. */
  needsHuman: boolean;
  listings: {
    store: StoreId;
    sku: string;
    title: string;
    url: string;
    inStock: boolean;
    firstSeenAt: string;
    /** A página já foi lida (e quando; hasSheet: tinha ficha). */
    read: boolean;
    at?: string;
    hasSheet?: boolean;
  }[];
}

export type SheetProductPage = AdminPage<SheetProduct>;

/** Filtros da lista de fichas (uma categoria por vez: cada uma tem seus campos). */
/** De onde veio um campo que não é da página da loja. */
export type SheetValueFrom = 'manual' | 'title' | 'web' | 'estimate' | 'default';

/** Busca na web (fichas incompletas com as páginas de todas as lojas lidas): ligada e o intervalo entre perguntas. */
export interface WebFillSettings {
  enabled: boolean;
  interval: StoreInterval;
}

export type WebFillInput = Partial<WebFillSettings>;

/** Uma pergunta feita na busca na web (o JSON da categoria para um produto) e o que voltou. */
export interface WebAnswer {
  key: string;
  category: CategoryId;
  title: string;
  /** O pedido feito à IA do buscador. */
  question: string;
  /** O JSON da resposta como veio (vazio: a página não trouxe). */
  answer: string;
  /** Cada campo do JSON e o valor aceito (sem: veio null, ou fora do tipo, das opções ou da faixa). */
  fields: { field: string; value?: SheetValue }[];
  confidence?: 'high' | 'medium' | 'low';
  /** ok: algum valor lido; none: nenhum; blocked: o buscador pediu verificação ou confirmação (nada guardado). */
  status: 'ok' | 'none' | 'blocked';
  /** Loja cujo navegador fez a pergunta. */
  store: StoreId;
  at: string;
}

export interface WebFillStatus extends WebFillSettings {
  /** Produtos na fila agora (só a web completa, com campo principal que falta ainda não perguntado). */
  queue: number;
  /** Campos perguntados: com valor lido e sem. */
  answered: number;
  empty: number;
  /** Pausa depois de o buscador pedir verificação ou confirmação (ISO), ou null. */
  pausedUntil: string | null;
  /** Por que pausou: verificação ("tráfego incomum") ou a confirmação do Modo IA para pedido vindo pelo endereço. */
  pauseReason: 'verification' | 'confirmation' | null;
  nextAt: string | null;
  busy: boolean;
}

/** Filtros da lista de produtos já perguntados na busca na web. */
export interface WebAnswerFilter {
  category?: CategoryId;
  /** ok: com algum valor aceito; none: sem nenhum. */
  status?: 'ok' | 'none';
  /** Título ou código do produto. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export type WebAnswerPage = AdminPage<WebAnswer>;

/**
 * Situação no filtro da lista: as da ficha, "só a web completa" (incompleta com a página de todas as lojas
 * lida) e "precisa de você" (só a web completa, e a web já foi perguntada de tudo o que falta).
 */
export type SheetFilterState = SheetState | 'exhausted' | 'manual';

/** Filtros da lista de fichas (uma categoria, com os campos dela, ou todas: sem category). */
export interface SheetProductFilter {
  category?: CategoryId;
  state?: SheetFilterState;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Campos preenchidos à mão no admin (produto "precisa de você"); null apaga o campo. */
export interface SheetManualInput {
  key: string;
  category: CategoryId;
  values: Record<string, string | number | boolean | null>;
}

/** Texto guardado da ficha de uma página (para conferir o que o leitor leu). */
export interface SheetPageText {
  store: StoreId;
  sku: string;
  text: string | null;
  at: string;
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
  atLimit: { force: number; text: number; share: number };
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
