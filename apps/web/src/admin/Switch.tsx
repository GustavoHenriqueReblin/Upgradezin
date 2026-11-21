/** Interruptor liga/desliga (mesmo visual do "Já Tenho" da montagem), com o estado escrito ao lado. */
export function Switch({
  on,
  onChange,
  label,
  disabled,
  onText = 'Ligada',
  offText = 'Desligada',
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Nome para leitores de tela (o texto visível é onText/offText). */
  label: string;
  disabled?: boolean;
  onText?: string;
  offText?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="group flex items-center gap-2 text-sm font-medium disabled:opacity-50"
    >
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-accent-500' : 'bg-zinc-300 group-hover:bg-zinc-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-600'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <span className={on ? '' : 'text-zinc-500'}>{on ? onText : offText}</span>
    </button>
  );
}
