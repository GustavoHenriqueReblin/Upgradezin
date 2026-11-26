export const ACTIVITY_SCREENS = {
  home: 'Início',
  search: 'Busca',
  results: 'Resultados da busca',
  product: 'Produto',
  build: 'Montagem',
  shared: 'Montagem compartilhada',
  compare: 'Comparador',
  pc: 'Meu PC e gargalo',
  myPc: 'Meu PC',
  importPc: 'Importar PC',
  prices: 'Histórico de preços',
  budget: 'Orçamento',
  account: 'Conta',
  alerts: 'Alertas',
} as const;

export const ACTIVITY_ACTIONS = {
  view: 'Abriu a tela',
  search: 'Iniciou uma busca',
  filter: 'Usou um filtro',
  sort: 'Mudou a ordenação',
  offer: 'Abriu uma oferta',
  priceRange: 'Mudou o período do gráfico',
  priceTable: 'Abriu a tabela de preços',
  buildAdd: 'Colocou uma peça na montagem',
  buildRemove: 'Removeu uma peça da montagem',
  buildQuantity: 'Mudou a quantidade na montagem',
  buildOwned: 'Mudou a marcação Já tenho',
  buildClear: 'Limpou a montagem',
  buildShare: 'Copiou o link da montagem',
  buildUse: 'Aproveitou a montagem compartilhada',
  compareAdd: 'Adicionou uma peça à comparação',
  compareRemove: 'Removeu uma peça da comparação',
  compareClear: 'Limpou a comparação',
  compareUse: 'Aproveitou a comparação compartilhada',
  compareCategory: 'Mudou a categoria da comparação',
  pcImport: 'Importou o PC atual',
  pcForget: 'Removeu o PC atual',
  pcPsu: 'Alterou a fonte do PC atual',
  upgrade: 'Abriu uma sugestão de upgrade',
  budgetRun: 'Gerou recomendações',
  budgetEmpty: 'Gerou um orçamento sem sugestões',
  budgetOption: 'Abriu uma alternativa',
  budgetUse: 'Levou a sugestão para a montagem',
  login: 'Entrou com Google',
  logout: 'Saiu da conta',
  alertSave: 'Salvou um alerta',
  alertRemove: 'Removeu um alerta',
} as const;

export type ActivityScreen = keyof typeof ACTIVITY_SCREENS;
export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;
export type ActivityEvent = {
  screen: ActivityScreen;
  action: ActivityAction;
  category?: import('./types.ts').CategoryId;
  mode?: 'full' | 'upgrade';
  store?: import('./types.ts').StoreId;
  product?: string;
};

export type UsageReport = {
  pageSize: number;
  total: number;
  accounts: number;
  visitors: number;
  screens: { screen: ActivityScreen; count: number }[];
  actions: { screen: ActivityScreen; action: ActivityAction; count: number }[];
  recent: (ActivityEvent & { id: number; at: string; person: string; signedIn: boolean; productTitle?: string })[];
};
