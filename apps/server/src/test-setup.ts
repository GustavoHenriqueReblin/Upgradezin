/**
 * Lojas fictícias para os testes (domínios .example). Os testes não leem o .env
 * de quem roda (ver config.ts): as fixtures foram anonimizadas para estes valores.
 */
Object.assign(process.env, {
  STORE_S1_NAME: 'Loja S1',
  STORE_S1_URL: 'https://www.s1.example',
  STORE_S1_SEARCH: '/busca/{slug}',
  STORE_S1_CATEGORIES: 'psu:hardware/fontes,motherboard:hardware/placas-mae,cpu:hardware/processadores,gpu:hardware/placa de video (vga)/placa de video,ram:hardware/memoria ram',
  // Varredura: caminho fora do site (sem / ou com outra origem) e categoria desconhecida são ignorados.
  STORE_S1_SWEEP: 'cpu:/hardware/processadores,psu:/hardware/fontes,ram:https://outro.example/x,gpu:hardware/vga,xyz:/a',
  STORE_S2_NAME: 'Loja S2',
  STORE_S2_URL: 'https://www.s2.example',
  STORE_S2_SEARCH: '/search?q={q}',
  STORE_S2_CATEGORIES: 'psu:hardware/fonte,motherboard:hardware/placa-mae,cpu:hardware/processadores',
  STORE_S3_NAME: 'Loja S3',
  STORE_S3_URL: 'https://www.s3.example',
  STORE_S3_SEARCH: '/busca?str={q+}',
  STORE_S3_SWEEP: 'cpu:/hardware/processadores',
  // Cor sem # (no .env, # sem aspas é comentário) e uma inválida.
  STORE_S1_COLOR: 'ff6500',
  STORE_S2_COLOR: 'vermelho',
  // Intervalo entre consultas da mesma loja: curto nos testes.
  PAGE_DELAY_MIN_MS: '1',
  PAGE_DELAY_MAX_MS: '2',
  // Banco do servidor (getDb) em memória: teste nenhum toca no data/upgradezin.db de quem roda.
  DB_PATH: ':memory:',
});
