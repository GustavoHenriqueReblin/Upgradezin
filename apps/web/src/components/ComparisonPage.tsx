import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Gauge, Plus, Tag, Trash2, Trophy, Wallet, X } from 'lucide-react';
import { budgetIgpuScore, CATEGORY_DEFS, cpuNeeded, cpuScore, CPU_BOUND, GPU_BOUND, gpuPerf, productPath, resolutionOf, RES_LABEL, sheetRows,
  type CategoryId, type PcProfile, type ProductPage, type SheetValues } from '@upgradezin/shared';
import { compareKeys, compareUrl, comparisonComputer, comparisonCpuCompatibility, comparisonName, fetchProduct, groupComparison, rankComparison, relativeGain, sameKeys,
  type ComparisonSort } from '../compare.ts';
import { addToCompare, clearCompare, COMPARE_LIMIT, compareSelection, removeCompare } from '../compareSelection.ts';
import { useCompareSelection } from './CompareControls.tsx';
import { countPill } from './HeaderActions.tsx';
import { brl } from '../format.ts';
import { currentPc, loadPc } from '../pc.ts';
import { loadBuild } from '../build.ts';
import { searchCategoryHref } from '../uiState.ts';
import { CatalogHeader } from './CatalogHeader.tsx';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { useCpuSheet, useGpuSheet } from '../pcAnalysis.ts';

const absent = 'Não informado';
const referenceColumn = 'border-l-2 border-accent-500/40 bg-accent-50 dark:bg-accent-500/10';
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const gain = (score?: number, reference?: number) => {
  const difference = relativeGain(score, reference);
  return difference === undefined ? absent : `${percent.format(difference)}%`;
};

