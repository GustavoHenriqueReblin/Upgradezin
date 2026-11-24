import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Cpu, FileText, Gauge, Trash2, Wrench } from 'lucide-react';
import { analyzePc, CATEGORY_DEFS, CPU_BOUND, GPU_BOUND, type PcProfile, type Specs, type TipKind, type UpgradeAction, type Verdict } from '@upgradezin/shared';
import { PC_SLOTS } from '../pc.ts';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { ImportPc } from './ImportPc.tsx';
import { UpgradePicks } from './UpgradePicks.tsx';

interface Props {
  pc: PcProfile | null;
  /** Fonte que a pessoa marcou como "Já Tenho" na montagem, quando não informou uma na importação. */
  psu?: Specs;
  psuTitle?: string;
  onImport: (pc: PcProfile) => void;
  onUpgrade: (action: UpgradeAction) => void;
  onToBuild: () => void;
  onForget: () => void;
}

const RES_LABEL = { '1080p': 'Full HD', '1440p': 'Quad HD', '4k': '4K' } as const;

const VERDICT: Record<Verdict, string> = {
  gpu: 'A Placa de Vídeo Segura o PC',
  cpu: 'O Processador Segura o PC',
  balanced: 'Processador e Placa de Vídeo Equilibrados',
  unknown: 'Não Deu para Avaliar o Equilíbrio',
};

