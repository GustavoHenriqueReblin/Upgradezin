import { CircleAlert, CircleCheck, CircleHelp, CircleX, Info, type LucideIcon } from 'lucide-react';
import type { BuildIssue, PartStatus } from '@upgradezin/shared';

const STATUS: Record<PartStatus, { label: string; icon: LucideIcon; cls: string }> = {
  ok: { label: 'Compatível', icon: CircleCheck, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' },
  info: { label: 'Compatível', icon: CircleCheck, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' },
  warn: { label: 'Com Ressalva', icon: CircleAlert, cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' },
  error: { label: 'Incompatível', icon: CircleX, cls: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' },
  unknown: { label: 'Não Confirmado', icon: CircleHelp, cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' },
};

/** Selo verde/amarelo/vermelho/cinza de uma peça na montagem. */
export function CompatBadge({ status }: { status: PartStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <s.icon className="h-3.5 w-3.5" />
      {s.label}
    </span>
  );
}

const ISSUE: Record<BuildIssue['level'], { icon: LucideIcon; cls: string }> = {
  error: { icon: CircleX, cls: 'text-red-700 dark:text-red-300' },
  warn: { icon: CircleAlert, cls: 'text-amber-700 dark:text-amber-300' },
  unknown: { icon: CircleHelp, cls: 'text-zinc-500 dark:text-zinc-400' },
  info: { icon: Info, cls: 'text-zinc-500 dark:text-zinc-400' },
};

/** Motivos do selo, do mais grave ao mais leve. */
export function IssueList({ issues, limit }: { issues: BuildIssue[]; limit?: number }) {
  const shown = limit ? issues.slice(0, limit) : issues;
  if (!shown.length) return null;
  return (
    <ul className="space-y-1">
      {shown.map((i) => {
        const s = ISSUE[i.level];
        return (
          <li key={i.code} className={`flex gap-1.5 text-xs leading-snug ${s.cls}`}>
            <s.icon className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{i.message}</span>
          </li>
        );
      })}
      {limit && issues.length > limit && <li className="pl-5 text-xs text-zinc-400">e mais {issues.length - limit}</li>}
    </ul>
  );
}
