import type { SearchOptionCounts } from '@upgradezin/shared';

/** Contagem das opções do formulário da busca (GET /api/search/options). */

/** Produtos que um valor fora da lista fixa precisa ter para virar opção. */
export const MIN_EXTRA = 3;

/** Produtos da opção; undefined sem contagem. */
export const countOf = (c: SearchOptionCounts | null, facet: string, value: string | number) => (c ? (c[facet]?.[String(value)] ?? 0) : undefined);

/**
 * Valores numéricos de um campo: os da lista fixa e, com contagem, também os que o banco tiver (com
 * `prefix`, só os do tipo: "ddr5:"); sem produto, a opção some (a não ser que esteja escolhida).
 */
export function numbersOf(c: SearchOptionCounts | null, facet: string, fixed: readonly number[], selected: readonly number[], prefix = ''): number[] {
  if (!c) return [...fixed];
  const fromDb = Object.keys(c[facet] ?? {})
    .filter((k) => k.startsWith(prefix))
    .map((k) => Number(k.slice(prefix.length)));
  // Valor fora da lista (1600 W, 24 GB…) só com uns produtos: um anúncio com potência estranha não vira opção.
  const enough = (v: number) => (countOf(c, facet, `${prefix}${v}`) ?? 0) >= (fixed.includes(v) ? 1 : MIN_EXTRA);
  return [...new Set([...fixed, ...fromDb, ...selected])].filter((v) => Number.isFinite(v) && (enough(v) || selected.includes(v))).sort((a, b) => a - b);
}
