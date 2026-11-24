import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Cpu, FileText, Loader2, Wallet } from 'lucide-react';
import { analyzePc, BUILD_SLOTS, CATEGORY_DEFS, CPU_BOUND, GPU_BOUND, productPath, type BudgetOption, type BudgetPlan, type PcProfile, type Resolution } from '@upgradezin/shared';
import { budgetRequest, fetchPlan, loadBudgetUi, NOTE_TEXT, optionLabels, optionsOf, ownedBuild, parseBudget, planToBuild, saveBudgetUi, type BudgetMode } from '../budget.ts';
import type { SavedBuild } from '../build.ts';
import { brl } from '../format.ts';
import { storeName } from '../stores.ts';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { ImportPc } from './ImportPc.tsx';
import { KIND, useCpuSheet, VERDICT, verdictSummary } from './PcAnalysis.tsx';
import { pcSummary, PcSpecs } from './PcSpecs.tsx';
import { StoreDot } from './StoreDot.tsx';

interface Props {
  mode: BudgetMode;
  onMode: (mode: BudgetMode) => void;
  pc: PcProfile | null;
  build: SavedBuild;
  onImport: (pc: PcProfile) => void;
  /** Leva o plano para a montagem (onde cada peça pode ser trocada). */
  onToBuild: (build: SavedBuild) => void;
}

const RES: { id: Resolution; label: string }[] = [
  { id: '1080p', label: 'Full HD' },
  { id: '1440p', label: 'Quad HD' },
  { id: '4k', label: '4K' },
];
const RES_LABEL: Record<Resolution, string> = { '1080p': 'Full HD', '1440p': 'Quad HD', '4k': '4K' };

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'done'; plan: BudgetPlan; owned?: SavedBuild };

/**
 * Montar pelo orçamento: um ponto de entrada ("quanto quer gastar?") para o PC inteiro ou o upgrade do PC
 * importado. O servidor escolhe as peças (packages/shared/src/budget.ts); o resultado vai para a montagem.
 */
