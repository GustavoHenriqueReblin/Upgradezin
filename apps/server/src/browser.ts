/**
 * Como o Upgradezin lê as lojas: todas do mesmo jeito.
 *
 * Um Chrome comum por loja (sem porta de depuração, sem Playwright), com perfil fixo em
 * data/chrome/<loja>. A extensão em apps/server/extension abre cada página numa aba nova, espera
 * carregar, devolve o HTML e fecha a aba; a aba de controle da extensão fica sempre aberta.
 * Detalhes da extensão e da ponte local: browser-ext.ts.
 *
 * Os adapters só montam a URL e interpretam o HTML: loadPage() é o único caminho até a loja.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoreId } from '@upgradezin/shared';
import { closeExtBrowsers, ensureExtBrowser, extBrowserOpen, openExtTab, type Tab } from './browser-ext.ts';
import { config } from './config.ts';
import { BlockedError, sleep } from './pace.ts';

export { ExtSetupError, type Tab } from './browser-ext.ts';

// Janela fora da área visível: para o site é um Chrome normal com janela, o usuário não vê.
// Não minimizar: janela minimizada/escondida tem o JS desacelerado e o desafio da loja trava;
// as duas flags de desempenho evitam essa desaceleração.
const HIDE_ARGS = ['--window-position=-32000,-32000', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];

/**
 * Posição e tamanho da janela. Escondida: fora da tela. Visível: uma loja ao lado da outra
 * (sobrepostas), para dar para acompanhar.
 */
function windowArgs(store: StoreId): string[] {
  if (config.BROWSER_HIDE_WINDOW) return ['--window-size=1366,768', ...HIDE_ARGS];
  const x = { s1: 0, s2: 450, s3: 900 }[store] ?? 0;
  return ['--window-size=1000,800', `--window-position=${x},0`];
}

/** BROWSER_STEP_MS: escreve o passo no terminal e espera, para dar para acompanhar na janela. */
async function step(store: StoreId, msg: string) {
  if (!config.BROWSER_STEP_MS) return;
  console.info(`  [${store}] ${msg}`);
  await sleep(config.BROWSER_STEP_MS);
}

/** Lojas cujo Chrome esta execução já abriu (para o status do admin). */
const openStores = new Set<StoreId>();

/**
 * Abre uma aba nova no Chrome da loja, entrega para `fn` e fecha essa aba no fim (dando certo
 * ou não). A aba de controle da loja continua aberta.
 */
async function withTab<T>(store: StoreId, fn: (tab: Tab) => Promise<T>): Promise<T> {
  await ensureExtBrowser(store, windowArgs(store));
  openStores.add(store);
  const t = await openExtTab(store);
  await step(store, `aba nova aberta ${t.sameWindow ? 'na mesma janela da aba de controle' : 'JANELA DIFERENTE'}; ${t.tabsInWindow} abas na janela`);
  try {
    const out = await fn(t.tab);
    await step(store, 'dados lidos; fechando a aba');
    return out;
  } finally {
    const left = await t.close();
    await step(store, `aba fechada; ${left} aba(s) aberta(s)`);
  }
}

const CHALLENGE = /um momento|just a moment|attention required|verifique que voc|verify you are human/i;
const MAINTENANCE = /manuten[cç][aã]o|maintenance/i;

/**
 * Navega e espera um eventual desafio da Cloudflare se resolver sozinho
 * (o navegador real só executa o JavaScript da página).
 *
 * Se o desafio pedir interação ("Confirme que é humano"), a busca espera uma pessoa resolver
 * na janela por MANUAL_CHALLENGE_WAIT_S (modo assistido). Nada é clicado automaticamente.
 * Sem resolução: BlockedError.
 */
async function gotoChecked(tab: Tab, store: StoreId, url: string, signal?: AbortSignal, onNeedsHuman?: () => void) {
  await step(store, `abrindo ${url}`);
  await tab.goto(url, { timeout: 45_000 });
  let title = await tab.title().catch(() => '');
  await step(store, `página carregada: "${title.slice(0, 60)}"`);
  const autoUntil = Date.now() + 15_000;
  const manualMs = config.MANUAL_CHALLENGE_WAIT_S * 1000;
  let asked = false;
  while (CHALLENGE.test(title) && Date.now() < autoUntil + manualMs) {
    if (!asked && Date.now() >= autoUntil && manualMs > 0) {
      asked = true;
      await tab.bringToFront().catch(() => {});
      onNeedsHuman?.();
    }
    await sleep(1000, signal);
    title = await tab.title().catch(() => '');
  }
  if (CHALLENGE.test(title)) {
    await saveDebug(store, tab, 'blocked');
    throw new BlockedError(store, 'needs-human', 'Verificação anti-bot não resolvida');
  }
  // Há loja que devolve uma página de "manutenção" tanto em manutenção real quanto ao limitar acesso.
  if (MAINTENANCE.test(title)) throw new BlockedError(store, 'unavailable', `Página de manutenção: ${title.slice(0, 60)}`);
  return { title };
}

