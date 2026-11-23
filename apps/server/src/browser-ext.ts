/**
 * Chrome das lojas: aberto como um programa comum (sem porta de depuração,
 * sem Playwright) e quem abre as abas e lê o HTML é a extensão em apps/server/extension.
 *
 * A aba que fica sempre aberta é a página de controle da extensão. Ela pede a próxima ação
 * a uma ponte HTTP local (só 127.0.0.1, porta EXT_PORT, com token gerado a cada execução),
 * executa no Chrome e devolve o resultado. A ponte é separada do servidor do site: funciona
 * também nos comandos de terminal (pnpm scan, pnpm routine-test) e não passa pelo túnel.
 *
 * Perfil fixo por loja em <DATA_DIR>/chrome/<loja> (não é apagado): a extensão é instalada
 * uma vez em cada perfil (pnpm chrome-setup).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { StoreId } from '@upgradezin/shared';
import { config } from './config.ts';
import { sleep } from './pace.ts';

export const EXTENSION_DIR = resolve(import.meta.dirname, '../extension');

/** ID da extensão, tirado da chave fixa do manifest (o mesmo em qualquer máquina). */
export const EXTENSION_ID = (() => {
  const { key } = JSON.parse(readFileSync(join(EXTENSION_DIR, 'manifest.json'), 'utf8')) as { key: string };
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
})();

export const profileDir = (store: StoreId) => join(config.DATA_DIR, 'chrome', store);

// ----------------------------- ponte HTTP -----------------------------

const TOKEN = randomUUID();
const POLL_MS = 25_000;

interface Cmd {
  id: string;
  op: string;
  args: Record<string, unknown>;
}
interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** Ações esperando a extensão buscar, e quem está esperando a próxima ação (long poll), por loja. */
const queue = new Map<StoreId, Cmd[]>();
const waiting = new Map<StoreId, (cmd: Cmd | null) => void>();
const pending = new Map<string, Pending>();
/** Última vez que a aba de controle de cada loja falou com a ponte. */
const lastSeen = new Map<StoreId, number>();

let bridge: Server | null = null;
let bridgeReady: Promise<void> | null = null;

/** O modo extensão não tem como funcionar agora (porta ocupada, extensão não instalada): não adianta tentar o próximo termo. */
export class ExtSetupError extends Error {}

function startBridge(): Promise<void> {
  bridgeReady ??= new Promise<void>((ok, fail) => {
    bridge = createServer((req, res) => void handle(req, res));
    bridge.once('error', (err) => {
      bridgeReady = null;
      const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      fail(
        new ExtSetupError(
          inUse
            ? `A porta ${config.EXT_PORT} já está em uso: outro "pnpm dev", "pnpm scan" ou "pnpm routine-test" ainda está aberto. Feche-o (Ctrl+C no terminal dele) e rode de novo.`
            : `Ponte da extensão não abriu na porta ${config.EXT_PORT}: ${(err as Error).message}`,
        ),
      );
    });
    bridge.listen(config.EXT_PORT, '127.0.0.1', () => ok());
  });
  return bridgeReady;
}

const send = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const store = url.searchParams.get('store') as StoreId | null;
  if (url.searchParams.get('token') !== TOKEN || !store) return send(res, 401);

  // Primeira página do Chrome da loja: a extensão troca esta aba pela página de controle.
  // Se a página continuar aqui, a extensão não está instalada neste perfil.
  if (req.method === 'GET' && url.pathname === '/start') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(
      `<!doctype html><meta charset="utf-8"><title>Upgradezin ${store}</title>` +
        `<body style="font:15px system-ui;background:#111;color:#ddd;margin:32px">` +
        `<h2>Upgradezin: conectando a extensão da loja ${store}…</h2>` +
        `<p>Se esta página não mudar em alguns segundos, a extensão não está instalada <b>neste</b> Chrome ` +
        `(cada loja tem o seu). Para instalar, uma vez só, nesta janela:</p><ol>` +
        `<li>Abra uma aba nova e digite <code>chrome://extensions</code></li>` +
        `<li>Ative <b>Modo do desenvolvedor</b> (canto superior direito)</li>` +
        `<li>Clique em <b>Carregar sem compactação</b> e escolha a pasta<br><code>${EXTENSION_DIR}</code></li>` +
        `<li>Volte para esta aba e recarregue (F5)</li></ol>` +
        `<p>Ou rode <code>pnpm chrome-setup</code> com estas janelas fechadas.</p></body>`,
    );
  }
  lastSeen.set(store, Date.now());

  if (req.method === 'GET' && url.pathname === '/next') {
    const ready = queue.get(store)?.shift();
    if (ready) return send(res, 200, ready);
    // Long poll: responde quando chegar ação ou depois de POLL_MS (204, a extensão pergunta de novo).
    waiting.get(store)?.(null);
    let mine: ((c: Cmd | null) => void) | undefined;
    const cmd = await new Promise<Cmd | null>((r) => {
      const t = setTimeout(() => r(null), POLL_MS);
      mine = (c) => {
        clearTimeout(t);
        r(c);
      };
      waiting.set(store, mine);
      res.once('close', () => {
        clearTimeout(t);
        r(null);
      });
    });
    if (waiting.get(store) === mine) waiting.delete(store);
    if (res.writableEnded || res.destroyed) {
      if (cmd) queue.set(store, [cmd, ...(queue.get(store) ?? [])]); // a extensão caiu no meio: devolve à fila
      return;
    }
    return cmd ? send(res, 200, cmd) : send(res, 204);
  }

  if (req.method === 'POST' && url.pathname === '/result') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: string; ok: boolean; value?: unknown; error?: string };
    const p = pending.get(body.id);
    if (p) {
      pending.delete(body.id);
      clearTimeout(p.timer);
      if (body.ok) p.resolve(body.value);
      else p.reject(new Error(`extensão: ${body.error}`));
    }
    return send(res, 204);
  }
  send(res, 404);
}

