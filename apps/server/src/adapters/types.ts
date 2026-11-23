import type { CategoryId, Offer, StoreId } from '@upgradezin/shared';

/** Busca por texto na loja ("Não achou? Buscar nas lojas"). */
export interface SearchContext {
  category: CategoryId;
  q: string;
  signal: AbortSignal;
  /** Teto de páginas desta consulta (abaixo do MAX_PAGES_* da loja). A busca do site usa SEARCH_MAX_PAGES. */
  maxPages?: number;
  /** Chamado a cada página lida, com as ofertas novas dela (resultado parcial ao vivo). */
  onPage?: (info: { page: number; total?: number; found: number; offers: Offer[] }) => void;
  /** A loja pediu verificação humana; a busca está esperando alguém confirmar na janela. */
  onNeedsHuman?: () => void;
}

export interface SweepContext {
  category: CategoryId;
  /** URL da página da categoria no site (configuração da loja, "Página da categoria"). */
  url: string;
  page: number;
  signal: AbortSignal;
  /** Abre o endereço da página direto, numa aba nova, sem seguir pela lista já aberta (teste do admin). */
  fresh?: boolean;
}

/** Uma página da categoria: as ofertas lidas, quantas páginas a lista tem e quantos itens da página estão em estoque. */
export interface SweepPage {
  offers: Offer[];
  totalPages: number;
  /**
   * Itens em estoque na página, contados antes de filtrar pela categoria do app (acessório, item sem
   * preço). As lojas listam os em estoque primeiro: página sem nenhum = fim do que está à venda.
   */
  inStock: number;
  /** Como a página foi aberta: pelo clique no link dela na página anterior ou pelo endereço. */
  via?: 'click' | 'url';
}

export interface StoreAdapter {
  id: StoreId;
  search(ctx: SearchContext): Promise<Offer[]>;
  /** Uma página da categoria (rotina de preços). */
  sweepPage?(ctx: SweepContext): Promise<SweepPage>;
  /**
   * HTML da ficha técnica da página de um produto (null: a página não tem). `url` é o endereço do
   * anúncio guardado no banco (a S2 monta a página pelo nome do produto, não pelo código).
   */
  productSheet?(product: { sku: string; url?: string }, signal: AbortSignal): Promise<string | null>;
}