/** Página lida: o HTML, o endereço final (depois de redirecionamentos) e o título. */
export interface LoadedPage {
  html: string;
  url: string;
  title: string;
}

export interface LoadOptions {
  signal?: AbortSignal;
  onNeedsHuman?: () => void;
  /** Espera este seletor aparecer (até 15 s) antes de ler; sem ele, lê assim que a página carrega. */
  waitFor?: string;
  /**
   * Página que pode trocar sozinha logo depois de abrir (redirecionamento por script): se
   * `recheck` disser que sim, espera `recheckMs` e lê de novo.
   */
  recheck?: (page: LoadedPage) => boolean;
  recheckMs?: number;
}

/** Erro ao abrir a página, com o endereço em que a aba estava (para reconhecer redirecionamento). */
export type PageError = Error & { finalUrl?: string };

type Loader = (store: StoreId, url: string, opts: LoadOptions) => Promise<LoadedPage>;

const realLoader: Loader = (store, url, opts) =>
  withTab(store, async (tab) => {
    try {
      await gotoChecked(tab, store, url, opts.signal, opts.onNeedsHuman);
    } catch (err) {
      throw Object.assign(err as object, { finalUrl: await tab.currentUrl().catch(() => undefined) });
    }
    if (opts.waitFor) await tab.waitForSelector(opts.waitFor, { timeout: 15_000 }).catch(() => {});
    const read = async (): Promise<LoadedPage> => ({ html: await tab.content(), url: await tab.currentUrl(), title: await tab.title() });
    let page = await read();
    if (opts.recheck?.(page)) {
      await sleep(opts.recheckMs ?? 2000, opts.signal);
      page = await read();
    }
    if (config.DEBUG_DUMPS && !page.html) await saveDebug(store, tab, 'empty');
    return page;
  });

let loader: Loader = realLoader;

/** Abre a página na loja (aba nova no Chrome dela), lê e fecha a aba. Único caminho até as lojas. */
/** Última página lida em cada loja (uma por loja: a fila da loja lê uma página por vez). */
const lastPages = new Map<StoreId, LoadedPage>();

export async function loadPage(store: StoreId, url: string, opts: LoadOptions = {}): Promise<LoadedPage> {
  const page = await loader(store, url, opts);
  lastPages.set(store, page);
  return page;
}

/**
 * HTML inteiro da última página lida na loja. Dentro da vez da loja (withStore), é a página que
 * a consulta acabou de abrir: a ficha guarda a página quando vem vazia (DEBUG_DUMPS).
 */
export const lastPageHtml = (store: StoreId): string | undefined => lastPages.get(store)?.html;

/** Testes: troca o Chrome por uma função que devolve a página (null volta ao Chrome). */
export function usePageLoader(fake: Loader | null) {
  loader = fake ?? realLoader;
}

const debugBase = async (store: StoreId, tag: string) => {
  const dir = join(config.DATA_DIR, 'debug');
  await mkdir(dir, { recursive: true });
  return join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${store}-${tag}`);
};

/** Salva HTML + screenshot da aba em data/debug/ para depurar extração. Só com DEBUG_DUMPS. */
async function saveDebug(store: StoreId, tab: Tab, tag: string) {
  if (!config.DEBUG_DUMPS) return;
  const base = await debugBase(store, tag);
  await writeFile(`${base}.html`, await tab.content().catch(() => '')).catch(() => {});
  await tab.screenshot({ path: `${base}.png` }).catch(() => {});
  console.error(`[${store}] debug salvo em ${base}.html`);
}

/** Salva só o HTML (página já lida) em data/debug/. Só com DEBUG_DUMPS. */
export async function saveDebugHtml(store: StoreId, html: string, tag: string) {
  if (!config.DEBUG_DUMPS) return;
  const base = await debugBase(store, tag);
  await writeFile(`${base}.html`, html).catch(() => {});
  console.error(`[${store}] debug salvo em ${base}.html`);
}

/** Fecha o Chrome de todas as lojas (ao desligar o servidor ou no fim de um comando de terminal). */
export async function closeBrowser() {
  openStores.clear();
  await closeExtBrowsers();
}

/** Algum Chrome de loja está aberto agora (para o status do admin). */
export const browserOpen = (): boolean => openStores.size > 0 || extBrowserOpen();
