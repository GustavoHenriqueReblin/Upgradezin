import type { ReactNode } from 'react';

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-zinc-600 dark:text-zinc-400">{title}</div>
      {hint && <div className="-mt-1 mb-2 text-xs text-zinc-400">{hint}</div>}
      {children}
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  count,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  count?: number;
}) {
  return (
    <label className="flex items-center gap-2 py-0.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent-600" />
      <span className="flex-1">{label}</span>
      {count != null && <span className="text-xs text-zinc-400">{count}</span>}
    </label>
  );
}

export function Pill({
  active,
  muted,
  onClick,
  size = 'sm',
  children,
}: {
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border transition ${size === 'md' ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs'} ${
        active
          ? 'border-accent-500 bg-accent-500 text-accent-950'
          : 'border-zinc-300 hover:border-accent-500 dark:border-zinc-700'
      } ${muted && !active ? 'opacity-40' : ''}`}
    >
      {children}
    </button>
  );
}

export function PriceInput({ value, placeholder, onChange }: { value?: number; placeholder: string; onChange: (v?: number) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      step={50}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      placeholder={placeholder}
      className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
    />
  );
}

export const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
