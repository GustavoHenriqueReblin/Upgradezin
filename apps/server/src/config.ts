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
  /** "chrome" = Google Chrome instalado na máquina (padrão). Vazio = Chromium do Playwright. */
  BROWSER_CHANNEL: z.string().default('chrome'),
  /** Headless é barrado pela proteção anti-bot das lojas com navegador. No Linux sem tela, rode com xvfb-run. */
  BROWSER_HEADLESS: bool,
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
  /**
   * Lojas lentas (as que exigem navegador reconhecem consulta seguida e bloqueiam): valem para elas
   * o intervalo mínimo SLOW_MIN_GAP_S entre quaisquer duas consultas e, até o admin mudar, o modo
   * "lento" da rotina. Bloqueio pausa a loja (15 min, 1 h, 6 h, 24 h) e depois a rotina tenta de novo, sempre.
   */
  ROUTINE_SLOW_STORES: z
    .string()
    .default('s2,s3')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  /** Modo reduzido da rotina: um termo a cada tantos minutos (+ até 20% aleatório). */
  ROUTINE_REDUCED_GAP_MIN: z.coerce.number().default(5),
  /** Modo lento da rotina: um termo a cada tantos minutos (+ até 20% aleatório). */
  ROUTINE_SLOW_GAP_MIN: z.coerce.number().default(10),
  /** Texto livre pesquisado ("Buscar nas lojas" do filtro de texto): a rotina mantém o termo por estes dias depois da última busca. */
  ROUTINE_TEXT_DAYS: z.coerce.number().default(7),
  /**
   * Mínimo entre duas consultas a uma loja lenta, da rotina ou da busca do site (segundos).
   * Nos logs, elas aceitam a 1ª página e bloqueiam a seguinte quando vem segundos depois.
   */
  SLOW_MIN_GAP_S: z.coerce.number().default(180),
  /** Nos modos reduzido e lento, um termo é recoletado quando a última coleta passou disto. */
  ROUTINE_SLOW_REFRESH_H: z.coerce.number().default(24),
  /** A rotina recoleta um termo quando a última coleta dele passou disto. */
  ROUTINE_REFRESH_H: z.coerce.number().default(12),
  /** Páginas por loja por hora que a rotina pode usar (do total MAX_PAGES_PER_HOUR; o resto fica para a busca). */
  ROUTINE_PAGES_PER_HOUR: z.coerce.number().default(12),
  /** Modo normal: de quanto em quanto tempo a loja recebe uma rodada (varredura e até ROUTINE_BATCH termos). */
  ROUTINE_TICK_MIN: z.coerce.number().default(5),
  /** Termos por loja em cada rodada, no máximo. */
  ROUTINE_BATCH: z.coerce.number().default(4),
  /** Termo que falhou (bloqueio, erro) só é tentado de novo depois disto. */
  ROUTINE_RETRY_MIN: z.coerce.number().default(60),
  /**
   * Varredura de categoria (lojas com STORE_Sx_SWEEP): lê a categoria inteira da loja, página
   * por página, para todo produto à venda ter histórico (não só os que aparecem nos termos).
   * Recomeça a categoria quando a última volta completa passou disto.
   */
  ROUTINE_SWEEP_REFRESH_H: z.coerce.number().default(24),
  /** Páginas de varredura por loja por hora (saem de ROUTINE_PAGES_PER_HOUR; o resto fica para os termos). */
  ROUTINE_SWEEP_PAGES_PER_HOUR: z.coerce.number().default(6),
  /** Teto de páginas por categoria numa volta (120 itens por página na S1). */
  ROUTINE_SWEEP_MAX_PAGES: z.coerce.number().default(25),
  /** Intervalo aleatório entre páginas da MESMA loja. */
  PAGE_DELAY_MIN_MS: z.coerce.number().default(5000),
  PAGE_DELAY_MAX_MS: z.coerce.number().default(12000),
  /** Páginas por loja por hora (janela deslizante). */
  MAX_PAGES_PER_HOUR: z.coerce.number().default(30),
  /** 1 página de 120 itens por termo (termos já são específicos; a loja ordena pelos mais procurados). */
  MAX_PAGES_S1: z.coerce.number().default(1),
  /** S2 limita frequência rápido; a 1ª página já traz os itens relevantes. */
  MAX_PAGES_S2: z.coerce.number().default(1),
});

const parsed = Env.parse(process.env);
export const config = { ...parsed, DB_PATH: parsed.DB_PATH ?? resolve(parsed.DATA_DIR, 'upgradezin.db') };