/** Manda uma ação para a aba de controle da loja e espera o resultado. */
function call<T = any>(store: StoreId, op: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
  const cmd: Cmd = { id: randomUUID(), op, args };
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(cmd.id);
      reject(new Error(`extensão da ${store} não respondeu a "${op}" em ${timeoutMs / 1000}s`));
    }, timeoutMs);
    pending.set(cmd.id, { resolve, reject, timer });
    const w = waiting.get(store);
    if (w) {
      waiting.delete(store);
      w(cmd);
    } else queue.set(store, [...(queue.get(store) ?? []), cmd]);
  });
}

// ----------------------------- Chrome por loja -----------------------------

const procs = new Map<StoreId, ChildProcess>();
const starting = new Map<StoreId, Promise<void>>();

const connected = (store: StoreId) => Date.now() - (lastSeen.get(store) ?? 0) < POLL_MS + 5_000;

/**
 * Endereço que o Chrome da loja abre ao iniciar: a página /start da ponte, que a extensão troca
 * pela página de controle (o Chrome não abre chrome-extension:// vindo da linha de comando).
 */
function startUrl(store: StoreId): string {
  return `http://127.0.0.1:${config.EXT_PORT}/start?${new URLSearchParams({ store, token: TOKEN })}`;
}

/**
 * Argumentos do Chrome da loja, além do perfil e da extensão. Em português, como o navegador de
 * quem compra nessas lojas: --lang vale no Windows; --accept-lang é o idioma que os sites recebem
 * (navigator.languages e o cabeçalho Accept-Language) em qualquer sistema.
 */
export function chromeArgs(windowArgs: string[]): string[] {
  return ['--no-first-run', '--no-default-browser-check', '--lang=pt-BR', '--accept-lang=pt-BR,pt,en-US,en', ...windowArgs];
}

/**
 * Ambiente do Chrome da loja. No Linux, o Chrome ignora --lang e usa o idioma do sistema (no
 * serviço, inglês): sem isto, o site via um navegador em inglês com fuso de São Paulo.
 */
export function chromeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR:pt:en_US:en' };
}

/** Última vez que a extensão de cada loja não conectou: por um minuto, falha na hora (sem abrir outro Chrome). */
const failedAt = new Map<StoreId, number>();

/** Quanto esperar a extensão conectar, e depois de quanto tempo abrir outra aba de início. */
const CONNECT_MS = 30_000;
const RETRY_START_MS = 8_000;

/**
 * Abre a aba de início no Chrome da loja. Com o Chrome da loja fechado, abre o Chrome e guarda o
 * processo (para fechar no fim). Com ele já aberto, o processo novo só entrega a aba ao que está
 * rodando e sai: o guardado continua sendo o principal.
 */
function openStart(store: StoreId, windowArgs: string[]) {
  const main = procs.get(store);
  const running = !!main && main.exitCode === null;
  const dir = profileDir(store);
  mkdirSync(dir, { recursive: true });
  // --load-extension: o Chromium e o Chrome for Testing carregam a extensão sozinhos; o Chrome
  // comum ignora (nele, instalar uma vez com pnpm chrome-setup).
  const proc = spawn(config.CHROME_PATH, [`--user-data-dir=${dir}`, `--load-extension=${EXTENSION_DIR}`, ...chromeArgs(windowArgs), startUrl(store)], {
    stdio: 'ignore',
    env: chromeEnv(process.env),
  });
  if (!running) {
    procs.set(store, proc);
    proc.once('exit', () => procs.get(store) === proc && procs.delete(store));
  }
  return running;
}

