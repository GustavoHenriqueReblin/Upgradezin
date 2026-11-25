import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, FileText, Gauge, Trash2, Wallet } from 'lucide-react';
import { analyzePc, CATEGORY_DEFS, CPU_BOUND, GPU_BOUND, type PcPart, type PcProfile, type Specs, type UpgradeAction, type Verdict } from '@upgradezin/shared';
import { PC_SLOTS } from '../pc.ts';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { ImportPc, PcInputActions } from './ImportPc.tsx';
import { KIND, SCREEN_LABEL, useCpuSheet, VERDICT, verdictSummary } from '../pcAnalysis.ts';
import { UpgradePicks } from './UpgradePicks.tsx';

interface Props {
  pc: PcProfile | null;
  /** Fonte que a pessoa marcou como "Já tenho" na montagem, quando não informou uma na importação. */
  psu?: Specs;
  psuTitle?: string;
  onImport: (pc: PcProfile) => void;
  onPsu?: (psu: PcPart | undefined) => void;
  onUpgrade: (action: UpgradeAction) => void;
  /** Abre a montagem para marcar as peças como Já tenho ("Informar peças manualmente"). */
  onToBuild: () => void;
  onForget: () => void;
  /** Abre o Montar pelo orçamento no modo upgrade (sem ela, o card não aparece). */
  onBudget?: () => void;
}

const PART_ROW = 'flex min-h-10 items-center gap-3 px-4 text-sm';

/** Posição no medidor (0 a 1): escala logarítmica, equilíbrio no meio. */
const SPAN = Math.log(1.7);
const pos = (ratio: number) => Math.min(1, Math.max(0, 0.5 + Math.log(ratio) / (2 * SPAN)));

