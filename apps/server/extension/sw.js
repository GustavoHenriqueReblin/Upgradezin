// Troca a aba de /start (ponte local do Upgradezin) pela página de controle, com os mesmos parâmetros.
//
// Três caminhos, porque na inicialização do Chrome a aba de /start (vinda da linha de comando) pode
// carregar antes de a extensão registrar o start.js (e aí o script não roda nela), e o service
// worker pode subir antes de a aba ter o endereço /start (e aí a procura não a acha):
// 1. o start.js avisa (mensagem "start");
// 2. toda aba que termina de carregar /start é trocada (evento do Chrome: acorda este worker);
// 3. ao subir, este worker procura abas que já estão paradas em /start.

const LOCAL = /^http:\/\/127\.0\.0\.1:\d+$/;

function toControl(tabId, search, server) {
  if (!LOCAL.test(server)) return; // só a ponte local
  const q = new URLSearchParams(search);
  q.set('server', server);
  const url = chrome.runtime.getURL('control.html') + '?' + q.toString();
  chrome.tabs.get(tabId).then((t) => {
    if (!(t.url ?? '').startsWith(chrome.runtime.getURL('control.html'))) chrome.tabs.update(tabId, { url });
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'start' && sender.tab?.id) toControl(sender.tab.id, msg.search, msg.server);
});

/** Aba em /start da ponte local: troca pela página de controle. */
function adoptIfStart(tab) {
  if (!tab?.id || !tab.url) return;
  let u;
  try {
    u = new URL(tab.url);
  } catch {
    return;
  }
  if (u.pathname === '/start' && LOCAL.test(u.origin)) toControl(tab.id, u.search, u.origin);
}

chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.status === 'complete' || change.url) adoptIfStart(tab);
});

async function adoptStartTabs() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) adoptIfStart(t);
}

chrome.runtime.onStartup.addListener(adoptStartTabs);
chrome.runtime.onInstalled.addListener(adoptStartTabs);
adoptStartTabs();