export function ensureExtBrowser(store: StoreId, windowArgs: string[]): Promise<void> {
  if (connected(store)) return Promise.resolve();
  let p = starting.get(store);
  if (p) return p;
  const notConnected = () =>
    new ExtSetupError(
      `A extensão não conectou no Chrome da ${store} em ${CONNECT_MS / 1000} s. Com o Chrome comum, ela precisa ser instalada uma vez ` +
        `("pnpm chrome-setup", Carregar sem compactação: ${EXTENSION_DIR}); com o Chrome for Testing ou o Chromium, carrega sozinha.`,
    );
  if (Date.now() - (failedAt.get(store) ?? 0) < 60_000) return Promise.reject(notConnected());
  p = (async () => {
    await startBridge();
    // Chrome da loja aberto e conectado antes: nada a abrir. Fechado, ou aberto mas sem conectar
    // (a aba de início pode ter carregado antes de a extensão ficar pronta e parado lá): abre a aba.
    const main = procs.get(store);
    if (!main || main.exitCode !== null || failedAt.has(store)) openStart(store, windowArgs);
    const t0 = Date.now();
    let retried = false;
    while (Date.now() - t0 < CONNECT_MS) {
      if (connected(store)) {
        failedAt.delete(store);
        return;
      }
      // Ainda sem conectar depois de alguns segundos: outra aba de início no mesmo Chrome (a
      // extensão já está pronta, então esta não fica parada).
      if (!retried && Date.now() - t0 >= RETRY_START_MS) {
        retried = true;
        openStart(store, windowArgs);
      }
      await sleep(300);
    }
    failedAt.set(store, Date.now());
    throw notConnected();
  })().finally(() => starting.delete(store));
  starting.set(store, p);
  return p;
}

export const extBrowserOpen = (): boolean => [...lastSeen.keys()].some(connected);

/** Fecha os Chromes abertos por esta execução e a ponte. */
export async function closeExtBrowsers() {
  for (const [store, proc] of procs) {
    procs.delete(store);
    if (proc.exitCode === null) {
      const gone = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await Promise.race([gone, sleep(5000)]);
    }
  }
  lastSeen.clear();
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  for (const w of waiting.values()) w(null);
  waiting.clear();
  queue.clear();
  const b = bridge;
  bridge = null;
  bridgeReady = null;
  if (b) await new Promise<void>((r) => b.close(() => r()));
}

// ----------------------------- aba -----------------------------

/** Uma aba aberta pela extensão no Chrome da loja. */
export interface Tab {
  goto(url: string, opts?: { timeout?: number }): Promise<void>;
  /**
   * Clica no link `href` (caminho + busca, como no atributo) da página aberta e devolve os dados que o
   * site buscou para a página nova (lista paginada que troca sem recarregar). clicked: false, sem o link.
   */
  clickPage(href: string, opts?: { timeout?: number }): Promise<{ clicked: boolean; rsc: string | null; via?: 'click' | 'fetch' }>;
  title(): Promise<string>;
  currentUrl(): Promise<string>;
  content(): Promise<string>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  bringToFront(): Promise<void>;
  screenshot(opts: { path: string }): Promise<unknown>;
}

export interface OpenedTab {
  tab: Tab;
  sameWindow: boolean;
  tabsInWindow: number;
  close(): Promise<number>;
}

export async function openExtTab(store: StoreId): Promise<OpenedTab> {
  const o = await call<{ tabId: number; sameWindow: boolean; tabsInWindow: number }>(store, 'open');
  const tabId = o.tabId;
  const tab: Tab = {
    async goto(url, opts) {
      const timeout = opts?.timeout ?? 45_000;
      // Sem o código HTTP (a extensão não o vê): o bloqueio é reconhecido pelo título e pelo conteúdo.
      await call(store, 'goto', { tabId, url, timeout }, timeout + 10_000);
    },
    async clickPage(href, opts) {
      const timeout = opts?.timeout ?? 30_000;
      return call<{ clicked: boolean; rsc: string | null; via?: 'click' | 'fetch' }>(store, 'clickPage', { tabId, href, timeout }, timeout + 10_000);
    },
    title: async () => (await call<{ title: string }>(store, 'info', { tabId })).title,
    currentUrl: async () => (await call<{ url: string }>(store, 'info', { tabId })).url,
    content: async () => (await call<{ html: string }>(store, 'html', { tabId })).html,
    async waitForSelector(selector, opts) {
      const timeout = opts?.timeout ?? 30_000;
      const r = await call<{ found: boolean }>(store, 'waitFor', { tabId, selector, timeout }, timeout + 10_000);
      if (!r.found) throw new Error(`waitForSelector: "${selector}" não apareceu em ${timeout}ms`);
    },
    async bringToFront() {
      await call(store, 'focus', { tabId });
    },
    async screenshot({ path }) {
      const { png } = await call<{ png: string }>(store, 'screenshot', { tabId });
      await writeFile(path, Buffer.from(png.split(',')[1] ?? '', 'base64'));
    },
  };
  return {
    tab,
    sameWindow: o.sameWindow,
    tabsInWindow: o.tabsInWindow,
    close: async () => (await call<{ tabsInWindow: number }>(store, 'close', { tabId }, 15_000).catch(() => ({ tabsInWindow: -1 }))).tabsInWindow,
  };
}
