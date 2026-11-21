import type { StoreId, StoreInfo } from '@upgradezin/shared';

/**
 * Lojas configuradas no servidor (.env). O front só conhece IDs; nome e cor
 * chegam de GET /api/stores, carregado uma vez antes de montar a tela.
 */
let list: StoreInfo[] = [];

export async function loadStores(): Promise<void> {
  const res = await fetch('/api/stores');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  list = (await res.json()) as StoreInfo[];
}

export const storeList = (): StoreInfo[] => list;
export const storeIds = (): StoreId[] => list.map((s) => s.id);
export const storeName = (id: StoreId): string => list.find((s) => s.id === id)?.name ?? id;

/** Cor padrão por ID, quando o .env não define STORE_Sx_COLOR. */
const DEFAULT_COLOR: Record<StoreId, string> = { s1: '#10b981', s2: '#8b5cf6', s3: '#f59e0b' };
export const storeColor = (id: StoreId): string => list.find((s) => s.id === id)?.color ?? DEFAULT_COLOR[id];

/** Fundo da bolinha da loja: degradê quando o .env lista mais de uma cor, senão a cor lisa. */
export function storeDotBackground(id: StoreId): string {
  const colors = list.find((s) => s.id === id)?.colors;
  return colors && colors.length > 1 ? `linear-gradient(135deg, ${colors.join(', ')})` : storeColor(id);
}
