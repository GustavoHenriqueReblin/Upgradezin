import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { StoreId } from '@upgradezin/shared';
import { config } from './config.ts';
import { BlockedError, sleep } from './pace.ts';

let browserPromise: Promise<Browser> | null = null;
let browser: Browser | null = null;

/**
 * O Chrome instalado na máquina, sem perfil em disco. Sem plugins de stealth,
 * sem fingerprint ou user-agent falsos.
 */
function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium
    .launch({
      channel: config.BROWSER_CHANNEL || undefined,
      headless: config.BROWSER_HEADLESS,
      // Janela fora da área visível: para o site é um Chrome normal com janela, o usuário não vê.
      // Não minimizar: janela minimizada/escondida tem o JS desacelerado e o desafio da loja trava;
      // as duas flags de desempenho evitam essa desaceleração.
      args: config.BROWSER_HIDE_WINDOW
        ? ['--window-position=-32000,-32000', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows']
        : [],
    })
    .then((b) => {
      browser = b;
      b.on('disconnected', () => {
        browser = null;
        browserPromise = null;
        tabs.clear();
      });
      return b;
    })
    .catch((err) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

/**
 * Uma janela anônima por loja (contexto próprio: cookies e cache isolados, tudo
 * descartado ao fechar), com uma aba só. As lojas rodam em paralelo, cada uma na
 * própria janela em primeiro plano (aba de fundo seria desacelerada pelo Chrome);
 * dentro da loja, nunca há duas requisições simultâneas.
 */
const tabs = new Map<StoreId, Promise<Page>>();

export async function getTab(store: StoreId): Promise<Page> {
  let p = tabs.get(store);
  if (p) {
    const page = await p.catch(() => null);
    if (page && !page.isClosed()) return page;
  }
  p = getBrowser().then(async (b) => {
    const ctx: BrowserContext = await b.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1366, height: 768 } });
    // tsx/esbuild injeta __name() nas funções passadas a page.evaluate; define no-op na página.
    await ctx.addInitScript('globalThis.__name = (f) => f');
    // Sem interceptar rede (page.route): isso quebra o desafio da Cloudflare.
    const page = await ctx.newPage();
    page.on('close', () => tabs.delete(store));
    return page;
  });
  tabs.set(store, p);
  return p;
}

const CHALLENGE = /um momento|just a moment|attention required|verifique que voc|verify you are human/i;
const MAINTENANCE = /manuten[cç][aã]o|maintenance/i;

/**
 * Navega e espera um eventual desafio da Cloudflare se resolver sozinho
 * (o navegador real só executa o JavaScript da página).
 *
 * Se o desafio pedir interação ("Confirme que é humano") e o navegador estiver
 * visível, a busca espera uma pessoa resolver na janela (modo assistido).
 * Nada é clicado automaticamente. Sem resolução: BlockedError e backoff.
 */
export async function gotoChecked(
  page: Page,
  store: StoreId,
  url: string,
  signal?: AbortSignal,
  onNeedsHuman?: () => void,
) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  let title = await page.title().catch(() => '');
  const autoUntil = Date.now() + 15_000;
  const manualMs = config.BROWSER_HEADLESS ? 0 : config.MANUAL_CHALLENGE_WAIT_S * 1000;
  let asked = false;
  while (CHALLENGE.test(title) && Date.now() < autoUntil + manualMs) {
    if (!asked && Date.now() >= autoUntil && manualMs > 0) {
      asked = true;
      await page.bringToFront().catch(() => {});
      onNeedsHuman?.();
    }
    await sleep(1000, signal);
    title = await page.title().catch(() => '');
  }
  if (CHALLENGE.test(title)) {
    await saveDebug(store, page, 'blocked');
    throw new BlockedError(store, 'needs-human', 'Verificação anti-bot não resolvida');
  }
  // Há loja que devolve uma página de "manutenção" tanto em manutenção real quanto ao limitar acesso.
  if (MAINTENANCE.test(title)) throw new BlockedError(store, 'unavailable', `Página de manutenção: ${title.slice(0, 60)}`);
  const status = resp?.status() ?? 0;
  if (status === 429) throw new BlockedError(store, 'too-many-requests', 'HTTP 429');
  return { status, title };
}

/** Salva HTML + screenshot em data/debug/ para depurar extração. Só com DEBUG_DUMPS=1. */
export async function saveDebug(store: StoreId, page: Page, tag: string) {
  if (!config.DEBUG_DUMPS) return;
  const dir = join(config.DATA_DIR, 'debug');
  await mkdir(dir, { recursive: true });
  const base = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${store}-${tag}`);
  await writeFile(`${base}.html`, await page.content()).catch(() => {});
  await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
  console.error(`[${store}] debug salvo em ${base}.html`);
}

export async function closeBrowser() {
  browserPromise = null;
  tabs.clear();
  const b = browser;
  browser = null;
  if (b) await b.close().catch(() => {});
}

/** O Chrome está aberto agora (para o status do admin). */
export const browserOpen = (): boolean => browser !== null;
