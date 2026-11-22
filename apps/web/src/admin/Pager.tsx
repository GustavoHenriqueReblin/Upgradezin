import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Paginação das tabelas do admin (produtos, consultas, termos): "51–100 de 2.457 · ‹ página 2 de 50 ›". */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const n = (x: number) => x.toLocaleString('pt-BR');
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-sm">
      <span className="text-zinc-500">
        {n((page - 1) * pageSize + 1)}–{n(Math.min(page * pageSize, total))} de {n(total)}
      </span>
      <span className="flex items-center gap-1">
        <PageBtn disabled={page <= 1} onClick={() => onPage(page - 1)} label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </PageBtn>
        <span className="px-2 tabular-nums">
          página {page} de {pages}
        </span>
        <PageBtn disabled={page >= pages} onClick={() => onPage(page + 1)} label="Próxima página">
          <ChevronRight className="h-4 w-4" />
        </PageBtn>
      </span>
    </div>
  );
}

const PageBtn = ({ children, label, ...rest }: { children: ReactNode; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" aria-label={label} {...rest} className="rounded-lg border border-zinc-300 p-1 hover:border-accent-500 disabled:opacity-40 dark:border-zinc-700">
    {children}
  </button>
);