export function BudgetView({ mode, onMode, pc, build, onImport, onToBuild }: Props) {
  // O que a pessoa preencheu da última vez (navegador): abre preenchido e refaz a última busca.
  const [saved] = useState(loadBudgetUi);
  const [text, setText] = useState<Record<BudgetMode, string>>(saved.text);
  const [res, setRes] = useState<Resolution>(saved.res);
  const [fast, setFast] = useState(saved.fast);
  const [ran, setRan] = useState(saved.ran);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [importing, setImporting] = useState(false);
  /** Peças do PC: recolhidas por padrão (só o resumo); expandir mostra tudo. */
  const [pcOpen, setPcOpen] = useState(false);
  const budget = parseBudget(text[mode]);

  // Upgrade: desempenho atual e tela, como no Identificar Gargalo (processador pela ficha do modelo).
  const cpuSheet = useCpuSheet(mode === 'upgrade' ? pc?.cpu?.specs.cpuModel : undefined);
  /** A ficha do processador não chegou em 1,5 s (modelo fora do catálogo ou servidor lento): segue sem ela. */
  const [sheetSettled, setSheetSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSheetSettled(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const owned = useMemo(() => (pc ? ownedBuild(pc, build) : undefined), [pc, build]);
  const analysis = useMemo(() => (pc ? analyzePc(pc, { psu: owned?.psu?.specs, ...(cpuSheet && { cpuSheet }) }) : undefined), [pc, owned, cpuSheet]);
  const balance = analysis?.balance;
  // O que o diagnóstico sugere: os upgrades e o que pede atenção (a pessoa vê antes de dizer o valor).
  const suggested = analysis?.tips.filter((t) => t.kind === 'upgrade' || t.kind === 'attention') ?? [];

  const change = (fn: () => void) => {
    fn();
    setState({ kind: 'idle' });
  };

  const run = () => {
    if (!budget || (mode === 'upgrade' && (!pc || !owned || !balance))) return;
    const req =
      mode === 'full'
        ? budgetRequest(budget, { res, ...(fast && { hz: 144 }) })
        : budgetRequest(budget, { res: balance!.res, hz: balance!.hz }, owned, { ...(balance!.cpu && { cpu: balance!.cpu }), ...(balance!.gpu && { gpu: balance!.gpu }) });
    setState({ kind: 'loading' });
    fetchPlan(req)
      .then((plan) => {
        setState({ kind: 'done', plan, ...(mode === 'upgrade' && { owned }) });
        setRan((r) => ({ ...r, [mode]: true }));
      })
      .catch(() => setState({ kind: 'error' }));
  };

  // Guarda a cada mudança.
  useEffect(() => saveBudgetUi({ mode, text, res, fast, ran }), [mode, text, res, fast, ran]);

  // Ao abrir (ou trocar de aba): se a pessoa já tinha montado nesta aba, refaz a busca com os preços de agora.
  // No upgrade, espera a ficha do processador (a nota dele muda o resultado) ou o modelo não ter ficha.
  const resumed = useRef<Partial<Record<BudgetMode, true>>>({});
  const ready = mode === 'full' || (!!balance && (cpuSheet !== undefined || !pc?.cpu?.specs.cpuModel || sheetSettled));
  useEffect(() => {
    if (resumed.current[mode] || !saved.ran[mode] || !ready || state.kind !== 'idle') return;
    resumed.current[mode] = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready]);

  const screen = mode === 'full' ? `${RES_LABEL[res]}${fast ? ' a 144 Hz' : ''}` : balance ? `${RES_LABEL[balance.res]}${balance.hz && balance.hz >= 120 ? ` a ${balance.hz} Hz` : ''}` : '';
  const tab = (m: BudgetMode, label: string) => (
    <button
      role="tab"
      aria-selected={mode === m}
      onClick={() => change(() => onMode(m))}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${mode === m ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Montar pelo Orçamento</h2>
        <p className="text-sm text-zinc-500">
          Diga quanto quer gastar. O Upgradezin escolhe as peças que mais rendem em jogos, compatíveis entre si pela ficha técnica, com o menor preço de agora.
        </p>
      </div>

      <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div role="tablist" className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-950">
          {tab('full', 'PC Completo')}
          {tab('upgrade', 'Upgrade do Meu PC')}
        </div>

        {mode === 'full' ? (
          <div>
            <span className="mb-1.5 block text-sm font-medium">Em que tela vai jogar?</span>
            <div className="flex flex-wrap items-center gap-2">
              {RES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => change(() => setRes(r.id))}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${res === r.id ? 'border-accent-500 bg-accent-500/10 font-medium' : 'border-zinc-300 hover:border-accent-500 dark:border-zinc-700'}`}
                >
                  {r.label}
                </button>
              ))}
              <label className="ml-1 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fast} onChange={(e) => change(() => setFast(e.target.checked))} className="accent-accent-600" />
                Monitor de 144 Hz ou mais
              </label>
            </div>
          </div>
        ) : pc ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button onClick={() => setPcOpen(!pcOpen)} aria-expanded={pcOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition ${pcOpen ? '' : '-rotate-90'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Seu PC{screen && ` · ${screen}`}
                    </span>
                    <span className="block truncate text-sm">{pcSummary(pc, owned?.psu)}</span>
                  </span>
                </button>
                <button onClick={() => setImporting(true)} className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-500 hover:underline">
                  <FileText className="h-4 w-4" /> <span className="hidden sm:inline">Trocar Relatório</span>
                </button>
              </div>
              {pcOpen && (
                <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
                  <PcSpecs pc={pc} psu={owned?.psu} showPsu />
                </div>
              )}
            </div>
            {balance && (
              <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950">
                <p className="font-medium">{VERDICT[balance.verdict]}</p>
                <p className="mt-0.5 text-sm text-zinc-500">{verdictSummary(pc, balance)}</p>
                {suggested.length > 0 && (
                  <ul className="mt-3 space-y-2.5">
                    {suggested.map((t) => (
                      <li key={t.id} className="text-sm">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${KIND[t.kind].cls}`}>{KIND[t.kind].label}</span>
                          <span className="font-medium">{t.title}</span>
                        </span>
                        <span className="mt-0.5 block leading-relaxed text-zinc-600 dark:text-zinc-400">{t.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-zinc-500">Com o valor que você disser, o Upgradezin escolhe a troca que mais rende, que pode ser uma destas ou uma combinação delas.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Para sugerir o upgrade, o Upgradezin precisa saber as peças do seu PC: ele lê o relatório do CPU-Z (o arquivo não sai do seu navegador).
            <div>
              <button
                onClick={() => setImporting(true)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-800 hover:border-accent-500 dark:border-zinc-700 dark:text-zinc-200"
              >
                <Cpu className="h-4 w-4" /> Importar Meu PC
              </button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="budget" className="mb-1.5 block text-sm font-medium">
            {mode === 'full' ? 'Quanto quer gastar no PC?' : 'Quanto quer gastar no upgrade?'}
          </label>
          <div className="flex w-fit items-center rounded-lg border border-zinc-300 bg-white px-3 focus-within:border-accent-500 dark:border-zinc-700 dark:bg-zinc-950">
            <span className="text-sm text-zinc-500">R$</span>
            <input
              id="budget"
              inputMode="numeric"
              value={text[mode]}
              onChange={(e) => change(() => setText({ ...text, [mode]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              className="w-28 bg-transparent px-2 py-2 text-lg font-semibold tabular-nums outline-none"
            />
          </div>
        </div>

        <button
          onClick={run}
          disabled={!budget || state.kind === 'loading' || (mode === 'upgrade' && !pc)}
          className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-accent-950 hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          {mode === 'full' ? 'Montar o PC' : 'Montar o Upgrade'}
        </button>
      </section>

      {state.kind === 'error' && <p className="text-sm text-red-600">Não deu para montar agora. Tente de novo em instantes.</p>}
      {state.kind === 'done' && <Result plan={state.plan} owned={state.owned} screen={screen} onUse={(v) => setText({ ...text, [mode]: v.toLocaleString('pt-BR') })} onToBuild={onToBuild} />}

      {importing && (
        <ImportPc
          applyLabel="Usar Este PC"
          initial={null}
          onClose={() => setImporting(false)}
          onApply={(p) => {
            onImport(p);
            setImporting(false);
            setState({ kind: 'idle' });
          }}
        />
      )}
    </div>
  );
}

function Result({ plan, owned, screen, onUse, onToBuild }: { plan: BudgetPlan; owned?: SavedBuild; screen: string; onUse: (v: number) => void; onToBuild: (b: SavedBuild) => void }) {
  const upgrade = !!owned;
  if (plan.status !== 'ok') {
    const text =
      plan.status === 'too-low'
        ? upgrade
          ? `Com ${brl(plan.budget)} não há troca que renda pelo menos 10% a mais em jogos no seu PC. O primeiro upgrade que vale custa ${brl(plan.minTotal!)} agora.`
          : `Com ${brl(plan.budget)} não fecha um PC completo com as ofertas de agora. O mais barato que monta sai por ${brl(plan.minTotal!)}.`
        : plan.status === 'no-gain'
          ? 'Seu PC já está no topo do que as lojas vendem para jogos nessa tela: nenhuma troca rende 10% a mais.'
          : 'Faltam ofertas para montar agora. Tente de novo mais tarde.';
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        {text}
        {plan.status === 'too-low' && plan.minTotal && (
          <button onClick={() => onUse(Math.ceil(plan.minTotal! / 100) * 100)} className="ml-2 font-medium underline">
            Usar {brl(Math.ceil(plan.minTotal / 100) * 100)}
          </button>
        )}
      </section>
    );
  }

  return <Options plan={plan} owned={owned} screen={screen} onToBuild={onToBuild} />;
}

/** Quanto a opção rende a mais que a 1ª, em % (para a opção acima do valor). */
const stretchGain = (o: BudgetOption, first: BudgetOption) => Math.round((o.fps / first.fps - 1) * 100);

/** Nome curto do que a opção compra de principal: placa de vídeo e processador (ou "fica a atual"). */
function headline(opt: BudgetOption): string {
  const gpu = opt.parts.gpu?.offer.specs.gpuModel ?? (opt.notes.includes('igpu') ? 'vídeo integrado' : undefined);
  const c = opt.parts.cpu?.offer.specs;
  const cpu = c ? [c.cpuLine, c.cpuModel].filter(Boolean).join(' ') : undefined;
  return [gpu, cpu].filter(Boolean).join(' + ') || 'Memória';
}

/**
 * As opções que fecham no orçamento (até 3), lado a lado: a 1ª é a melhor; cada outra traz outra placa de
 * vídeo (ou outro processador). Escolher uma mostra as peças dela.
 */
function Options({ plan, owned, screen, onToBuild }: { plan: BudgetPlan; owned?: SavedBuild; screen: string; onToBuild: (b: SavedBuild) => void }) {
  const options = optionsOf(plan);
  const labels = optionLabels(options);
  const [at, setAt] = useState(0);
  const opt = options[Math.min(at, options.length - 1)]!;
  return (
    <div className="space-y-3">
      {options.length > 1 && (
        <div role="tablist" className={`grid gap-2 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {options.map((o, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === at}
              onClick={() => setAt(i)}
              className={`rounded-xl border p-3 text-left transition ${
                i === at ? 'border-accent-500 bg-accent-500/10' : 'border-zinc-200 bg-white hover:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900'
              }`}
            >
              <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Opção {i + 1}
              </span>
              {labels[i] && <span className="block text-xs font-medium text-accent-700 dark:text-accent-300">{labels[i]}</span>}
              <span className="mt-0.5 block truncate text-sm font-medium">{headline(o)}</span>
              <span className="mt-1 flex items-baseline gap-2">
                <span className="font-semibold tabular-nums">{brl(o.total)}</span>
                {o.gain !== undefined && <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">+{Math.round(o.gain * 100)}%</span>}
              </span>
              {o.stretch && (
                <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
                  +{brl(o.total - plan.budget)} por {stretchGain(o, options[0]!)}% a mais de desempenho
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <OptionDetail key={at} opt={opt} first={options[0]!} n={options.length > 1 ? at + 1 : undefined} budget={plan.budget} owned={owned} screen={screen} onToBuild={onToBuild} />
    </div>
  );
}

function OptionDetail({ opt, first, n, budget, owned, screen, onToBuild }: { opt: BudgetOption; first: BudgetOption; n?: number; budget: number; owned?: SavedBuild; screen: string; onToBuild: (b: SavedBuild) => void }) {
  const upgrade = !!owned;
  const plan = opt;
  const left = budget - plan.total;
  const ratio = plan.ratio;
  const balanced = ratio !== undefined && ratio > CPU_BOUND && ratio < GPU_BOUND;
  const perf = plan.notes.includes('igpu')
    ? undefined
    : upgrade && plan.gain !== undefined
      ? `+${Math.round(plan.gain * 100)}% em jogos em ${screen}${balanced ? ', com processador e placa de vídeo equilibrados' : ''}.`
      : balanced
        ? `Processador e placa de vídeo equilibrados em ${screen}.`
        : ratio !== undefined && ratio >= GPU_BOUND
          ? `Sobra processador em ${screen}: dá para trocar só a placa de vídeo no próximo upgrade.`
          : undefined;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1 border-b border-zinc-200 p-5 dark:border-zinc-800">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {upgrade ? 'O Upgrade' : 'O PC'}
            {n && ` · Opção ${n}`}
          </p>
          <p className="text-2xl font-bold tabular-nums">{brl(plan.total)}</p>
        </div>
        <p className="pb-1 text-sm text-zinc-500">
          de {brl(budget)}
          {left >= 1 && ` · sobram ${brl(left)}`}
          {left < 0 && ` · ${brl(-left)} acima`}
        </p>
        {opt.stretch && (
          <p className="w-full text-sm text-amber-700 dark:text-amber-300">
            Passa {brl(-left)} do valor que você disse, para render {stretchGain(opt, first)}% a mais que a opção 1. Vale pensar se dá para esticar.
          </p>
        )}
        {perf && <p className="w-full text-sm text-emerald-700 dark:text-emerald-400">{perf}</p>}
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {BUILD_SLOTS.map((slot) => {
          const Icon = CATEGORY_ICONS[slot];
          const part = plan.parts[slot];
          const kept = !part && owned?.[slot];
          const note =
            !part && !kept
              ? slot === 'gpu' && plan.notes.includes('igpu')
                ? 'Vídeo integrado do processador'
                : slot === 'cooler' && !upgrade
                  ? 'O que vem com o processador'
                  : undefined
              : undefined;
          if (!part && !kept && !note) return null;
          return (
            <li key={slot} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <Icon className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" strokeWidth={1.75} />
              <span className="hidden w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-400 sm:block">{CATEGORY_DEFS[slot].name}</span>
              {part ? (
                <a href={part.offer.productKey ? productPath(part.offer.productKey) : part.offer.url} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {part.qty && part.qty > 1 && <span className="font-semibold">{part.qty}x </span>}
                      {part.offer.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <StoreDot store={part.offer.store} /> {storeName(part.offer.store)}
                      {part.offers.length > 1 && ` · em ${new Set(part.offers.map((o) => o.store)).size} lojas`}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{brl(part.price)}</span>
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-zinc-500">{kept ? `Fica: ${kept.title}` : note}</span>
              )}
            </li>
          );
        })}
      </ul>

      {(plan.notes.length > 0 || plan.issues.length > 0) && (
        <ul className="space-y-1.5 border-t border-zinc-200 px-5 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {plan.notes.map((n) => (
            <li key={n}>• {NOTE_TEXT[n]}</li>
          ))}
          {plan.issues
            .filter((i) => i.code !== 'chipset-bios' || !plan.notes.includes('bios'))
            .map((i) => (
              <li key={i.code}>• {i.message}</li>
            ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 p-5 dark:border-zinc-800">
        <button
          onClick={() => onToBuild(planToBuild(plan, owned))}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-accent-950 hover:bg-accent-400"
        >
          Levar para a Montagem <ArrowRight className="h-4 w-4" />
        </button>
        <p className="text-xs text-zinc-500">Na montagem dá para trocar qualquer peça, com a compatibilidade conferida a cada troca. Preços à vista com cupom, da loja mais barata.</p>
      </div>
    </section>
  );
}
