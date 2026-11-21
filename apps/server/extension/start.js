// Roda só em http://127.0.0.1:<porta>/start?store=…&token=… (a página que o Upgradezin manda o
// Chrome abrir). Pede ao service worker para trocar esta aba pela página de controle da extensão.
// O Chrome não abre chrome-extension:// vindo da linha de comando; por isso este desvio.
chrome.runtime.sendMessage({ type: 'start', search: location.search, server: location.origin });
