import { Wrench } from 'lucide-react';

/** Atalhos do cabeçalho (Meu PC, Comparar, Montagem): ícone com contagem no canto, nome só em telas bem largas. */
export const headerAction = 'button-link relative inline-flex min-w-10 shrink-0 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white';

/** Nome do atalho: na tela inicial (sem as categorias ao lado) aparece a partir do celular deitado. */
export const actionLabel = (wide: boolean) => (wide ? 'hidden sm:inline' : 'hidden 2xl:inline');

/** Visual de toda contagem do site (atalhos do cabeçalho, abas do comparador): laranja escuro com o número em laranja. */
export const countPill = 'rounded-full bg-accent-100 font-semibold tabular-nums text-accent-800 dark:bg-accent-950 dark:text-accent-300';

export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span aria-hidden="true"
      className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] leading-none ring-2 ring-white dark:ring-zinc-950 ${countPill}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * Atalho Montagem, igual em todo cabeçalho: com `onClick` abre a montagem dentro do app; sem ele, é um link para
 * /montagem (páginas de produto e comparação). Aberta, fica em laranja.
 */
export function BuildAction({ count, active = false, wide = false, onClick }: { count: number; active?: boolean; wide?: boolean; onClick?: () => void }) {
  const label = count ? `Montagem (${count})` : 'Montagem';
  const content = (
    <>
      <Wrench aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
      <span className={actionLabel(wide)}>Montagem</span>
      <CountBadge count={count} />
    </>
  );
  const className = `${headerAction} ${active ? 'accent-control' : ''}`;
  return onClick
    ? <button type="button" onClick={onClick} aria-label={label} title="Montagem" aria-pressed={active} className={className}>{content}</button>
    : <a href="/montagem" aria-label={label} title="Montagem" className={className}>{content}</a>;
}
