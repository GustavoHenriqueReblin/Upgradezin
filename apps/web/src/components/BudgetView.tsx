import { trackActivity } from '../activity.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, FileText, Loader2, Monitor, RefreshCw, Wallet } from 'lucide-react';
import { analyzePc, BUILD_SLOTS, CATEGORY_DEFS, CPU_BOUND, GPU_BOUND, productPath, type BudgetMode as PriceMode, type BudgetOption, type BudgetPlan, type BudgetProfile, type PcProfile, type Resolution } from '@upgradezin/shared';
import { BudgetError, budgetRequest, fetchPlan, formatBudget, loadBudgetResult, loadBudgetUi, NOTE_TEXT, optionHeadline, optionLabels, optionsOf, ownedBuild, parseBudget, planToBuild,
  saveBudgetResult, saveBudgetUi, stretchGain, type BudgetMode, type BudgetWorkload } from '../budget.ts';
import { CompareButton } from './CompareControls.tsx';
import { withoutPcItems } from '../pc.ts';
import type { SavedBuild } from '../build.ts';
import { brl } from '../format.ts';
import { storeName } from '../stores.ts';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { ImportPc, PcInputActions } from './ImportPc.tsx';
import { KIND, SCREEN_LABEL, useCpuSheet, VERDICT, verdictSummary } from '../pcAnalysis.ts';
import { pcSummary, PcSpecs } from './PcSpecs.tsx';
import { StoreDot } from './StoreDot.tsx';

interface Props {
  mode: BudgetMode;
  onMode: (mode: BudgetMode) => void;
  pc: PcProfile | null;
  build: SavedBuild;
  onImport: (pc: PcProfile) => void;
  onManual?: () => void;
  /** Leva o plano para a montagem (onde cada peça pode ser trocada). */
  onToBuild: (build: SavedBuild) => void;
}

const RES: { id: Resolution; label: string }[] = [
  { id: '1080p', label: 'Full HD' },
  { id: '1440p', label: 'Quad HD' },
  { id: '4k', label: '4K' },
];
const REFERENCE_DATE = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
const RESULT_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
/** Opção marcável: selecionada em laranja, como a categoria ativa, a aba aberta e as opções do resultado. */
const RADIO_CARD = 'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-200 px-3 py-2.5 transition hover:border-accent-500 has-checked:border-accent-500 has-checked:bg-accent-100 dark:border-zinc-700 dark:has-checked:bg-accent-500/15';
const PRICE_MODES = [
  { id: 'buyable', label: 'PC comprável agora', description: 'Usa preços e estoques observados nas últimas 24 horas.' },
  { id: 'ideal', label: 'PC ideal', description: 'Também considera peças sem oferta recente pelo último preço em estoque.' },
] as const;
const PROFILES = [{ id: 'games', label: 'Jogos' }, { id: 'mixed', label: 'Jogos e trabalho' }, { id: 'productivity', label: 'Produtividade' }] as const;
const WORKLOAD_OPTIONS: { id: BudgetWorkload; label: string }[] = [
  { id: 'both', label: 'Uso geral / não sei' },
  { id: 'cpu', label: 'Processamento em vários núcleos' },
  { id: 'dev', label: 'Programação e máquinas virtuais' },
  { id: 'video', label: 'Edição de vídeo' },
  { id: 'gpu', label: 'Renderização e modelagem 3D' },
  { id: 'ai', label: 'IA local' },
];

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; invalid: boolean } | { kind: 'done'; plan: BudgetPlan; owned?: SavedBuild; at: number };

/** O último resultado guardado da aba, para a tela reabrir com ele. */
const restored = (mode: BudgetMode): State => {
  const saved = loadBudgetResult(mode);
  return saved ? { kind: 'done', ...saved } : { kind: 'idle' };
};

/**
 * Montar pelo orçamento: um ponto de entrada ("quanto quer gastar?") para o PC inteiro ou o upgrade do PC
 * importado. O servidor escolhe as peças (packages/shared/src/budget.ts); o resultado vai para a montagem.
 */
