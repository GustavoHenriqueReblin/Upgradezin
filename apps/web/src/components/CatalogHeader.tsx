import { ArrowLeft } from 'lucide-react';
import type { CategoryId } from '@upgradezin/shared';
import { CompareLink } from './CompareControls.tsx';
import { AccountControl } from './AccountControl.tsx';
import { searchCategoryHref } from '../uiState.ts';

export function CatalogHeader({ maxWidth, title, category = 'gpu' }: { maxWidth?: string; title?: string; category?: CategoryId }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`mx-auto max-w-5xl items-center gap-2 px-4 py-3 ${title
        ? 'grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_1fr]'
        : 'flex justify-between'}`} style={{ maxWidth }}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <a href="/" className="text-lg font-bold tracking-tight">
            Upgradezin<span className="text-accent-500">.</span>
          </a>
          <a href={searchCategoryHref(category)}
            className="button-link inline-flex items-center gap-1.5 rounded-lg px-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Voltar à Busca
          </a>
        </div>
        {title && <h1 className="col-span-2 row-start-2 text-center text-xl font-bold md:col-span-1 md:col-start-2 md:row-start-1">{title}</h1>}
        <div className={`flex items-center gap-2 ${title ? 'col-start-2 row-start-1 justify-self-end md:col-start-3' : ''}`}>
          <CompareLink />
          <AccountControl />
        </div>
      </div>
    </header>
  );
}
