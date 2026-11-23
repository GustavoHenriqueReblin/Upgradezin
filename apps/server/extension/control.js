// Aba de controle (fica sempre aberta). Pede ao Upgradezin local a próxima ação, executa no
// Chrome pelas APIs de extensão (tabs, scripting) e devolve o resultado. Sem porta de depuração:
// para a loja, as abas são de um Chrome comum.
//
// URL: control.html?store=s2&server=http://127.0.0.1:8788&token=…

const params = new URLSearchParams(location.search);
const store = params.get('store');
const server = params.get('server');
const token = params.get('token');
document.getElementById('store').textContent = store ?? '?';
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

function log(msg) {
  const line = `${new Date().toLocaleTimeString('pt-BR')} ${msg}\n`;
  logEl.textContent = (line + logEl.textContent).slice(0, 8000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path) => `${server}/${path}?store=${encodeURIComponent(store)}&token=${encodeURIComponent(token)}`;

/** Estado da aba que o servidor acompanha (endereço e título atuais). */
async function info(tabId) {
  const t = await chrome.tabs.get(tabId);
  return { url: t.url ?? t.pendingUrl ?? '', title: t.title ?? '' };
}

/**
 * Espera o documento novo da aba ficar pronto (HTML lido: readyState "interactive" ou "complete")
 * ou o tempo acabar. Não espera o "complete" da aba: há loja (S1) cuja página nunca termina de
 * carregar para o Chrome (anúncios e rastreadores puxando sem parar), e os dados já estão no HTML.
 * Quem precisa de algo que o script da página monta depois espera com waitFor.
 */
async function waitReady(tabId, timeout) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return false;
    if (t.status === 'complete' && t.url && t.url !== 'about:blank') return true;
    const ready = await inPage(tabId, () => location.href !== 'about:blank' && document.readyState !== 'loading').catch(() => false);
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

async function inPage(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
}

const ops = {
  /** Aba nova na janela desta aba de controle (nunca janela nova). */
  async open() {
    const me = await chrome.tabs.getCurrent();
    const tab = await chrome.tabs.create({ windowId: me.windowId, url: 'about:blank', active: true });
    const tabs = await chrome.tabs.query({ windowId: me.windowId });
    return { tabId: tab.id, sameWindow: tab.windowId === me.windowId, tabsInWindow: tabs.length, url: 'about:blank', title: '' };
  },
  async goto({ tabId, url, timeout }) {
    await chrome.tabs.update(tabId, { url });
    // Espera o carregamento começar antes de esperar o documento novo (senão pega o da aba anterior).
    for (let i = 0; i < 20; i++) {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'loading' || (t.url && t.url !== 'about:blank')) break;
      await sleep(100);
    }
    const loaded = await waitReady(tabId, timeout);
    return { loaded, ...(await info(tabId)) };
  },
  /**
   * Próxima página de uma lista paginada, pelo clique no link dela (como uma pessoa): o site troca a
   * lista sem recarregar, buscando os dados da página nova em segundo plano (pedido "?page=N&_rsc=…"
   * do Next.js). Antes do clique, instala na página uma escuta que guarda a resposta desse pedido e a
   * devolve. O site já tinha os dados guardados (pré-carregou o link) e não pediu: faz o mesmo pedido
   * da página, com o cabeçalho RSC. Sem o link na página: { clicked: false }.
   */
  async clickPage({ tabId, href, timeout }) {
    const main = async (func, args = []) => {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
      return r?.result;
    };
    const clicked = await main((h) => {
      if (!window.__uzFetchHooked) {
        window.__uzFetchHooked = true;
        const orig = window.fetch;
        window.fetch = async function (...a) {
          const res = await orig.apply(this, a);
          try {
            const u = new URL(typeof a[0] === 'string' ? a[0] : a[0].url, location.href);
            if (u.searchParams.has('_rsc')) {
              u.searchParams.delete('_rsc');
              const key = u.pathname + u.search;
              res.clone().text().then((text) => { window.__uzRsc = { key, text }; }).catch(() => {});
            }
          } catch {}
          return res;
        };
      }
      window.__uzRsc = null;
      const link = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === h);
      if (!link) return false;
      link.scrollIntoView({ block: 'center' });
      link.click();
      return true;
    }, [href]);
    if (!clicked) return { clicked: false, ...(await info(tabId)) };
    const until = Date.now() + timeout;
    let rsc = null;
    let via = 'click';
    while (Date.now() < until) {
      const got = await main((h) => (window.__uzRsc && window.__uzRsc.key === h ? window.__uzRsc.text : null), [href]).catch(() => null);
      if (got) { rsc = got; break; }
      // Já está na página nova e nada foi pedido (dados pré-carregados): pede igual ao site.
      const here = await main(() => location.pathname + location.search).catch(() => '');
      if (here === href && Date.now() > until - timeout + 4000) {
        rsc = await main(async (h) => (await fetch(h, { headers: { RSC: '1' } })).text(), [href]).catch(() => null);
        via = 'fetch';
        break;
      }
      await sleep(200);
    }
    return { clicked: true, via, rsc, ...(await info(tabId)) };
  },
  async info({ tabId }) {
    return info(tabId);
  },
  async html({ tabId }) {
    const html = await inPage(tabId, () => (document.doctype ? '<!DOCTYPE html>' : '') + document.documentElement.outerHTML);
    return { html, ...(await info(tabId)) };
  },
  async waitFor({ tabId, selector, timeout }) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await inPage(tabId, (s) => !!document.querySelector(s), [selector]).catch(() => false)) return { found: true, ...(await info(tabId)) };
      await sleep(250);
    }
    return { found: false, ...(await info(tabId)) };
  },
  async focus({ tabId }) {
    const t = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    return info(tabId);
  },
  async screenshot({ tabId }) {
    const t = await chrome.tabs.get(tabId);
    return { png: await chrome.tabs.captureVisibleTab(t.windowId, { format: 'png' }) };
  },
  async close({ tabId }) {
    await chrome.tabs.remove(tabId).catch(() => {});
    const me = await chrome.tabs.getCurrent();
    return { tabsInWindow: (await chrome.tabs.query({ windowId: me.windowId })).length };
  },
};

async function loop() {
  if (!store || !server || !token) {
    statusEl.textContent = 'faltam parâmetros na URL (store, server, token)';
    return;
  }
  for (;;) {
    let cmd;
    try {
      const r = await fetch(api('next'), { cache: 'no-store' });
      if (r.status === 401) {
        // Token de outra execução do servidor (reiniciou): esta aba ficou velha e se fecha;
        // a execução nova abre a sua própria aba de controle.
        statusEl.textContent = 'sessão encerrada (o servidor reiniciou)';
        const me = await chrome.tabs.getCurrent();
        if (me?.id) await chrome.tabs.remove(me.id).catch(() => {});
        return;
      }
      if (r.status === 204) {
        statusEl.textContent = 'conectado, esperando busca';
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      cmd = await r.json();
    } catch (err) {
      statusEl.textContent = `servidor fora do ar (${err.message}); tentando de novo…`;
      await sleep(2000);
      continue;
    }
    statusEl.textContent = `executando: ${cmd.op}`;
    let body;
    try {
      body = { id: cmd.id, ok: true, value: await ops[cmd.op](cmd.args ?? {}) };
      log(`${cmd.op}${cmd.args?.url ? ' ' + cmd.args.url : ''} ok`);
    } catch (err) {
      body = { id: cmd.id, ok: false, error: String(err?.message ?? err) };
      log(`${cmd.op} ERRO ${body.error}`);
    }
    await fetch(api('result'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }
}

loop();
