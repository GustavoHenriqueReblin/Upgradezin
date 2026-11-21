// Troca a aba de /start (ponte local do Upgradezin) pela página de controle, com os mesmos parâmetros.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'start' || !sender.tab?.id) return;
  // Só aceita a ponte local.
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(msg.server)) return;
  const q = new URLSearchParams(msg.search);
  q.set('server', msg.server);
  chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL('control.html') + '?' + q.toString() });
});
