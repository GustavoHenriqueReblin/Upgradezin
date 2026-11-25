import { useState } from 'react';
import { STORE_INTERVAL_S_MAX, STORE_INTERVAL_S_MIN, type StoreInterval } from '@upgradezin/shared';

/**
 * Intervalo de uma loja ("uma página a cada X a Y s"): dois campos e "Salvar" quando muda. Usado no de
 * listagens (Rotina de preços) e no de fichas (Rotina de fichas técnicas).
 */
export function IntervalInputs({ interval, label, title, onSave }: { interval: StoreInterval; label: string; title: string; onSave: (i: StoreInterval) => void }) {
  const [minS, setMinS] = useState(String(interval.minS));
  const [maxS, setMaxS] = useState(String(interval.maxS));
  const next: StoreInterval = { minS: Number(minS), maxS: Number(maxS) };
  const inRange = (n: number) => Number.isInteger(n) && n >= STORE_INTERVAL_S_MIN && n <= STORE_INTERVAL_S_MAX;
  const valid = inRange(next.minS) && inRange(next.maxS) && next.minS <= next.maxS;
  const changed = next.minS !== interval.minS || next.maxS !== interval.maxS;
  const input = 'w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs text-zinc-500"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && changed) onSave(next);
      }}
    >
      <label className="flex items-center gap-1.5" title={title}>
        {label}
        <input type="number" inputMode="numeric" min={STORE_INTERVAL_S_MIN} max={STORE_INTERVAL_S_MAX} value={minS} onChange={(e) => setMinS(e.target.value)} className={input} aria-label={`${label}: mínimo (s)`} />
        a
        <input type="number" inputMode="numeric" min={STORE_INTERVAL_S_MIN} max={STORE_INTERVAL_S_MAX} value={maxS} onChange={(e) => setMaxS(e.target.value)} className={input} aria-label={`${label}: máximo (s)`} />
        s
      </label>
      {changed && (
        <button type="submit" disabled={!valid} className="rounded-lg accent-control px-2.5 py-1 text-xs font-medium disabled:opacity-40">
          Salvar
        </button>
      )}
      {!valid && (
        <span className="text-red-500">
          De {STORE_INTERVAL_S_MIN} a {STORE_INTERVAL_S_MAX} s, o primeiro não maior que o segundo.
        </span>
      )}
    </form>
  );
}