/** "Identificar gargalo": o PC importado do CPU-Z, o que segura o desempenho e o que vale fazer. */
export function PcAnalysis({ pc, psu, psuTitle: buildPsuTitle, onImport, onPsu, onUpgrade, onToBuild, onForget, onBudget }: Props) {
  /** 'file': importar de novo; 'psu': só informar a fonte (abre na prévia). */
  const [importing, setImporting] = useState<false | 'file' | 'psu'>(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const cpuSheet = useCpuSheet(pc?.cpu?.specs.cpuModel);
  const analysis = useMemo(() => (pc ? analyzePc(pc, { psu, ...(cpuSheet && { cpuSheet }) }) : null), [pc, psu, cpuSheet]);

  const importModal = importing && (
    <ImportPc
      applyLabel="Analisar meu PC"
      initial={importing === 'psu' ? pc : null}
      onClose={() => setImporting(false)}
      onApply={(p, fromFile) => {
        if (importing === 'psu' && !fromFile && onPsu) onPsu(p.psu);
        else onImport(p);
        setImporting(false);
        setTipsOpen(false);
      }}
    />
  );

  if (!pc || !analysis) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Identificar gargalo</h2>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">Veja o que limita o desempenho do seu PC e quais upgrades valem a pena.</p>
        </div>
        <div className="grid overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.57fr)]">
          <div className="flex items-start gap-3 p-4 sm:p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              <Gauge className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="font-semibold">Relatório automático</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Importe o relatório ou selecione as peças na montagem e marque Já tenho. O arquivo fica no seu navegador.
              </p>
            </div>
          </div>
          <div className="flex flex-col justify-center border-t border-zinc-200 bg-zinc-50 p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950/45 md:border-l md:border-t-0">
            <PcInputActions onImport={() => setImporting('file')} onManual={onToBuild} />
          </div>
        </div>
        {importModal}
      </div>
    );
  }

  const { balance, tips } = analysis;
  const PsuIcon = CATEGORY_ICONS.psu;
  // A informada aqui vale mais; sem ela, a "Já tenho" da montagem.
  const psuTitle = pc.psu?.title ?? buildPsuTitle;
  const summary = verdictSummary(pc, balance);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Identificar gargalo</h2>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">Diagnóstico com as peças do seu PC.</p>
          {pc.source === 'manual' && !pc.monitors.length && (
            <p className="mt-1 text-xs text-zinc-500">Sem dados do monitor, a análise considera Full HD a 60 Hz.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button onClick={onForget} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-red-600 hover:underline">
            <Trash2 className="h-4 w-4" /> Esquecer meu PC
          </button>
          <button onClick={() => setImporting('file')} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:underline">
            <FileText className="h-4 w-4" /> {pc.source === 'manual' ? 'Importar relatório' : 'Trocar relatório'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Veredito e medidor */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold">{VERDICT[balance.verdict]}</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{summary}</p>
          {balance.ratio !== undefined && <Meter ratio={balance.ratio} verdict={balance.verdict} />}
          {balance.cpuFrom && balance.ratio !== undefined && (
            <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {balance.cpuFrom === 'sheet'
                ? 'Processador avaliado pela ficha técnica (arquitetura, clock máximo, cache e núcleos); '
                : 'Processador avaliado pela linha e geração (o catálogo ainda não tem a ficha deste modelo); '}
              placa de vídeo pela média de análises de jogos do chip.
            </p>
          )}
        </section>

        {/* Peças lidas */}
        <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="border-b border-zinc-200 px-4 py-3.5 text-sm font-semibold dark:border-zinc-800">Peças do seu PC</h3>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {PC_SLOTS.map((slot) => {
              const Icon = CATEGORY_ICONS[slot];
              const part = pc[slot];
              return (
                <li key={slot} className={PART_ROW}>
                  <Icon className="h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-400" strokeWidth={1.75} />
                  <span className="w-24 shrink-0 text-xs font-semibold text-zinc-600 dark:text-zinc-400">{CATEGORY_DEFS[slot].name}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {part ? part.title : slot === 'gpu' && pc.cpu?.specs.igpu ? 'Vídeo integrado' : <span className="text-zinc-500">Não encontrada</span>}
                  </span>
                </li>
              );
            })}
            <li className={PART_ROW}>
              <PsuIcon className="h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-400" strokeWidth={1.75} />
              <span className="w-24 shrink-0 text-xs font-semibold text-zinc-600 dark:text-zinc-400">{CATEGORY_DEFS.psu.name}</span>
              <span className="min-w-0 flex-1 truncate">{psuTitle ?? <span className="text-zinc-500">Não informada</span>}</span>
              <button onClick={() => setImporting('psu')} className="shrink-0 text-sm font-medium text-accent-600 hover:underline dark:text-accent-400">
                {psuTitle ? 'Alterar' : 'Informar'}
              </button>
            </li>
          </ul>
        </section>
      </div>

      {onBudget && (
        <button onClick={onBudget} data-button-layout="card"
          className="group flex w-full items-center gap-3 rounded-2xl border border-accent-500/35 bg-accent-500/5 p-4 text-left transition hover:border-accent-500/70 hover:bg-accent-500/10 focus-visible:outline-2 focus-visible:outline-accent-500 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600 dark:text-accent-400">
            <Wallet className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Tem um valor em mente?</span>
            <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">Compare upgrades dentro do seu orçamento.</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-accent-600 transition group-hover:translate-x-0.5 dark:text-accent-400" />
        </button>
      )}

      {/* Sugestões */}
      <details open={tipsOpen} onToggle={(event) => setTipsOpen(event.currentTarget.open)}
        className="group rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="flex list-none items-center justify-between gap-3 rounded-2xl p-4 font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
          {tips.length ? 'O que fazer' : 'Nada a fazer por enquanto'}
          <ChevronDown className="h-5 w-5 shrink-0 text-zinc-500 transition group-open:rotate-180 dark:text-zinc-400" aria-hidden="true" />
        </summary>
        {tipsOpen && (tips.length ? <ol className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {tips.map((t) => (
            <li key={t.id} className="p-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${KIND[t.kind].cls}`}>{KIND[t.kind].label}</span>
                <h4 className="font-medium">{t.title}</h4>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t.text}</p>
              {t.action && <UpgradePicks action={t.action} />}
              {t.action && (
                <button
                  onClick={() => onUpgrade(t.action!)}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-semibold transition hover:border-zinc-500 focus-visible:outline-2 focus-visible:outline-accent-500 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  {t.action.label} <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ol> : <p className="border-t border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400 sm:px-6">
          Não achei gargalo nem ajuste pendente. Seu PC está bem resolvido.
        </p>)}
      </details>

      <p className="text-xs text-zinc-500">
        O equilíbrio é uma estimativa para jogos, a partir de uma tabela de desempenho aproximado e do seu monitor. Jogos diferentes pesam mais no processador ou na placa de vídeo.
      </p>
      {importModal}
    </div>
  );
}

/** Medidor de equilíbrio: onde o PC está entre "processador limita" e "placa de vídeo limita". */
function Meter({ ratio, verdict }: { ratio: number; verdict: Verdict }) {
  const left = pos(CPU_BOUND) * 100;
  const right = pos(GPU_BOUND) * 100;
  const at = pos(ratio) * 100;
  const active = verdict === 'cpu' ? 0 : verdict === 'gpu' ? 2 : 1;
  const zones = [
    { label: 'Processador limita', width: left, align: '' },
    { label: 'Equilibrado', width: right - left, align: 'text-center' },
    { label: 'Placa de vídeo limita', width: 100 - right, align: 'text-right' },
  ];
  return (
    <div className="mt-5" role="img" aria-label={`Equilíbrio: ${zones[active]!.label.toLowerCase()}`}>
      <div className="relative h-2">
        <div className="absolute inset-0 flex gap-0.5 overflow-hidden rounded-full">
          {zones.map(({ label, width }, i) => (
            <div key={label} className={i === active ? 'bg-accent-500/35' : 'bg-zinc-200 dark:bg-zinc-700'} style={{ width: `${width}%` }} />
          ))}
        </div>
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent-500 ring-1 ring-accent-500/40 dark:border-zinc-900"
          style={{ left: `${at}%` }}
        />
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
        {zones.map(({ label, align }, i) => (
          <span key={label} className={`${align} ${i === active ? 'font-semibold text-accent-700 dark:text-accent-400' : 'text-zinc-600 dark:text-zinc-400'}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}
