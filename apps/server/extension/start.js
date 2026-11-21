// Roda só em http://127.0.0.1:<porta>/start?store=…&token=… (a página que o Upgradezin manda o
// Chrome abrir). Pede ao service worker para trocar esta aba pela página de controle da extensão.
// O Chrome não abre chrome-extension:// vindo da linha de comando; por isso este desvio.
// Logo depois de o Chrome abrir, o service worker pode ainda não estar pronto: tenta de novo a cada
// 0,5 s (a aba sai desta página quando a troca acontece, e o script para junto).
let tries = 0;
(function ask() {
  chrome.runtime.sendMessage({ type: 'start', search: location.search, server: location.origin }).catch(() => {});
  if (++tries < 40) setTimeout(ask, 500);
})();