const delta = (score?: number, reference?: number) => {
  const change = relativeGain(score, reference);
  if (change === undefined) return <span className="text-zinc-500">—</span>;
  return <span className={change > 0 ? 'font-semibold text-emerald-700 dark:text-emerald-300'
    : change < 0 ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-zinc-500'}>{gain(score, reference)}</span>;
};

export function ComparisonPage() {
  // Link com peças (?peca=...) diferente da seleção guardada: é uma comparação compartilhada, só para ver até a pessoa adicionar.
  // O link do cabeçalho traz a própria seleção na URL: esse não é compartilhado, e remover uma peça depois não o transforma em um.
  const [shared, setShared] = useState<string[] | null>(() => sharedFromUrl(location.search, compareSelection().map((entry) => entry.key)));
  const selection = useCompareSelection();
  const own = selection.map((entry) => entry.key);
  const viewingShared = shared !== null && !sameKeys(shared, own);
  const keys = viewingShared ? shared : own;
  const [pages, setPages] = useState<ReadonlyMap<string, ProductPage | null>>(new Map());
  const loaded = useRef(pages);
  loaded.current = pages;
  const [pc] = useState(() => currentPc(loadPc(), loadBuild()));
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>();
  const [sorts, setSorts] = useState<Partial<Record<CategoryId, ComparisonSort>>>({});
  const [notice, setNotice] = useState<string>();
  const signature = keys.join('\n');
  useEffect(() => {
    document.title = 'Comparar peças · Upgradezin';
    // A URL acompanha a seleção, para o link da barra servir de compartilhamento.
    const url = compareUrl(keys);
    if (!viewingShared && location.pathname + location.search !== url) history.replaceState(history.state, '', url);
    // Só busca o que ainda não veio: remover uma peça não recarrega as outras.
    const missing = keys.filter((key) => !loaded.current.has(key));
    if (!missing.length) return;
    const controller = new AbortController();
    void Promise.all(missing.map((key) => fetchProduct(key, controller.signal).catch(() => null))).then((found) => {
      if (controller.signal.aborted) return;
      setPages((current) => new Map([...current, ...missing.map((key, index) => [key, found[index]!] as const)]));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, viewingShared]);

  const products = keys.every((key) => pages.has(key)) ? keys.map((key) => pages.get(key) ?? null) : null;
  const available = products?.filter((page) => page !== null) ?? [];
  // A chave pedida pode diferir da chave atual do produto (recálculo); remover usa a pedida, que é a guardada.
  const requested = new Map(keys.flatMap((key) => { const page = pages.get(key); return page ? [[page, key] as const] : []; }));
  const groups = groupComparison(available);
  // Processadores e placas de vídeo sempre aparecem (são as abas com desempenho estimado); as outras só com peças.
  const tabs: CategoryId[] = [...FIXED_TABS, ...[...groups.keys()].filter((category) => !FIXED_TABS.includes(category))];
  const activeCategory = selectedCategory && tabs.includes(selectedCategory) ? selectedCategory : tabs.find((category) => groups.has(category)) ?? 'cpu';
  const searchCategory = activeCategory;
  const addHardware = (
    <a href={searchCategoryHref(searchCategory)} target="_blank" rel="noopener noreferrer" title={`Adicionar ${tabLabel(searchCategory).toLowerCase()} (abre a busca em uma nova guia)`}
      className="button-link inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-semibold hover:border-accent-500 dark:border-zinc-700">
      <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar
    </a>
  );
  // Largura pela aba aberta: colunas das peças, a da peça atual (processador ou placa de vídeo) e a dos rótulos.
  const activeCount = (groups.get(activeCategory)?.length ?? 0) + Number((activeCategory === 'cpu' && !!pc?.cpu) || (activeCategory === 'gpu' && !!pc?.gpu));
  const maxWidth = `max(64rem, ${12 * (activeCount + 1) + 2}rem + 2px)`;
  const addShared = () => {
    const skipped = addToCompare(available.map((page) => ({ key: requested.get(page) ?? page.key, category: page.category })));
    setShared(null);
    setNotice(skipped ? `${skipped} ${skipped === 1 ? 'peça ficou' : 'peças ficaram'} de fora: o limite é ${COMPARE_LIMIT} por categoria.` : undefined);
  };
  // Limpar vale só para a aba aberta: as outras categorias continuam na comparação.
  const clearActive = () => {
    if (window.confirm(`Tirar ${tabLabel(activeCategory).toLowerCase()} da comparação?`)) clearCompare(activeCategory);
  };
  return (
    <div className="min-h-screen">
      <CatalogHeader category={activeCategory} comparing />
      <main className="mx-auto w-full space-y-6 px-4 py-8" style={{ maxWidth }}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Comparar peças</h1>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">Desempenho, preço e ficha técnica lado a lado.</p>
        </div>
        {viewingShared && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-500/40 bg-accent-500/10 p-4 text-sm">
            <span>Você está vendo uma comparação compartilhada. Ela não muda a sua seleção.</span>
            <span className="flex flex-wrap gap-2">
              <button type="button" onClick={addShared} disabled={!available.length}
                className="button-link inline-flex items-center gap-2 rounded-lg accent-control px-3 font-semibold disabled:opacity-50">Adicionar à minha comparação</button>
              <button type="button" onClick={() => setShared(null)}
                className="button-link inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 font-semibold hover:border-accent-500 dark:border-zinc-700">Ver minha comparação</button>
            </span>
          </div>
        )}
        {notice && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{notice}</p>}
        {keys.length > 0 && products && available.length < keys.length && <p role="status">{available.length
          ? 'Algumas das peças selecionadas não puderam ser carregadas.' : 'Nenhuma das peças selecionadas pôde ser carregada.'}</p>}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-zinc-200 dark:border-zinc-800">
          <div role="tablist" aria-label="Categorias da comparação" className="-mb-px flex flex-wrap">
          {tabs.map((category, index) => {
            const Icon = CATEGORY_ICONS[category];
            const active = activeCategory === category;
            return (
              <button key={category} id={`tab-${category}`} role="tab" type="button" tabIndex={active ? 0 : -1}
                aria-selected={active} aria-controls={`panel-${category}`} onClick={() => setSelectedCategory(category)}
                onKeyDown={(event) => {
                  const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                  const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)
                    : direction ? tabs[(index + direction + tabs.length) % tabs.length] : undefined;
                  if (!next) return;
                  event.preventDefault();
                  setSelectedCategory(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }}
                className={`inline-flex items-center gap-2 border-b-2 px-4 text-sm font-semibold transition ${active
                  ? 'border-accent-500 text-accent-700 dark:text-accent-300'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:hover:border-zinc-600 dark:hover:text-zinc-100'}`}>
                <Icon aria-hidden="true" className="h-4 w-4" /> {tabLabel(category)} <span className={`px-1.5 text-xs ${countPill}`}>{groups.get(category)?.length ?? 0}</span>
              </button>
            );
          })}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 py-1.5">
            {(activeCategory === 'cpu' || activeCategory === 'gpu') && groups.has(activeCategory) && <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              Ordenar por
              <select value={sorts[activeCategory] ?? 'overall'} onChange={(event) => {
                const sort = event.target.value as ComparisonSort;
                setSorts((current) => ({ ...current, [activeCategory]: sort }));
              }} className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                <option value="overall">Nota geral</option>
                <option value="price">Menor preço</option>
                <option value="score">Desempenho bruto</option>
                <option value="value">Custo-benefício</option>
              </select>
            </label>}
            {addHardware}
            {!viewingShared && groups.has(activeCategory) && (
              <button type="button" onClick={clearActive} title={`Tirar ${tabLabel(activeCategory).toLowerCase()} da comparação`}
                className="button-link inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-semibold hover:border-red-500 dark:border-zinc-700">
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Limpar
              </button>
            )}
          </div>
        </div>
        {keys.length > 0 && !products ? <p role="status">Carregando a comparação…</p> : tabs.map((category) => {
          const group = groups.get(category);
          return (
            <div key={category} id={`panel-${category}`} role="tabpanel" aria-labelledby={`tab-${category}`} tabIndex={0} hidden={category !== activeCategory}>
              {group ? (
                <ComparisonGroup category={category} pages={group} pc={pc} sort={sorts[category] ?? 'overall'}
                  onRemove={viewingShared ? undefined : (page) => removeCompare(requested.get(page) ?? page.key)} />
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  Nenhum{category === 'gpu' ? 'a placa de vídeo' : ' processador'} na comparação. Use o ícone de comparação na busca ou o botão Comparar na página do produto.
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}

const FIXED_TABS: CategoryId[] = ['cpu', 'gpu'];
const tabLabel = (category: CategoryId) => (category === 'cpu' ? 'Processadores' : category === 'gpu' ? 'Placas de vídeo' : CATEGORY_DEFS[category].name);

/** Peças do link quando ele é uma comparação compartilhada; null quando não há peças na URL ou elas são a própria seleção. */
export function sharedFromUrl(search: string, own: readonly string[]): string[] | null {
  const keys = compareKeys(new URLSearchParams(search));
  return keys.length && !sameKeys(keys, own) ? keys : null;
}

function ComparisonGroup({ category, pages, pc, sort, onRemove }: {
  category: CategoryId; pages: ProductPage[]; pc: PcProfile | null; sort: ComparisonSort; onRemove?: (page: ProductPage) => void;
}) {
  const performance = category === 'cpu' || category === 'gpu';
  const { ranked, topScore, topValue, lowestPrice, bestOverall } = rankComparison(pages, sort);
  const specs = ranked.map(({ page }) => sheetRows(category, page.values));
  const names = ranked.map(({ page, specs }) => comparisonName(page, specs));
  const monitor = [...(pc?.monitors ?? [])].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  const res = resolutionOf(monitor?.width, monitor?.height);
  const hz = monitor?.maxHz;
  const cpuSheet = useCpuSheet(performance ? pc?.cpu?.specs.cpuModel : undefined);
  const gpuSheet = useGpuSheet(category === 'gpu' ? pc?.gpu?.specs.gpuModel : undefined, pc?.gpu?.specs.vram);
  const computer = pc && performance ? comparisonComputer(pc, res, hz, cpuSheet) : null;
  const currentCpu = cpuScore(pc?.cpu?.specs, cpuSheet);
  // Coluna da peça atual: processador ou placa de vídeo dedicada do PC informado.
  const currentPart = category === 'cpu' ? pc?.cpu : category === 'gpu' ? pc?.gpu : undefined;
  const known = (values: Record<string, string | number | undefined>) =>
    Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string | number] => entry[1] !== undefined));
  const currentSpecs = currentPart && (category === 'cpu'
    ? sheetRows('cpu', { ...cpuSheet, ...known({ model: currentPart.specs.cpuModel, socket: currentPart.specs.socket, cores: currentPart.specs.cores, threads: currentPart.specs.threads }) } satisfies SheetValues)
    // O que o CPU-Z mediu vale sobre o catálogo (modelo, VRAM e tipo de memória); o resto vem da ficha do chip.
    : sheetRows('gpu', { ...gpuSheet, ...known({ chip: currentPart.specs.gpuModel, vramGb: currentPart.specs.vram, memType: currentPart.specs.vramType }) } satisfies SheetValues));
  const currentLabel = category === 'cpu' ? 'Seu processador atual' : 'Sua placa de vídeo atual';
  const currentGpu = gpuPerf(pc?.gpu?.specs);
  const currentIntegrated = !pc?.gpu && pc?.cpu ? budgetIgpuScore(pc.cpu.specs) : undefined;
  const currentScore = category === 'cpu' ? currentCpu : currentGpu;
  const compatibility = pc && category === 'cpu' ? ranked.map(({ specs }) => comparisonCpuCompatibility(pc, specs)) : undefined;
  const currentName = category === 'cpu' ? pc?.cpu?.title : pc?.gpu?.title ?? (currentIntegrated !== undefined ? 'Vídeo integrado' : undefined);
  const balance = (metric: typeof ranked[number]) => {
    const cpu = category === 'cpu' ? metric.score : currentCpu;
    const gpu = category === 'gpu' ? metric.score : pc?.gpu ? currentGpu : budgetIgpuScore(metric.specs, metric.page.values);
    if (cpu === undefined || gpu === undefined) return absent;
    const ratio = cpu / cpuNeeded(gpu, res, hz);
    return ratio <= CPU_BOUND ? 'Processador limita' : ratio >= GPU_BOUND ? 'Vídeo limita' : 'Equilibrado';
  };
  const rows: { label: string; description?: string; cells: ReactNode[]; current?: ReactNode }[] = [
    ...(compatibility ? [
      { label: 'Compatibilidade direta', cells: compatibility.map(({ status }) => status), current: 'Compatível' },
      { label: 'Componentes adicionais necessários', cells: compatibility.map(({ parts }) => parts), current: 'Nenhum' },
    ] : []),
    ...(performance ? [
      { label: 'Desempenho em jogos', cells: ranked.map(({ score }) => score === undefined ? absent : number.format(score)),
        current: currentScore === undefined ? absent : number.format(currentScore) },
      ...(pages.length > 1 ? [
        { label: 'Desempenho vs. alternativa mais rápida', cells: ranked.map(({ score }) => delta(score, topScore)), current: delta(currentScore, topScore) },
        { label: 'Desempenho vs. alternativa à direita', cells: ranked.map(({ score }, index) => delta(score, ranked[index + 1]?.score)) },
      ] : []),
      { label: 'Pontos por R$ 1.000', cells: ranked.map(({ value }) => value === undefined ? absent : number.format(value)) },
      ...(pages.length > 1 ? [{ label: 'Custo-benefício vs. melhor valor', cells: ranked.map(({ value }) => delta(value, topValue)) }] : []),
    ] : []),
    ...(pages.length > 1 && Number.isFinite(lowestPrice) ? [{ label: 'Preço vs. mais barata', cells: ranked.map(({ price }) => {
      const difference = relativeGain(price, lowestPrice);
      return difference === undefined ? absent : `${percent.format(difference)}%`;
    }) }] : []),
    ...(pc && performance ? [
      {
        label: category === 'cpu' ? 'Ganho estimado do processador' : 'Ganho estimado da placa de vídeo',
        description: currentName ? `vs. ${currentName}` : undefined,
        cells: ranked.map(({ score }) => delta(score, currentScore ?? (category === 'gpu' ? currentIntegrated : undefined))),
        current: 'Referência',
      },
      ...(computer ? [{
        label: 'Ganho estimado no PC em jogos',
        description: `${RES_LABEL[res]}${hz ? ` a ${hz} Hz` : ''} · troca de uma peça`,
        cells: ranked.map((part) => delta(computer.withPart(part), computer.baseline)),
        current: computer.baseline === undefined ? absent : 'Referência',
      }] : []),
      { label: `Equilíbrio no seu PC · ${RES_LABEL[res]}${hz ? ` a ${hz} Hz` : ''}`, cells: ranked.map(balance) },
    ] : []),
  ];
  const columns = <colgroup><col className="w-48" />{ranked.map(({ page }) => <col key={page.key} />)}{currentPart && <col />}</colgroup>;
  const tableWidth = { minWidth: `${12 * (ranked.length + 1 + Number(!!currentPart))}rem` };

  return (
    <section className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{performance
        ? 'Nota relativa ao grupo: 75% desempenho estimado em jogos e 25% desempenho por real. A nota requer índice e preço em estoque.'
        : 'Ordenadas pelo menor preço à vista em estoque.'}</p>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" tabIndex={0} role="region" aria-label={CATEGORY_DEFS[category].name}>
        <table className="w-full table-fixed text-sm" style={tableWidth}>
          {columns}
          <thead>
            <tr className="bg-zinc-100 text-left align-top dark:bg-zinc-800/80">
              <th scope="col" className="p-4">Classificação</th>
              {ranked.map(({ page, overall, score, value, price, best }, index) => (
                <th key={page.key} scope="col" className={`space-y-2 border-l border-zinc-200 p-4 dark:border-zinc-800 ${index === 0 ? 'bg-accent-500/10' : ''}`}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">{index + 1}º Lugar</span>
                    {onRemove && (
                      <button type="button" onClick={() => onRemove(page)} aria-label={`Remover ${names[index]} da Comparação`} title="Remover da comparação"
                        data-button-layout="compact" className="-m-1 rounded-md p-1 text-zinc-500 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700">
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                  <a href={productPath(page.key)} title={page.title} className="block break-words font-semibold hover:underline">{names[index]}</a>
                  {names[index] !== page.title && names.filter((name) => name === names[index]).length > 1 &&
                    <p className="break-words text-xs font-normal text-zinc-500">{page.title}</p>}
                  {performance && <div className="tabular-nums text-accent-800 dark:text-accent-300">
                    {overall === undefined ? <span className="text-xs font-normal text-zinc-500">Sem nota geral</span>
                      : <><span aria-label="Nota geral" className="text-2xl">{number.format(overall)}</span><span className="text-xs font-medium"> / 100</span></>}
                  </div>}
                  {best && price !== undefined
                    ? <a href={best.url} target="_blank" rel="noreferrer" className="block font-semibold tabular-nums hover:underline">{brl(price)}</a>
                    : <span className="block text-xs font-normal text-zinc-500">Sem oferta em estoque da própria loja</span>}
                  {ranked.length > 1 && <div className="flex flex-wrap gap-1.5">
                    {overall !== undefined && overall === bestOverall && <Winner icon={Trophy} tone="orange">Melhor nota</Winner>}
                    {score !== undefined && score === topScore && <Winner icon={Gauge} tone="orange">Mais rápida</Winner>}
                    {price !== undefined && price === lowestPrice && <Winner icon={Tag} tone="green">Menor preço</Winner>}
                    {value !== undefined && value === topValue && <Winner icon={Wallet} tone="green">Melhor custo-benefício</Winner>}
                  </div>}
                </th>
              ))}
              {currentPart && (
                <th scope="col" className={`space-y-2 p-4 ${referenceColumn}`}>
                  <span className="block text-xs font-semibold text-accent-800 dark:text-accent-300">{currentLabel}</span>
                  <span className="block break-words font-semibold">{currentPart.title}</span>
                  <span className="block text-xs font-normal text-zinc-600 dark:text-zinc-400">Referência do seu PC atual</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, cells, description, current }) => (
              <ComparisonRow key={label} label={label} description={description} cells={cells} ranked={ranked} current={currentPart ? current ?? '—' : undefined} />
            ))}
          </tbody>
        </table>
      </div>
      <details className="group overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
          Ficha técnica <ChevronDown aria-hidden="true" className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Ficha técnica · ${CATEGORY_DEFS[category].name}`}>
          <table className="w-full table-fixed border-t border-zinc-200 text-sm dark:border-zinc-800" style={tableWidth}>
            {columns}
            <thead className="bg-zinc-100 text-left dark:bg-zinc-800/80">
              <tr>
                <th scope="col" className="p-3">Especificação</th>
                {ranked.map(({ page }, index) => <th key={page.key} scope="col" className="break-words p-3">{names[index]}</th>)}
                {currentPart && <th scope="col" className={`p-3 ${referenceColumn}`}>{currentLabel}</th>}
              </tr>
            </thead>
            <tbody>
            {specs[0]!.map(({ key, label }, index) => (
              <ComparisonRow key={key} label={key === 'model' || key === 'chip' ? 'Modelo na ficha' : label} ranked={ranked}
                current={currentSpecs ? currentSpecs[index]?.informed ? currentSpecs[index]?.value : absent : undefined}
                cells={specs.map((sheet) => sheet[index]?.informed ? sheet[index]?.value : <span className="text-zinc-500">{absent}</span>)} />
            ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Winner({ icon: Icon, tone, children }: { icon: typeof Trophy; tone: 'orange' | 'green'; children: ReactNode }) {
  const color = tone === 'orange' ? 'bg-accent-100 text-accent-900 dark:bg-accent-500/15 dark:text-accent-200'
    : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200';
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${color}`}><Icon className="h-3.5 w-3.5 shrink-0" />{children}</span>;
}

function ComparisonRow({ label, description, cells, ranked, current }: {
  label: string; description?: string; cells: ReactNode[]; ranked: ReturnType<typeof rankComparison>['ranked']; current?: ReactNode;
}) {
  return (
    <tr className="border-t border-zinc-200 even:bg-zinc-50 dark:border-zinc-800 dark:even:bg-zinc-800/25">
      <th scope="row" className="p-3 text-left font-medium">{label}{description && <span className="block text-xs font-normal text-zinc-500">{description}</span>}</th>
      {cells.map((cell, i) => <td key={ranked[i]!.page.key} className="break-words border-l border-zinc-200 p-3 tabular-nums dark:border-zinc-800">{cell}</td>)}
      {current !== undefined && <td className={`break-words p-3 tabular-nums ${referenceColumn}`}>{current}</td>}
    </tr>
  );
}
