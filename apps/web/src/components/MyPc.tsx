import { trackActivity } from '../activity.ts';
import { useId, useRef, useState } from 'react';
import { Computer, FileText, Gauge, Trash2, X } from 'lucide-react';
import type { PcProfile } from '@upgradezin/shared';
import { ImportPc, PcInputActions } from './ImportPc.tsx';
import { pcSummary, PcSpecs } from './PcSpecs.tsx';
import { actionLabel, headerAction } from './HeaderActions.tsx';

const button = 'button-link inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold';
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });

/** De onde vêm as peças mostradas: do relatório do CPU-Z (com a data, quando guardada) ou só do que foi marcado como Já tenho. */
export function pcOrigin(pc: PcProfile): string {
  if (pc.source !== 'cpu-z') return 'Peças marcadas como Já tenho na montagem.';
  return pc.importedAt ? `Importado do CPU-Z em ${dateFormat.format(pc.importedAt)}.` : 'Importado do CPU-Z.';
}

interface Props {
  pc: PcProfile | null;
  /** Abre Identificar gargalo. Sem ela (páginas de produto e comparação), o modal só mostra o PC. */
  onAnalyze?: () => void;
  /** Guarda um relatório novo do CPU-Z. */
  onImport?: (pc: PcProfile) => void;
  /** Abre a montagem para marcar as peças como Já tenho. */
  onManual?: () => void;
  /** Apaga o relatório e as marcações Já tenho (pede confirmação antes). */
  onForget?: () => void;
  wide?: boolean;
}

/** Atalho do cabeçalho: o PC atual num modal, sem sair da tela. */
export function MyPcButton({ pc, onAnalyze, onImport, onManual, onForget, wide = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [importing, setImporting] = useState(false);
  const id = useId();
  const run = (action: () => void) => {
    dialog.current?.close();
    action();
  };
  const startImport = onImport && (() => run(() => setImporting(true)));
  const forget = onForget && (() => {
    if (window.confirm('Esquecer o seu PC? O relatório do CPU-Z e as marcações Já tenho da montagem serão apagados.')) run(onForget);
  });
  return (
    <>
      <button type="button" onClick={() => {
        trackActivity({ screen: 'myPc', action: 'view' });
        dialog.current?.showModal();
      }} className={headerAction} aria-haspopup="dialog"
        title={pc ? 'Meu PC' : 'Meu PC (não informado)'} aria-label={pc ? 'Meu PC' : 'Meu PC (não informado)'}>
        <Computer aria-hidden="true" className="h-4 w-4" /> <span className={actionLabel(wide)}>Meu PC</span>
        {pc && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950" />}
      </button>
      <dialog ref={dialog} aria-labelledby={`${id}-title`} onClick={(event) => event.target === dialog.current && dialog.current.close()}
        className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 backdrop:bg-black/60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-semibold">Meu PC</h2>
            {pc && <p className="truncate text-sm text-zinc-500" title={pcSummary(pc)}>{pcSummary(pc)}</p>}
          </div>
          <button type="button" aria-label="Fechar" onClick={() => dialog.current?.close()}
            className="rounded-lg px-2 text-zinc-500 hover:text-accent-500"><X className="h-5 w-5" /></button>
        </div>
        {pc ? (
          <>
            <PcSpecs pc={pc} showPsu />
            <p className="mt-3 text-xs text-zinc-500">{pcOrigin(pc)}</p>
            {(onAnalyze || startImport || forget) && (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                {forget && (
                  <button type="button" onClick={forget} className="mr-auto inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-red-600 hover:underline">
                    <Trash2 aria-hidden="true" className="h-4 w-4" /> Esquecer meu PC
                  </button>
                )}
                {startImport && (
                  <button type="button" onClick={startImport} className={`${button} border border-zinc-300 hover:border-accent-500 dark:border-zinc-700`}>
                    <FileText aria-hidden="true" className="h-4 w-4" /> Trocar relatório
                  </button>
                )}
                {onAnalyze && (
                  <button type="button" onClick={() => run(onAnalyze)} className={`${button} accent-control`}>
                    <Gauge aria-hidden="true" className="h-4 w-4" /> Identificar gargalo
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Você ainda não informou seu PC. Importe o relatório do CPU-Z ou marque Já tenho nas peças da montagem.
            {startImport && (
              <div className="mt-3">
                <PcInputActions onImport={startImport} onManual={onManual && (() => run(onManual))} />
              </div>
            )}
          </div>
        )}
      </dialog>
      {importing && onImport && (
        <ImportPc applyLabel="Salvar meu PC" onClose={() => setImporting(false)} onApply={(next) => {
          onImport(next);
          setImporting(false);
        }} />
      )}
    </>
  );
}
