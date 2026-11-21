import type { CategoryId, Offer, StoreId } from '@upgradezin/shared';

export interface SearchContext {
  category: CategoryId;
  q: string;
  /**
   * Caminho no site para abrir no lugar da busca (ex. "/hardware/cooler-processador"): o destino
   * para onde a busca da loja já redirecionou esse termo antes. Só nas lojas que redirecionam.
   */
  path?: string;
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
  /** URL da página da categoria no site (STORE_Sx_SWEEP). */
  url: string;
  page: number;
  signal: AbortSignal;
}

export interface StoreAdapter {
  id: StoreId;
  search(ctx: SearchContext): Promise<Offer[]>;
  /** Uma página da categoria inteira (varredura da rotina). Só nas lojas que suportam. */
  sweepPage?(ctx: SweepContext): Promise<{ offers: Offer[]; totalPages: number }>;
  /** HTML da ficha técnica da página de um produto (null: a página não tem). Só nas lojas que suportam. */
  productSheet?(sku: string, signal: AbortSignal): Promise<string | null>;
}

