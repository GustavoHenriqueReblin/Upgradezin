import type { BlockReason, CategoryId, StoreId } from './types.ts';

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
 * Ritmo da rotina numa loja. normal: varredura das categorias e alguns termos a cada rodada;
 * reduced: um termo a cada ROUTINE_REDUCED_GAP_MIN; slow: um termo a cada ROUTINE_SLOW_GAP_MIN.
 */
export const ROUTINE_MODES = ['normal', 'reduced', 'slow'] as const;
export type RoutineMode = (typeof ROUTINE_MODES)[number];

/** Rotina de coleta: ligada, em quais lojas e o modo de cada uma (do .env na primeira vez; depois, do admin). */
export interface RoutineSettings {
  enabled: boolean;
  stores: StoreId[];
  modes: Record<StoreId, RoutineMode>;
}

/** O que o admin manda para mudar a rotina (modos que faltam ficam como estão). */
export interface RoutineInput {
  enabled: boolean;
  stores: StoreId[];
  modes?: Partial<Record<StoreId, RoutineMode>>;
}

/** Estado da rotina no admin. */
export interface RoutineInfo extends RoutineSettings {
  /** Alguma loja coletando agora. */
  busy: boolean;
  lastTickAt: string | null;
  /** A próxima vez que alguma loja da rotina consulta. */
  nextTickAt: string | null;
  /** Minutos entre rodadas de cada modo (normal: a rodada; reduzido e lento: entre um termo e outro). */
  minutes: Record<RoutineMode, number>;
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
  /** Coletando para a rotina agora. */
  busy: boolean;
  /** Loja lenta (intervalo mínimo entre consultas). */
  slow: boolean;
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
