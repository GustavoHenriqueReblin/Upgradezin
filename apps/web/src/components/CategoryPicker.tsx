import { CircuitBoard, Cpu, Fan, Gpu, HardDrive, MemoryStick, PcCase, Zap, type LucideIcon } from 'lucide-react';
import { CATEGORIES, CATEGORY_DEFS, type CategoryId } from '@upgradezin/shared';

export const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  gpu: Gpu,
  cpu: Cpu,
  motherboard: CircuitBoard,
  ram: MemoryStick,
  ssd: HardDrive,
  psu: Zap,
  cooler: Fan,
  case: PcCase,
};

interface Props {
  value: CategoryId | null;
  onChange: (c: CategoryId) => void;
  /** "grid": tela inicial com blocos grandes. "bar": barra compacta no cabeçalho. */
  variant: 'grid' | 'bar';
  disabled?: boolean;
}

export function CategoryPicker({ value, onChange, variant, disabled }: Props) {
  if (variant === 'grid') {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATEGORIES.map((id) => {
          const def = CATEGORY_DEFS[id];
          const Icon = CATEGORY_ICONS[id];
          return (
            <button
              key={id}
              disabled={!def.enabled}
              onClick={() => onChange(id)}
              className="group relative flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-6 transition hover:border-accent-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200 disabled:hover:shadow-none dark:border-zinc-800 dark:bg-zinc-900 dark:disabled:hover:border-zinc-800"
            >
              <Icon className="h-9 w-9 text-zinc-500 transition group-enabled:group-hover:text-accent-500" strokeWidth={1.5} />
              <span className="font-medium">{def.name}</span>
              {!def.enabled && <span className="absolute right-2 top-2 text-[11px] text-zinc-400">Em Breve</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {CATEGORIES.map((id) => {
        const def = CATEGORY_DEFS[id];
        const Icon = CATEGORY_ICONS[id];
        const active = value === id;
        return (
          <button
            key={id}
            disabled={!def.enabled || disabled}
            onClick={() => onChange(id)}
            title={def.enabled ? def.name : `${def.name} (Em Breve)`}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition disabled:cursor-not-allowed ${
              active
                ? 'bg-accent-500 text-accent-950'
                : def.enabled
                  ? 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  : 'text-zinc-400 opacity-50 dark:text-zinc-600'
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            <span className={`font-semibold ${active ? '' : 'hidden lg:inline'}`}>{def.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
