import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Raiz do repositório (apps/server/src -> ../../..). */
export const ROOT = resolve(import.meta.dirname, '../../..');

// Nos testes, só os valores definidos em test-setup.ts (sem depender do .env de quem roda).
const envFile = resolve(ROOT, '.env');
if (!process.env.VITEST && existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const Env = z.object({
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('127.0.0.1'),
  /**
   * Chrome das lojas (um por loja, sem porta de depuração; a extensão em apps/server/extension
   * abre as abas e lê o HTML). Padrão: o Google Chrome instalado. No Linux sem tela, rode com xvfb-run.
   * Com Chromium (ou Chrome for Testing) a extensão carrega sozinha; com o Chrome comum, instale
   * uma vez por loja (pnpm chrome-setup).
   */
  CHROME_PATH: z
    .string()
    .default(process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome'),
  /** Abre a janela do Chrome fora da área visível da tela (padrão: sim). */
  BROWSER_HIDE_WINDOW: z
    .string()
    .optional()
    .transform((v) => v !== '0' && v !== 'false'),
  /**
   * Segundos esperando alguém resolver uma verificação interativa NA MÁQUINA DO SERVIDOR.
   * Só faz sentido para quem opera o servidor; o usuário final não vê essa janela. Padrão: 0.
   */
  MANUAL_CHALLENGE_WAIT_S: z.coerce.number().default(0),
  /**
   * Porta local (só 127.0.0.1) por onde a extensão do Chrome recebe as ações e devolve o HTML.
   * Separada do servidor do site (não passa pelo túnel).
   */
  EXT_PORT: z.coerce.number().default(8788),
  /** Espera (ms) a cada passo no navegador (abrir aba, navegar, ler, fechar), com o passo no terminal. 0 = sem espera. */
  BROWSER_STEP_MS: z.coerce.number().default(0),
  /**
   * Pausa automática da loja depois de um bloqueio (15 min, 1 h, 6 h, 24 h). Padrão: ligada.
   * false = bloqueio só é registrado no log; a próxima busca vai à loja normalmente.
   * A pausa manual do admin continua valendo.
   */
  BACKOFF_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== '0' && v !== 'false'),
  DATA_DIR: z.string().default(resolve(ROOT, 'data')),
  /** Banco SQLite local (anúncios, histórico de preço, montagens compartilhadas). Padrão: <DATA_DIR>/upgradezin.db. */
  DB_PATH: z.string().optional(),
  /**
   * Admin em /admin: usuário e senha fixos. Sem os dois (ou com senha de menos de 10 caracteres),
   * o admin fica desligado e /api/admin responde 404.
   */
  ADMIN_USER: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  /** Duração da sessão do admin (horas); reiniciar o servidor também desloga. */
  ADMIN_SESSION_H: z.coerce.number().default(12),
  /** Salva HTML + screenshot de falhas em data/debug/ (para consertar adapters). */
  DEBUG_DUMPS: bool,
  /** Requisições à API por pessoa (IP) por minuto. */
  RATE_LIMIT_PER_MIN: z.coerce.number().default(120),
  /** "Atualizar" (buscar o texto livre nas lojas de novo) por pessoa por hora; além disso, vale o que está no banco. */
  FORCE_PER_HOUR: z.coerce.number().default(10),
  /** "Atualizar" não busca o texto de novo na loja se a última busca dele tem menos que isto (minutos). */
  FORCE_MIN_AGE_MIN: z.coerce.number().default(10),
  /** Buscas com texto livre ("Não achou? Buscar nas lojas") por pessoa por hora; além disso, só os termos do formulário (banco). */
  TEXT_SEARCHES_PER_HOUR: z.coerce.number().default(20),
  /** Links de montagem novos por pessoa por hora. */
  SHARE_PER_HOUR: z.coerce.number().default(20),
  /** Telas de resultado abertas recebendo novidades ao mesmo tempo, por pessoa (abas). */
  WATCHES_PER_IP: z.coerce.number().default(4),
  /** Buscas abertas ao mesmo tempo por pessoa. */
  SEARCHES_PER_IP: z.coerce.number().default(3),
  /** O mesmo texto livre só vai de novo à mesma loja depois disto (minutos); antes, vale o banco. */
  REVALIDATE_MIN: z.coerce.number().default(10),
  /** A busca do site mostra os anúncios do banco vistos há menos que isto (horas). */
  SEARCH_DB_MAX_AGE_H: z.coerce.number().default(72),
  /** Rotina de preços (docs/ARCHITECTURE.md §8.2): lê as páginas de categoria das lojas. Desligada: o banco só recebe o que a busca por texto trouxer. */
  ROUTINE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== '0' && v !== 'false'),
  /** Lojas que a rotina lê sozinha. */
  ROUTINE_STORES: z
    .string()
    .default('s1,s2,s3')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  /** A rotina lê uma categoria de novo quando a última volta completa por ela passou disto (horas). */
  ROUTINE_REFRESH_H: z.coerce.number().default(12),
  /** Páginas por loja por hora que a rotina pode usar (do total MAX_PAGES_PER_HOUR; o resto fica para a busca por texto e as fichas). */
  ROUTINE_PAGES_PER_HOUR: z.coerce.number().default(12),
  /** Categoria cuja página falhou (erro que não é bloqueio) só é tentada de novo depois disto. */
  ROUTINE_RETRY_MIN: z.coerce.number().default(60),
  /**
   * Rotina de fichas técnicas (separada da coleta): abre, em cada loja, uma página de produto do
   * catálogo (todas as categorias) a cada intervalo de fichas da loja (admin). Cada página é lida uma
   * vez. Valores iniciais: depois, vale o que o admin (aba Fichas) guardar.
   */
  SHEET_ROUTINE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  /** Hora (0-23, horário do servidor) da varredura completa automática de madrugada, antes do backup do cron (04:30). -1 desliga. */
  NIGHTLY_SWEEP_HOUR: z.coerce.number().int().min(-1).max(23).default(1),
  /** Teto de páginas por caminho de categoria numa volta (120 itens por página na S1, 36 na S2, ~150 na S3). */
  ROUTINE_SWEEP_MAX_PAGES: z.coerce.number().default(40),
  /** Páginas por loja por hora (janela deslizante). */
  MAX_PAGES_PER_HOUR: z.coerce.number().default(30),
  /** Busca por texto na S1: 1 página de 120 itens (a loja ordena pelos mais procurados). */
  MAX_PAGES_S1: z.coerce.number().default(1),
  /** Páginas por texto na busca do site (abaixo do MAX_PAGES_* da loja): quem busca não espera o intervalo entre páginas. */
  SEARCH_MAX_PAGES: z.coerce.number().int().min(1).default(1),
  /** Busca por texto na S2 (36 itens por página): até 3 páginas (para antes, quando a página quase não traz itens da categoria). */
  MAX_PAGES_S2: z.coerce.number().default(3),
});

const parsed = Env.parse(process.env);
export const config = { ...parsed, DB_PATH: parsed.DB_PATH ?? resolve(parsed.DATA_DIR, 'upgradezin.db') };