export function BudgetView({ mode, onMode, pc, build, onImport, onManual, onToBuild }: Props) {
  // O que a pessoa preencheu da última vez, salvo no navegador.
  const [saved] = useState(loadBudgetUi);
  const [text, setText] = useState<Record<BudgetMode, string>>(saved.text);
  const [res, setRes] = useState<Resolution>(saved.res);
  const [fast, setFast] = useState(saved.fast);
  const [priceMode, setPriceMode] = useState<PriceMode>(saved.priceMode ?? 'buyable');
  const [profile, setProfile] = useState<BudgetProfile>(saved.profile ?? 'games');
  const [workload, setWorkload] = useState<BudgetWorkload>(saved.workload ?? 'both');
  const [state, setState] = useState<State>(() => restored(mode));
  // Trocar de aba mostra o último resultado daquela aba.
  const shownMode = useRef(mode);
  useEffect(() => {
    if (shownMode.current === mode) return;
    shownMode.current = mode;
    setState(restored(mode));
  }, [mode]);
  const pending = useRef<AbortController>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  // Ao terminar um cálculo pedido agora (não o resultado guardado), a tela desce até o resultado.
  const resultRef = useRef<HTMLDivElement>(null);
  const scrollNext = useRef(false);
  useEffect(() => {
    if (!scrollNext.current || state.kind === 'loading' || state.kind === 'idle') return;
    scrollNext.current = false;
    if (resultRef.current) scrollToResult(resultRef.current);
  }, [state]);
  const [importing, setImporting] = useState(false);
  /** Peças do PC: recolhidas por padrão (só o resumo); expandir mostra tudo. */
  const [pcOpen, setPcOpen] = useState(false);
  const budget = parseBudget(text[mode]);
  const hasUpgradeBase = !!(pc?.cpu || pc?.gpu);

  // Upgrade: desempenho atual e tela, como no Identificar gargalo (processador pela ficha do modelo).
  const cpuSheet = useCpuSheet(mode === 'upgrade' ? pc?.cpu?.specs.cpuModel : undefined);
  const owned = useMemo(() => (pc ? ownedBuild(pc, build) : undefined), [pc, build]);
  const analysis = useMemo(() => (pc ? analyzePc(pc, { psu: owned?.psu?.specs, ...(cpuSheet && { cpuSheet }) }) : undefined), [pc, owned, cpuSheet]);
  const balance = analysis?.balance;
  // O que o diagnóstico sugere: os upgrades e o que pede atenção (a pessoa vê antes de dizer o valor).
  const suggested = analysis?.tips.filter((t) => t.kind === 'upgrade' || t.kind === 'attention') ?? [];

  /** Mudar um campo invalida o resultado mostrado (e o guardado desta aba). */
  const change = (fn: () => void) => {
    pending.current?.abort();
    fn();
    setState({ kind: 'idle' });
    saveBudgetResult(mode, undefined);
  };

  const showBudget = (amount: number) => setText((values) => ({ ...values, [mode]: formatBudget(amount) }));

  /** Monta o pedido e roda; `prices` refaz com outro tipo de recomendação (ex. Comprável Agora a partir do Ideal). */
  const run = (prices: PriceMode = priceMode) => {
    if (!budget || (mode === 'upgrade' && (!hasUpgradeBase || !owned || !balance))) return;
    showBudget(budget);
    const req =
      mode === 'full'
        ? budgetRequest(budget, { res, mode: prices, profile, workload, ...(fast && { hz: 144 }) })
        : budgetRequest(budget, { res: balance!.res, hz: balance!.hz, mode: prices, profile, workload }, owned, { ...(balance!.cpu && { cpu: balance!.cpu }), ...(balance!.gpu && { gpu: balance!.gpu }) });
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ kind: 'loading' });
    scrollNext.current = true;
    fetchPlan(req, controller.signal)
      .then((plan) => {
        if (controller.signal.aborted) return;
        const result = { plan, at: Date.now(), ...(mode === 'upgrade' && { owned }) };
        setState({ kind: 'done', ...result });
        saveBudgetResult(mode, result);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: 'error', invalid: error instanceof BudgetError && error.kind === 'invalid' }); });
  };

  // Guarda a cada mudança.
  useEffect(() => saveBudgetUi({ mode, text, res, fast, priceMode, profile, workload }), [mode, text, res, fast, priceMode, profile, workload]);

  const screen = mode === 'full' ? `${SCREEN_LABEL[res]}${fast ? ' a 144 Hz' : ''}` : balance ? `${SCREEN_LABEL[balance.res]}${balance.hz && balance.hz >= 120 ? ` a ${balance.hz} Hz` : ''}` : '';
  const tab = (m: BudgetMode, label: string) => (
    <button
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        pending.current?.abort();
        onMode(m);
      }}
      className={`border-b-2 px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-accent-500 ${mode === m
        ? 'border-accent-500 text-accent-700 dark:text-accent-300'
        : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:hover:border-zinc-600 dark:hover:text-zinc-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Montar pelo orçamento</h2>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          Compare montagens e upgrades para o seu orçamento.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-2 sm:px-4 dark:border-zinc-800">
          <div role="tablist" aria-label="Tipo de montagem" className="-mb-px flex">
            {tab('full', 'PC completo')}
            {tab('upgrade', 'Upgrade do meu PC')}
          </div>
        </div>

        <div>
          <div className="min-w-0 space-y-5 p-4 sm:p-6">
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-semibold">Tipo de recomendação</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {PRICE_MODES.map(({ id, label, description }) => (
                  <label key={id} className={RADIO_CARD}>
                    <input type="radio" name="budget-price-mode" value={id} checked={priceMode === id}
                      aria-labelledby={`budget-price-${id}-label`} aria-describedby={`budget-price-${id}-help`}
                      onChange={() => change(() => setPriceMode(id))} className="mt-0.5 h-4 w-4 shrink-0 accent-accent-600" />
                    <span>
                      <span id={`budget-price-${id}-label`} className="block text-sm font-medium">{label}</span>
                      <span id={`budget-price-${id}-help`} className="mt-1 block text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-semibold">Como você usa o PC?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {PROFILES.map(({ id, label }) => (
                  <label key={id} className={RADIO_CARD}>
                    <input type="radio" name="budget-profile" value={id} checked={profile === id}
                      aria-describedby={id !== 'games' && profile === id ? 'budget-profile-help' : undefined}
                      onChange={() => change(() => setProfile(id))} className="mt-0.5 h-4 w-4 shrink-0 accent-accent-600" />
                    <span className="text-sm font-medium">{label}</span>
                  </label>
                ))}
              </div>
              {profile !== 'games' && <p id="budget-profile-help" className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {profile === 'mixed' ? 'Equilibra jogos e trabalho com vários núcleos.' : 'Prioriza tarefas que usam vários núcleos, memória e armazenamento.'}
              </p>}
            </fieldset>

            {profile !== 'games' && (
              <label className="block text-sm font-semibold">
                Tipo de trabalho
                <select value={workload} onChange={(e) => change(() => setWorkload(WORKLOAD_OPTIONS.find((o) => o.id === e.target.value)?.id ?? 'both'))}
                  className="ml-2 min-h-10 rounded-lg border border-zinc-300 bg-white px-3 font-normal dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
                  {WORKLOAD_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            )}
            {mode === 'full' ? (
              <fieldset className="min-w-0">
                <legend className="mb-2.5 text-sm font-semibold">
                  <Monitor className="mr-1.5 inline h-4 w-4 align-text-bottom text-zinc-500 dark:text-zinc-400" aria-hidden="true" /> {profile === 'productivity' ? 'Qual a resolução do monitor?' : 'Em que tela vai jogar?'}
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {RES.map((r) => (
                    <button
                      key={r.id}
                      aria-pressed={res === r.id}
                      onClick={() => change(() => setRes(r.id))}
                      className={`rounded-xl border px-2 py-2.5 text-sm transition focus-visible:outline-2 focus-visible:outline-accent-500 ${res === r.id
                        ? 'accent-control font-semibold'
                        : 'border-zinc-200 text-zinc-600 hover:border-accent-500 dark:border-zinc-700 dark:text-zinc-400'}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <label className="mt-2 flex min-h-10 w-fit cursor-pointer items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" checked={fast} onChange={(e) => change(() => setFast(e.target.checked))} className="h-4 w-4 accent-accent-600" />
                  Monitor de 144 Hz ou mais
                </label>
              </fieldset>
            ) : pc && hasUpgradeBase ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button onClick={() => setPcOpen(!pcOpen)} aria-expanded={pcOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition ${pcOpen ? '' : '-rotate-90'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-zinc-400">
                          Seu PC{screen && ` · ${screen}`}
                        </span>
                        <span className="block truncate text-sm">{pcSummary(pc, owned?.psu)}</span>
                      </span>
                    </button>
                    <button onClick={() => setImporting(true)} className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-500 hover:underline">
                      <FileText className="h-4 w-4" /> <span className="hidden sm:inline">Trocar relatório</span>
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
                Importe o relatório do CPU-Z ou marque Já tenho nas peças da sua montagem para receber sugestões de upgrade.
                <div className="mt-3">
                  <PcInputActions onImport={() => setImporting(true)} onManual={onManual} />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-6 dark:border-zinc-800 dark:bg-zinc-950/45">
            <div className="min-w-0">
              <label htmlFor="budget" className="mb-2 block text-sm font-semibold">
                {mode === 'full' ? 'Quanto você quer gastar?' : 'Quanto você quer gastar no upgrade?'}
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 focus-within:border-accent-500 dark:border-zinc-700 dark:bg-zinc-950">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">R$</span>
                <input
                  id="budget"
                  inputMode="decimal"
                  value={text[mode]}
                  onChange={(e) => change(() => setText({ ...text, [mode]: e.target.value }))}
                  onBlur={() => { if (budget !== undefined) showBudget(budget); }}
                  onKeyDown={(e) => e.key === 'Enter' && run()}
                  className="min-w-0 w-full bg-transparent py-2.5 text-2xl font-semibold tabular-nums outline-none"
                />
              </div>
            </div>

            <button
              onClick={() => run()}
              disabled={!budget || state.kind === 'loading' || (mode === 'upgrade' && !hasUpgradeBase)}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl accent-control px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {state.kind === 'loading' ? 'Montando…' : mode === 'full' ? 'Montar o PC' : 'Montar o upgrade'}
            </button>
          </div>
        </div>
      </section>

      <div ref={resultRef} className="scroll-mt-20 space-y-5">
      {state.kind === 'error' && <p role="status" className="text-sm text-red-600 dark:text-red-400">{state.invalid
        ? 'O servidor não aceitou os dados do pedido. Revise o valor e as peças do seu PC.'
        : 'Não deu para montar agora. Tente de novo em instantes.'}</p>}
      {state.kind === 'done' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
            <span>Resultado calculado em {resultDate(state.at)}.</span>
            <button type="button" onClick={() => run()} disabled={!budget}
              className="button-link inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 font-medium text-zinc-800 hover:border-accent-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100">
              <RefreshCw aria-hidden="true" className="h-4 w-4" /> Refazer cálculo
            </button>
          </div>
          <Result plan={state.plan} owned={state.owned} screen={screen} onUse={showBudget} onToBuild={onToBuild}
            onBuyable={() => { setPriceMode('buyable'); run('buyable'); }} />
        </>
      )}
      </div>

      {importing && (
        <ImportPc
          applyLabel="Usar este PC"
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

/** Leva o resultado para o topo da tela (abaixo do cabeçalho fixo), sem animação para quem pediu menos movimento. */
export function scrollToResult(el: Pick<HTMLElement, 'scrollIntoView'>): void {
  const reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** "25/11 às 14:30" */
export const resultDate = (at: number) => RESULT_DATE.format(at).replace(', ', ' às ');

function Result({ plan, owned, screen, onUse, onToBuild, onBuyable }: {
  plan: BudgetPlan; owned?: SavedBuild; screen: string; onUse: (v: number) => void; onToBuild: (b: SavedBuild) => void; onBuyable: () => void;
}) {
  const upgrade = !!owned;
  if (plan.status !== 'ok') {
    const text =
      plan.status === 'too-low'
        ? upgrade
          ? `Com ${brl(plan.budget)} não fecha um upgrade entre as combinações avaliadas. O mais barato sai por ${brl(plan.minTotal!)}.`
          : `Com ${brl(plan.budget)} não fecha um PC completo com as ofertas de agora. O mais barato que monta sai por ${brl(plan.minTotal!)}.`
        : plan.status === 'no-gain'
          ? 'Entre as ofertas avaliadas, nenhuma combinação atingiu o ganho mínimo estimado para este perfil.'
              : plan.mode === 'ideal' ? 'Faltam preços de referência para montar com este catálogo.' : 'Faltam ofertas recentes para montar agora.';
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

  return <Options plan={plan} owned={owned} screen={screen} onToBuild={onToBuild} onBuyable={onBuyable} />;
}

/**
 * As opções que fecham no orçamento (até 3), lado a lado: a 1ª é a melhor; cada outra traz outra placa de
 * vídeo (ou outro processador). Escolher uma mostra as peças dela.
 */
function Options({ plan, owned, screen, onToBuild, onBuyable }: { plan: BudgetPlan; owned?: SavedBuild; screen: string; onToBuild: (b: SavedBuild) => void; onBuyable: () => void }) {
  const options = optionsOf(plan);
  const labels = optionLabels(options);
  const [at, setAt] = useState(0);
  const opt = options[Math.min(at, options.length - 1)]!;
  return (
    <div className="space-y-3">
      {options.length > 1 && (
        <div role="group" aria-label="Opções do orçamento" className={`grid gap-2 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {options.map((o, i) => {
            const extraGain = o.stretch ? stretchGain(o, options[0]!) : undefined;
            return (
              <button
                key={i}
                data-button-layout="card"
                type="button"
                aria-pressed={i === at}
                onClick={() => {
                  if (i !== at) trackActivity({ screen: 'budget', action: 'budgetOption' });
                  setAt(i);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  i === at ? 'border-accent-500 bg-accent-500/10' : 'border-zinc-200 bg-white hover:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900'
                }`}
              >
                <span className="block text-xs font-semibold text-zinc-400">
                  Opção {i + 1}
                </span>
                {labels[i] && <span className="block text-xs font-medium text-accent-700 dark:text-accent-300">{labels[i]}</span>}
                <span className="mt-0.5 block truncate text-sm font-medium">{optionHeadline(o)}</span>
                <span className="mt-1 flex items-baseline gap-2">
                  <span className="font-semibold tabular-nums">{brl(o.total)}</span>
                  {o.gain !== undefined && <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">+{Math.round(o.gain * 100)}%</span>}
                </span>
                {o.stretch && (
                  <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
                    {brl(o.total - plan.budget)} acima do orçamento
                    {extraGain !== undefined && ` · ganho estimado de ${extraGain}% sobre a opção 1`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <OptionDetail key={at} opt={opt} first={options[0]!} n={options.length > 1 ? at + 1 : undefined} budget={plan.budget} owned={owned} screen={screen}
        profile={plan.profile ?? 'games'} onToBuild={onToBuild} onBuyable={onBuyable} />
    </div>
  );
}

function OptionDetail({ opt, first, n, budget, owned, screen, profile, onToBuild, onBuyable }: {
  opt: BudgetOption; first: BudgetOption; n?: number; budget: number; owned?: SavedBuild; screen: string; profile: BudgetProfile; onToBuild: (b: SavedBuild) => void;
  onBuyable: () => void;
}) {
  const upgrade = !!owned;
  const left = budget - opt.total;
  const extraGain = stretchGain(opt, first);
  const hasReference = Object.values(opt.parts).some((part) => part.reference);
  const costDelta = opt.total - first.total;
  const baseline = first.objective ?? first.fps;
  const perfDelta = baseline > 0 ? Math.round(((opt.objective ?? opt.fps) / baseline - 1) * 100) : undefined;
  const ratio = opt.ratio;
  const balanced = ratio !== undefined && ratio > CPU_BOUND && ratio < GPU_BOUND;
  const perf = profile !== 'games'
    ? opt.gain === undefined ? undefined : `Ganho estimado de ${Math.round(opt.gain * 100)}% para este perfil de uso.`
    : opt.notes.includes('igpu')
    ? undefined
    : upgrade && opt.gain !== undefined
      ? `Ganho estimado de ${Math.round(opt.gain * 100)}% em jogos em ${screen}${balanced ? ', com processador e placa de vídeo equilibrados' : ''}.`
      : balanced
        ? `Processador e placa de vídeo equilibrados em ${screen}.`
        : ratio !== undefined && ratio >= GPU_BOUND
          ? `Em ${screen}, a placa de vídeo tende a limitar o desempenho antes do processador.`
          : undefined;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1 border-b border-zinc-200 p-5 dark:border-zinc-800">
        <div>
          <p className="text-xs font-semibold text-zinc-400">
            {upgrade ? 'O upgrade' : 'O PC'}
            {n && ` · Opção ${n}`}
            {hasReference && ' · Preço estimado'}
          </p>
          <p className="text-2xl font-bold tabular-nums">{brl(opt.total)}</p>
        </div>
        <p className="pb-1 text-sm text-zinc-500">
          de {brl(budget)}
          {left >= 1 && ` · sobram ${brl(left)}`}
          {left < 0 && ` · ${brl(-left)} acima`}
        </p>
        {opt.stretch && (
          <p className="w-full text-sm text-amber-700 dark:text-amber-300">
            Passa {brl(-left)} do valor que você disse.
            {extraGain !== undefined && ` Ganho estimado de ${extraGain}% sobre a opção 1.`}
          </p>
        )}
        {!opt.stretch && n !== undefined && n > 1 && (
          <p className="w-full text-sm text-zinc-500">
            Em relação à primeira opção, {costDelta < 0 ? `economiza ${brl(-costDelta)}` : costDelta > 0 ? `custa ${brl(costDelta)} a mais` : 'custa o mesmo'}
            {perfDelta === undefined ? '.' : perfDelta === 0 ? ', com desempenho estimado equivalente.' : ` e rende cerca de ${Math.abs(perfDelta)}% ${perfDelta > 0 ? 'a mais' : 'a menos'} no perfil escolhido.`}
          </p>
        )}
        {perf && <p className="w-full text-sm text-emerald-700 dark:text-emerald-400">{perf}</p>}
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {BUILD_SLOTS.map((slot) => {
          const Icon = CATEGORY_ICONS[slot];
          const part = opt.parts[slot];
          const boxCooler = slot === 'cooler' && opt.notes.includes('box-cooler');
          const kept = !part && !boxCooler && owned?.[slot];
          const note =
            !part && !kept
              ? slot === 'gpu' && opt.notes.includes('igpu')
                ? 'Vídeo integrado do processador'
                : boxCooler
                  ? 'O que vem com o processador'
                  : undefined
              : undefined;
          if (!part && !kept && !note) return null;
          return (
            <li key={slot} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <Icon className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" strokeWidth={1.75} />
              <span className="hidden w-28 shrink-0 text-xs font-semibold text-zinc-400 sm:block">{CATEGORY_DEFS[slot].name}</span>
              {part?.reference ? (
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{part.qty && part.qty > 1 ? `${part.qty}x ` : ''}{part.offer.title}</span>
                    <span className="block text-xs text-zinc-500">
                      Preço histórico de {REFERENCE_DATE.format(new Date(part.reference.at))} · Sem Oferta Recente
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{brl(part.price)}</span>
                </span>
              ) : part ? (
                <a href={part.offer.productKey ? productPath(part.offer.productKey) : part.offer.url}
                  onClick={() => {
                    if (!part.offer.productKey) trackActivity({ screen: 'budget', action: 'offer', category: slot, store: part.offer.store });
                  }} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
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
              ) : null}
              {part && !part.reference && part.offer.productKey && <CompareButton category={slot} productKey={part.offer.productKey} iconOnly />}
              {part ? null : (
                <span className="min-w-0 flex-1 truncate text-zinc-500">{kept ? `Fica: ${kept.title}` : note}</span>
              )}
            </li>
          );
        })}
      </ul>

      {(opt.notes.length > 0 || opt.issues.length > 0) && (
        <ul className="space-y-1.5 border-t border-zinc-200 px-5 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {opt.notes.map((n) => (
            <li key={n}>• {NOTE_TEXT[n]}</li>
          ))}
          {opt.issues
            .filter((i) => i.code !== 'chipset-bios' || !opt.notes.includes('bios'))
            .map((i) => (
              <li key={i.code}>• {i.message}</li>
            ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 p-5 dark:border-zinc-800">
        {hasReference ? (
          <>
            <button type="button" onClick={onBuyable} className="inline-flex items-center gap-1.5 rounded-lg accent-control px-4 py-2 text-sm font-medium">
              <RefreshCw aria-hidden="true" className="h-4 w-4" /> Refazer com PC comprável agora
            </button>
            <p className="text-xs text-zinc-500">Algumas peças têm apenas preço histórico. Para levar à montagem, refaça só com ofertas de agora.</p>
          </>
        ) : (
          <>
            <button onClick={() => onToBuild(planToBuild(opt, owned && withoutPcItems(owned)))} className="inline-flex items-center gap-1.5 rounded-lg accent-control px-4 py-2 text-sm font-medium">
              Levar para a montagem <ArrowRight className="h-4 w-4" />
            </button>
            <p className="text-xs text-zinc-500">Na montagem dá para trocar as peças e conferir a compatibilidade. Os preços são à vista.</p>
          </>
        )}
      </div>
    </section>
  );
}