const KIND: Record<TipKind, { label: string; cls: string }> = {
  upgrade: { label: 'Upgrade', cls: 'bg-accent-500/15 text-accent-700 dark:text-accent-300' },
  free: { label: 'Grátis', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  attention: { label: 'Atenção', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  info: { label: 'Observação', cls: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300' },
};

/** Posição no medidor (0 a 1): escala logarítmica, equilíbrio no meio. */
const SPAN = Math.log(1.7);
const pos = (ratio: number) => Math.min(1, Math.max(0, 0.5 + Math.log(ratio) / (2 * SPAN)));

/**
 * Ficha técnica do processador da pessoa: o mesmo modelo no catálogo (GET /api/sheets/cpu). Sem ela
 * (modelo que o catálogo não tem, ou sem resposta), a análise usa a tabela por linha.
 */
function useCpuSheet(model: string | undefined): Record<string, number | string | boolean> | undefined {
  const [sheet, setSheet] = useState<{ model: string; values: Record<string, number | string | boolean> } | undefined>();
  useEffect(() => {
    if (!model) return;
    let alive = true;
    fetch(`/api/sheets/cpu?model=${encodeURIComponent(model)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, number | string | boolean>>) : undefined))
      .then((values) => alive && values && setSheet({ model, values }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [model]);
  return sheet && sheet.model === model ? sheet.values : undefined;
}

/** "Identificar Gargalo": o PC importado do CPU-Z, o que segura o desempenho e o que vale fazer. */
export function PcAnalysis({ pc, psu, psuTitle: buildPsuTitle, onImport, onUpgrade, onToBuild, onForget }: Props) {
  /** 'file': importar de novo; 'psu': só informar a fonte (abre na prévia). */
  const [importing, setImporting] = useState<false | 'file' | 'psu'>(false);
  const cpuSheet = useCpuSheet(pc?.cpu?.specs.cpuModel);
  const analysis = useMemo(() => (pc ? analyzePc(pc, { psu, ...(cpuSheet && { cpuSheet }) }) : null), [pc, psu, cpuSheet]);

  const importModal = importing && (
    <ImportPc
      applyLabel="Analisar Meu PC"
      initial={importing === 'psu' ? pc : null}
      onClose={() => setImporting(false)}
      onApply={(p) => {
        onImport(p);
        setImporting(false);
      }}
    />
  );

  if (!pc || !analysis) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="text-xl font-semibold">Identificar Gargalo</h2>
        <p className="mb-6 text-sm text-zinc-500">Descubra qual peça segura o seu PC e o que vale trocar, com os preços das lojas.</p>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <Gauge className="mx-auto h-10 w-10 text-accent-500" strokeWidth={1.5} />
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500">
            O Upgradezin lê o relatório do CPU-Z, um programa gratuito que mostra as peças do PC. Leva um minuto, e o arquivo não sai do seu navegador.
          </p>
          <button
            onClick={() => setImporting('file')}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-accent-950 hover:bg-accent-400"
          >
            <Cpu className="h-4 w-4" /> Importar Meu PC
          </button>
        </div>
        {importModal}
      </div>
    );
  }

  const { balance, tips } = analysis;
  const PsuIcon = CATEGORY_ICONS.psu;
  // A informada aqui vale mais; sem ela, a "Já Tenho" da montagem.
  const psuTitle = pc.psu?.title ?? buildPsuTitle;
  const screen = `${RES_LABEL[balance.res]}${balance.hz && balance.hz >= 120 ? ` a ${balance.hz} Hz` : ''}`;
  const cpuName = pc.cpu?.title ?? 'o processador';
  const gpuName = pc.gpu?.specs.gpuModel ?? (pc.gpu ? pc.gpu.title : 'o vídeo integrado');
  const summary =
    balance.verdict === 'gpu'
      ? `Em ${screen}, o ${cpuName} aguenta mais do que ${pc.gpu ? `a ${gpuName}` : gpuName} entrega.`
      : balance.verdict === 'cpu'
        ? `Em ${screen}, ${pc.gpu ? `a ${gpuName}` : 'a placa de vídeo'} fica esperando o ${cpuName}.`
        : balance.verdict === 'balanced'
          ? `Em ${screen}, nenhum dos dois espera muito pelo outro. Trocar só um deles rende pouco.`
          : `Não reconheci ${balance.missing} na tabela de desempenho. As outras dicas continuam valendo.`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-xl font-semibold">Identificar Gargalo</h2>
          <p className="text-sm text-zinc-500">A partir do relatório do CPU-Z do seu PC.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <button onClick={onForget} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-red-600 hover:underline">
            <Trash2 className="h-4 w-4" /> Esquecer Meu PC
          </button>
          <button onClick={() => setImporting('file')} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:underline">
            <FileText className="h-4 w-4" /> Trocar Relatório
          </button>
          <button
            onClick={onToBuild}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-accent-500 dark:border-zinc-700"
          >
            <Wrench className="h-4 w-4" /> Levar para a Montagem
          </button>
        </div>
      </div>

      {/* Veredito e medidor */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-lg font-semibold">{VERDICT[balance.verdict]}</h3>
        <p className="mt-1 text-sm text-zinc-500">{summary}</p>
        {balance.ratio !== undefined && <Meter ratio={balance.ratio} />}
        {balance.cpuFrom && balance.ratio !== undefined && (
          <p className="mt-3 text-xs text-zinc-500">
            {balance.cpuFrom === 'sheet'
              ? 'Processador avaliado pela ficha técnica (arquitetura, clock máximo, cache e núcleos); '
              : 'Processador avaliado pela linha e geração (o catálogo ainda não tem a ficha deste modelo); '}
            placa de vídeo pela média de análises de jogos do chip.
          </p>
        )}
      </section>

      {/* Peças lidas */}
      <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {PC_SLOTS.map((slot) => {
            const Icon = CATEGORY_ICONS[slot];
            const part = pc[slot];
            return (
              <li key={slot} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" strokeWidth={1.75} />
                <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-400">{CATEGORY_DEFS[slot].name}</span>
                <span className="min-w-0 flex-1 truncate">
                  {part ? part.title : slot === 'gpu' && pc.cpu?.specs.igpu ? 'Vídeo integrado' : <span className="text-zinc-500">Não encontrada</span>}
                </span>
              </li>
            );
          })}
          <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <PsuIcon className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" strokeWidth={1.75} />
            <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-400">{CATEGORY_DEFS.psu.name}</span>
            <span className="min-w-0 flex-1 truncate">{psuTitle ?? <span className="text-zinc-500">Não informada</span>}</span>
            <button onClick={() => setImporting('psu')} className="shrink-0 text-sm font-medium text-accent-600 hover:underline dark:text-accent-400">
              {psuTitle ? 'Alterar' : 'Informar'}
            </button>
          </li>
        </ul>
      </section>

      {/* Sugestões */}
      <section>
        <h3 className="mb-3 font-semibold">{tips.length ? 'O Que Fazer' : 'Nada a Fazer por Enquanto'}</h3>
        {!tips.length && <p className="text-sm text-zinc-500">Não achei gargalo nem ajuste pendente. Seu PC está bem resolvido.</p>}
        <ol className="space-y-3">
          {tips.map((t) => (
            <li key={t.id} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${KIND[t.kind].cls}`}>{KIND[t.kind].label}</span>
                <h4 className="font-medium">{t.title}</h4>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t.text}</p>
              {t.action && <UpgradePicks action={t.action} />}
              {t.action && (
                <button
                  onClick={() => onUpgrade(t.action!)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-accent-950 hover:bg-accent-400"
                >
                  {t.action.label} <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>

      <p className="text-xs text-zinc-500">
        O equilíbrio é uma estimativa para jogos, a partir de uma tabela de desempenho aproximado e do seu monitor. Jogos diferentes pesam mais no processador ou na placa de vídeo.
      </p>
      {importModal}
    </div>
  );
}

/** Medidor de equilíbrio: onde o PC está entre "processador limita" e "placa de vídeo limita". */
function Meter({ ratio }: { ratio: number }) {
  const left = pos(CPU_BOUND) * 100;
  const right = pos(GPU_BOUND) * 100;
  const at = pos(ratio) * 100;
  return (
    <div className="mt-5" role="img" aria-label={`Equilíbrio: ${ratio < CPU_BOUND ? 'processador limita' : ratio > GPU_BOUND ? 'placa de vídeo limita' : 'equilibrado'}`}>
      <div className="relative h-2.5">
        <div className="absolute inset-0 flex gap-0.5 overflow-hidden rounded-full">
          <div className="h-full bg-amber-500/40" style={{ width: `${left}%` }} />
          <div className="h-full bg-emerald-500/40" style={{ width: `${right - left}%` }} />
          <div className="h-full flex-1 bg-amber-500/40" />
        </div>
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-accent-500 shadow dark:border-zinc-900"
          style={{ left: `${at}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 text-xs text-zinc-500">
        <span>Processador limita</span>
        <span className="text-center">Equilibrado</span>
        <span className="text-right">Placa de vídeo limita</span>
      </div>
    </div>
  );
}
