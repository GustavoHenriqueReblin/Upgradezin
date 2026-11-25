import { accountStorage } from '../account.ts';
import { useSyncExternalStore } from 'react';
import { ChartColumn } from 'lucide-react';
import { CATEGORIES, type CategoryId } from '@upgradezin/shared';
import { compareKeys, compareUrl, comparisonSelectionKey } from '../compare.ts';

const listeners = new Set<() => void>();
const memory: Partial<Record<CategoryId, string>> = {};

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function selection(category: CategoryId): string {
  try { return accountStorage.getItem(comparisonSelectionKey(category)) ?? memory[category] ?? ''; }
  catch { return memory[category] ?? ''; }
}

const control = 'button-link inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-accent-500 dark:border-zinc-700';

export function CompareButton({ category, productKey, iconOnly = false }: { category: CategoryId; productKey: string; iconOnly?: boolean }) {
  const raw = useSyncExternalStore(subscribe, () => selection(category), () => '');
  const selected = compareKeys(new URLSearchParams(raw));
  const active = selected.includes(productKey);
  const toggle = () => {
    const next = active ? selected.filter((key) => key !== productKey) : [...selected, productKey];
    const raw = compareUrl(next).split('?')[1] ?? '';
    memory[category] = raw;
    try { accountStorage.setItem(comparisonSelectionKey(category), raw); } catch { /* A seleção continua válida na aba. */ }
    for (const listener of listeners) listener();
  };
  return (
    <button type="button" aria-pressed={active} onClick={toggle}
      aria-label={active ? 'Remover da Comparação' : 'Comparar'} title={active ? 'Remover da Comparação' : 'Comparar'}
      className={`${control} shrink-0 aria-pressed:border-accent-500 aria-pressed:bg-accent-500/10 aria-pressed:text-accent-600`}>
      <ChartColumn aria-hidden="true" className="h-4 w-4" /> {!iconOnly && (active ? 'Remover da Comparação' : 'Comparar')}
    </button>
  );
}

const selectedUrl = () => compareUrl(CATEGORIES.flatMap((category) => compareKeys(new URLSearchParams(selection(category)))));

export function CompareLink({ showLabel = false }: { showLabel?: boolean }) {
  const href = useSyncExternalStore(subscribe, selectedUrl, () => '/comparar');
  const count = compareKeys(new URLSearchParams(href.split('?')[1])).length;
  return (
    <a className={`${control} shrink-0`} href={href} aria-label={`Comparar Peças (${count})`} title="Comparar Peças">
      <ChartColumn aria-hidden="true" className="h-4 w-4" /> {showLabel && <span>Comparar</span>} <span className="tabular-nums">{count}</span>
    </a>
  );
}
