import { formatSheetValue, sheetFields, type SheetValues } from './sheet/fields.ts';
import type { CategoryId, Offer } from './types.ts';

/**
 * Página do produto (/produto/<chave>): o produto é o conjunto de anúncios com a mesma chave de
 * produto (mesmo part number em lojas diferentes). A ficha técnica é a juntada das páginas lidas;
 * para quem usa, só o valor (de qual loja veio fica no admin).
 */
export interface ProductPage {
  /** Chave do produto (product_key) ou "id:<anúncio>" para anúncio sem chave. */
  key: string;
  category: CategoryId;
  /** Título do anúncio visto há menos tempo. */
  title: string;
  image?: string;
  /** Campos da ficha que têm valor; os outros aparecem como "não informado". */
  values: SheetValues;
  /** Uma oferta por anúncio: em estoque primeiro, a mais barata (à vista com cupom) antes. */
  offers: Offer[];
}

export const NOT_INFORMED = 'não informado';

/** Linhas da ficha na página: todos os campos da categoria, na ordem da lista; sem valor, "não informado". */
export function sheetRows(category: CategoryId, values: SheetValues): { key: string; label: string; value: string; informed: boolean }[] {
  return sheetFields(category).map((f) => {
    const v = formatSheetValue(f, values[f.key]);
    return { key: f.key, label: f.label, value: v || NOT_INFORMED, informed: !!v };
  });
}

/** Endereço da página do produto. */
export const productPath = (key: string) => `/produto/${encodeURIComponent(key)}`;
