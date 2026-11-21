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
  ADMIN_PASSWORD: z.string().optional(),
  /** Duração da sessão do admin (horas); reiniciar o servidor também desloga. */
  ADMIN_SESSION_H: z.coerce.number().default(12),
  /** Salva HTML + screenshot de falhas em data/debug/ (para consertar adapters). */
  DEBUG_DUMPS: bool,
  /** Requisições à API por pessoa (IP) por minuto. */
  RATE_LIMIT_PER_MIN: z.coerce.number().default(120),
  /** "Atualizar" (consultar as lojas de novo) por pessoa por hora; além disso, vale o que está no banco. */
  FORCE_PER_HOUR: z.coerce.number().default(10),
  /** "Atualizar" não consulta a loja se o resultado do banco tem menos que isto (minutos). */
  FORCE_MIN_AGE_MIN: z.coerce.number().default(10),
  /** Fichas técnicas (páginas de produto) que uma pessoa pode pedir por hora (as já guardadas não contam). */
  SHEETS_PER_HOUR: z.coerce.number().default(30),
  /** Buscas com texto livre ("Buscar nas lojas" do filtro de texto) por pessoa por hora; além disso, só os termos do formulário. */
  TEXT_SEARCHES_PER_HOUR: z.coerce.number().default(20),
  /** Ficha técnica guardada vale isto (dias); depois a página é lida de novo. */
  SHEET_MAX_AGE_DAYS: z.coerce.number().default(30),
  /** Links de montagem novos por pessoa por hora. */
  SHARE_PER_HOUR: z.coerce.number().default(20),
  /** Telas de resultado abertas recebendo novidades ao mesmo tempo, por pessoa (abas). */
  WATCHES_PER_IP: z.coerce.number().default(4),
  /** Buscas abertas ao mesmo tempo por pessoa. */
  SEARCHES_PER_IP: z.coerce.number().default(3),
  /**
   * Toda busca do site mostra o banco na hora e atualiza por trás os termos coletados há mais
   * que isto (minutos). Menos que isso, vale o banco (não repete uma coleta de minutos atrás).
   */
  REVALIDATE_MIN: z.coerce.number().default(10),
  /**
   * A busca junta ao resultado de cada termo os anúncios da loja que o banco já tem de outras
   * coletas e batem com o termo pelas specs, se vistos há menos que isto (horas).
   */
  SEARCH_DB_MAX_AGE_H: z.coerce.number().default(72),
  /** Rotina de coleta de preços (docs/ARCHITECTURE.md §8.3). Desligada: o banco só recebe o que a busca consulta. */
  ROUTINE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== '0' && v !== 'false'),
  /** Lojas que a rotina coleta sozinha. */
  ROUTINE_STORES: z
    .string()
    .default('s1,s2,s3')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  /** Lojas que começam no modo lento até o admin escolher (as de navegador). */
  ROUTINE_SLOW_STORES: z
    .string()
    .default('s2,s3')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  /**
   * Modos da rotina (admin, aba Coleta): a cada tantos segundos (+ até 20% aleatório) a rotina faz
   * uma coisa na loja: uma página da varredura, se houver e estiver na hora, ou um termo.
   * Normal: a busca do site vai na hora. Reduzido e lento: entre duas consultas à loja, venham da
   * rotina ou da busca do site, passa no mínimo o intervalo do modo.
   */
  ROUTINE_NORMAL_GAP_S: z.coerce.number().default(15),
  ROUTINE_REDUCED_GAP_S: z.coerce.number().default(20),
  ROUTINE_SLOW_GAP_S: z.coerce.number().default(60),
  /** Texto livre pesquisado ("Buscar nas lojas" do filtro de texto): a rotina mantém o termo por estes dias depois da última busca. */
  ROUTINE_TEXT_DAYS: z.coerce.number().default(7),
  /** A rotina recoleta um termo quando a última coleta dele passou disto (horas). */
  ROUTINE_REFRESH_H: z.coerce.number().default(12),
  /** Páginas por loja por hora que a rotina pode usar (do total MAX_PAGES_PER_HOUR; o resto fica para a busca). */
  ROUTINE_PAGES_PER_HOUR: z.coerce.number().default(12),
  /** Termo que falhou (bloqueio, erro) só é tentado de novo depois disto. */
  ROUTINE_RETRY_MIN: z.coerce.number().default(60),
  /**
   * Varredura de categoria (lojas com STORE_Sx_SWEEP): lê a categoria inteira da loja, página
   * por página, para todo produto à venda ter histórico (não só os que aparecem nos termos).
   * Recomeça a categoria quando a última volta completa passou disto.
   */
  ROUTINE_SWEEP_REFRESH_H: z.coerce.number().default(24),
  /**
   * Páginas de varredura por loja por hora (saem de ROUTINE_PAGES_PER_HOUR). A varredura alterna com
   * os termos (uma vez cada), então no máximo metade das vezes da rotina vai para ela.
   */
  ROUTINE_SWEEP_PAGES_PER_HOUR: z.coerce.number().default(20),
  /** Teto de páginas por categoria numa volta (120 itens por página na S1, 36 na S2). */
  ROUTINE_SWEEP_MAX_PAGES: z.coerce.number().default(40),
  /** Intervalo aleatório entre páginas da MESMA loja. */
  PAGE_DELAY_MIN_MS: z.coerce.number().default(5000),
  PAGE_DELAY_MAX_MS: z.coerce.number().default(12000),
  /** Páginas por loja por hora (janela deslizante). */
  MAX_PAGES_PER_HOUR: z.coerce.number().default(30),
  /** 1 página de 120 itens por termo (termos já são específicos; a loja ordena pelos mais procurados). */
  MAX_PAGES_S1: z.coerce.number().default(1),
  /**
   * Páginas por termo na busca do site (abaixo do MAX_PAGES_* da loja): quem busca não espera o
   * intervalo entre páginas; as seguintes ficam para a rotina e a varredura.
   */
  SEARCH_MAX_PAGES: z.coerce.number().int().min(1).default(1),
  /** 36 itens por página na S2: até 3 páginas por termo (para antes, quando a página quase não traz itens da categoria). */
  MAX_PAGES_S2: z.coerce.number().default(3),
});

const parsed = Env.parse(process.env);
export const config = { ...parsed, DB_PATH: parsed.DB_PATH ?? resolve(parsed.DATA_DIR, 'upgradezin.db') };
