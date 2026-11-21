import { ENABLED_CATEGORIES, type CategoryId } from '@upgradezin/shared';
import { DEFAULT_FILTERS, type Filters } from './filters.ts';

/**
 * O que a tela lembra entre uma visita e outra (só no navegador): a categoria aberta e,
 * em cada categoria, os filtros e se havia resultado na tela. Os resultados em si não são
 * guardados: ao voltar, a busca é refeita (vem do banco do servidor, na hora).
 */
export interface SavedUi {
  category?: CategoryId;
  byCategory: Partial<Record<CategoryId, { filters: Filters; results: boolean }>>;
}

const KEY = 'upgradezin.ui.v1';

/** Filtros salvos por uma versão antiga podem não ter campos novos: completa com o padrão e descarta tipos errados. */
function sanitizeFilters(raw: unknown): Filters {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_FILTERS } as Record<string, unknown>;
  for (const [k, def] of Object.entries(DEFAULT_FILTERS)) {
    const v = src[k];
    if (v === undefined) continue;
    if (Array.isArray(def) ? Array.isArray(v) : def === undefined || typeof v === typeof def) out[k] = v;
  }
  // Campos opcionais sem padrão (ex. faixa de preço, eficiência mínima).
  for (const k of ['priceMin', 'priceMax']) if (typeof src[k] === 'number') out[k] = src[k];
  if (typeof src.effMin === 'string') out.effMin = src.effMin;
  return out as unknown as Filters;
}

export function loadUi(): SavedUi {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SavedUi>;
    const valid = (c: unknown): c is CategoryId => (ENABLED_CATEGORIES as readonly unknown[]).includes(c);
    const byCategory: SavedUi['byCategory'] = {};
    for (const [c, v] of Object.entries(raw.byCategory ?? {})) {
      if (valid(c) && v) byCategory[c] = { filters: sanitizeFilters(v.filters), results: !!v.results };
    }
    return { category: valid(raw.category) ? raw.category : undefined, byCategory };
  } catch {
    return { byCategory: {} };
  }
}

export function saveUi(ui: SavedUi): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ui));
  } catch {
    // navegador sem armazenamento: vale enquanto a página estiver aberta
  }
}
