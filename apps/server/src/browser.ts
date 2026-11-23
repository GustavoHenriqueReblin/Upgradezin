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
import { closeExtBrowsers, ensureExtBrowser, extBrowserOpen, openExtTab, type OpenedTab, type Tab } from './browser-ext.ts';
import { config } from './config.ts';
import { BlockedError, sleep } from './pace.ts';

export { ExtSetupError, type Tab } from './browser-ext.ts';

// Não minimizar: janela minimizada/escondida tem o JS desacelerado e o desafio da loja trava;
// as duas flags de desempenho evitam essa desaceleração.
const KEEP_RUNNING = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];

/**
 * Posição e tamanho da janela. Escondida: no Windows, fora da área visível (para o site é um
 * Chrome normal com janela, o usuário não vê). No Linux o servidor já roda numa tela virtual que
 * ninguém vê, então a janela fica no canto dela: uma posição como -32000 não existe num monitor de
 * verdade, e o site enxerga (window.screenX). Visível: uma loja ao lado da outra (sobrepostas),
 * para dar para acompanhar.
 */
export function windowArgs(store: StoreId, hide = config.BROWSER_HIDE_WINDOW, platform: NodeJS.Platform = process.platform): string[] {
  if (hide) return ['--window-size=1366,768', platform === 'win32' ? '--window-position=-32000,-32000' : '--window-position=0,0', ...KEEP_RUNNING];
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

type Opener = (store: StoreId) => Promise<OpenedTab>;
const realOpener: Opener = async (store) => {
  await ensureExtBrowser(store, windowArgs(store));
  openStores.add(store);
  return openExtTab(store);
};
let opener: Opener = realOpener;

/** Testes: troca a abertura de aba no Chrome (null volta ao Chrome). */
export function useTabOpener(fake: Opener | null) {
  opener = fake ?? realOpener;
}

/**
 * Abre uma aba nova no Chrome da loja, entrega para `fn` e fecha essa aba no fim (dando certo
 * ou não). A aba de controle da loja continua aberta.
 */
async function withTab<T>(store: StoreId, fn: (tab: Tab) => Promise<T>): Promise<T> {
  const t = await opener(store);
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
  /** Lista paginada lida pelo clique (keepTab): os dados que o site buscou para a página nova (o HTML continua o da página aberta antes). */
  rsc?: string;
}

export interface LoadOptions {
  signal?: AbortSignal;
  onNeedsHuman?: () => void;
  /**
   * Lista paginada (página de categoria): usa uma aba que fica aberta entre as páginas e, quando a
   * página aberta tem o link da pedida (a próxima da mesma lista), clica nele como uma pessoa: o site
   * troca a lista sem recarregar e os dados vêm em `rsc` (o pedido que o site fez), não no HTML. Sem
   * o link (primeira página, outra categoria), abre o endereço. A aba fecha sozinha depois de
   * KEPT_TAB_IDLE_MS parada, ou quando uma página dá erro.
   */
  keepTab?: boolean;
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

/** Lê a página aberta na aba (com a releitura de quem troca sozinho logo depois de abrir). */
async function readTab(store: StoreId, tab: Tab, url: string, opts: LoadOptions): Promise<LoadedPage> {
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
}

/** Aba mantida aberta por loja entre as páginas de uma lista (keepTab). */
const keptTabs = new Map<StoreId, { t: OpenedTab; timer?: NodeJS.Timeout }>();
/** Mais que o maior intervalo da varredura completa (10 min): a aba não fecha entre duas páginas dela. */
export const KEPT_TAB_IDLE_MS = 11 * 60_000;

async function closeKeptTab(store: StoreId): Promise<void> {
  const k = keptTabs.get(store);
  if (!k) return;
  keptTabs.delete(store);
  clearTimeout(k.timer);
  await k.t.close().catch(() => -1);
}

const sameSite = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

async function keptTabLoad(store: StoreId, url: string, opts: LoadOptions): Promise<LoadedPage> {
  let k = keptTabs.get(store);
  if (k) clearTimeout(k.timer);
  const current = k ? await k.t.tab.currentUrl().catch(() => '') : '';
  if (k && !current) {
    await closeKeptTab(store); // aba que sumiu (fechada à mão, Chrome reiniciado)
    k = undefined;
  }
  if (!k) {
    k = { t: await opener(store) };
    keptTabs.set(store, k);
  }
  try {
    // A próxima da mesma lista, com o link dela na página aberta: pelo clique.
    const target = new URL(url);
    const href = target.pathname + target.search;
    if (current && sameSite(current, url) && new URL(current).pathname === target.pathname) {
      await step(store, `clicando em ${href}`);
      const r = await k.t.tab.clickPage(href, { timeout: 30_000 });
      // Clicou mas a resposta não veio a tempo: abre o endereço (abaixo), sem chamar de bloqueio.
      if (r.clicked && r.rsc) {
        const page: LoadedPage = { html: '', url: await k.t.tab.currentUrl(), title: await k.t.tab.title(), rsc: r.rsc };
        if (MAINTENANCE.test(page.title)) throw new BlockedError(store, 'unavailable', `Página de manutenção: ${page.title.slice(0, 60)}`);
        keepAlive(store, k);
        return page;
      }
    }
    const page = await readTab(store, k.t.tab, url, opts);
    keepAlive(store, k);
    return page;
  } catch (err) {
    await closeKeptTab(store);
    throw err;
  }
}

function keepAlive(store: StoreId, k: { t: OpenedTab; timer?: NodeJS.Timeout }) {
  k.timer = setTimeout(() => void closeKeptTab(store), KEPT_TAB_IDLE_MS);
  k.timer.unref?.();
}

const realLoader: Loader = (store, url, opts) =>
  opts.keepTab ? keptTabLoad(store, url, opts) : withTab(store, (tab) => readTab(store, tab, url, opts));

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
  for (const store of [...keptTabs.keys()]) await closeKeptTab(store);
  openStores.clear();
  await closeExtBrowsers();
}

/** Algum Chrome de loja está aberto agora (para o status do admin). */
export const browserOpen = (): boolean => openStores.size > 0 || extBrowserOpen();
