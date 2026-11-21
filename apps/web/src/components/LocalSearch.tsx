import { isTextTerm } from '@upgradezin/shared';
import { Search, Store, X } from 'lucide-react';
import { textTerms } from '../filters.ts';

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Nomes comuns entre os resultados (ver commonWords). */
  suggestions: string[];
  /** Busca o texto nas lojas (só aparece com um texto que vale como termo e que ainda não foi buscado). */
  onSearchStores?: (text: string) => void;
}

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Filtra os resultados já carregados pelo título. Não consulta as lojas. */
export function LocalSearch({ value, onChange, suggestions, onSearchStores }: Props) {
  const terms = textTerms(value);
  const text = value.trim().replace(/s+/g, ' ');
  const canSearch = !!onSearchStores && isTextTerm(text);
  const toggle = (w: string) => onChange(terms.includes(w) ? terms.filter((t) => t !== w).join(' ') : [...terms, w].join(' '));
  const chips = [...new Set([...terms, ...suggestions])];

  return (
    <div className="mb-4 space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Filtrar nos Resultados (ex.: Windforce, Fury, OC)"
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-9 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {value && (
          <button onClick={() => onChange('')} title="Limpar" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {canSearch && (
        <button
          onClick={() => onSearchStores!(text)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 underline-offset-2 hover:text-accent-600 hover:underline dark:hover:text-accent-400"
        >
          <Store className="h-3.5 w-3.5" />
          Não achou? Buscar “{text}” nas lojas
        </button>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((w) => {
            const active = terms.includes(w);
            return (
              <button
                key={w}
                onClick={() => toggle(w)}
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  active ? 'border-accent-500 bg-accent-500 text-accent-950' : 'border-zinc-300 text-zinc-600 hover:border-accent-500 dark:border-zinc-700 dark:text-zinc-300'
                }`}
              >
                {titleCase(w)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
