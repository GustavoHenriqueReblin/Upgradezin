import { trackActivity } from '../activity.ts';
import { useSyncExternalStore } from 'react';
import { ChartColumn } from 'lucide-react';
import type { CategoryId } from '@upgradezin/shared';
import { compareUrl } from '../compare.ts';
import { COMPARE_LIMIT, compareSelection, countIn, emptySelection, subscribeCompare, toggleCompare } from '../compareSelection.ts';
import { actionLabel, CountBadge, headerAction } from './HeaderActions.tsx';

export const useCompareSelection = () => useSyncExternalStore(subscribeCompare, compareSelection, emptySelection);

const control = 'button-link inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-accent-500 dark:border-zinc-700';

export function CompareButton({ category, productKey, iconOnly = false }: { category: CategoryId; productKey: string; iconOnly?: boolean }) {
  const selection = useCompareSelection();
  const active = selection.some((entry) => entry.key === productKey);
  const full = !active && countIn(selection, category) >= COMPARE_LIMIT;
  const label = active ? 'Remover da comparação' : full ? `Limite de ${COMPARE_LIMIT} por categoria` : 'Comparar';
  return (
    <button type="button" aria-pressed={active} disabled={full} onClick={() => {
      if (!toggleCompare(category, productKey)) return;
      trackActivity({ screen: 'compare', action: active ? 'compareRemove' : 'compareAdd', category, product: productKey });
    }} aria-label={label} title={label}
      className={`${control} shrink-0 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-accent-500 aria-pressed:bg-accent-500/10 aria-pressed:text-accent-600`}>
      <ChartColumn aria-hidden="true" className="h-4 w-4" /> {!iconOnly && label}
    </button>
  );
}

/** Atalho do cabeçalho; `active` na página de comparação (em laranja, como a Montagem aberta). */
export function CompareLink({ showLabel = false, active = false }: { showLabel?: boolean; active?: boolean }) {
  const selection = useCompareSelection();
  const count = selection.length;
  return (
    <a className={`${headerAction} ${active ? 'accent-control' : ''}`} aria-current={active ? 'page' : undefined} href={compareUrl(selection.map((entry) => entry.key))} aria-label={count ? `Comparar peças (${count})` : 'Comparar peças'} title="Comparar peças">
      <ChartColumn aria-hidden="true" className="h-4 w-4" /> <span className={actionLabel(showLabel)}>Comparar</span>
      <CountBadge count={count} />
    </a>
  );
}
