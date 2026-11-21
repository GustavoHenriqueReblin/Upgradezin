// Troca a aba de /start (ponte local do Upgradezin) pela página de controle, com os mesmos parâmetros.
//
// Dois caminhos, porque na inicialização do Chrome a aba de /start (vinda da linha de comando) pode
// carregar antes de a extensão registrar o start.js, e aí o script não roda nela:
// 1. o start.js avisa (mensagem "start");
// 2. ao subir, este service worker procura abas paradas em /start e troca ele mesmo.

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

async function adoptStartTabs() {
  const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/start*' }).catch(() => []);
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    const u = new URL(t.url);
    toControl(t.id, u.search, u.origin);
  }
}

chrome.runtime.onStartup.addListener(adoptStartTabs);
chrome.runtime.onInstalled.addListener(adoptStartTabs);
adoptStartTabs();
