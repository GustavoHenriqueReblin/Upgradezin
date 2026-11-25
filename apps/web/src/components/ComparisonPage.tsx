import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Gauge, Plus, Tag, Trophy, Wallet } from 'lucide-react';
import { budgetIgpuScore, CATEGORIES, CATEGORY_DEFS, cpuNeeded, cpuScore, CPU_BOUND, GPU_BOUND, gpuPerf, productPath, resolutionOf, RES_LABEL, sheetRows,
  type CategoryId, type PcProfile, type ProductPage, type SheetValues } from '@upgradezin/shared';
import { applyComparisonSelection, compareKeys, compareUrl, comparisonComputer, comparisonCpuCompatibility, comparisonName, comparisonSelectionKey,
  fetchProduct, groupComparison, rankComparison, relativeGain, type ComparisonSort } from '../compare.ts';
import { brl } from '../format.ts';
import { currentPc, loadPc } from '../pc.ts';
import { loadBuild } from '../build.ts';
import { searchCategoryHref } from '../uiState.ts';
import { CatalogHeader } from './CatalogHeader.tsx';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { useCpuSheet } from './PcAnalysis.tsx';

const absent = 'Não Informado';
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
  const [keys, setKeys] = useState(() => compareKeys(new URLSearchParams(location.search)));
  const [products, setProducts] = useState<(ProductPage | null)[] | null>(null);
  const [pc] = useState(() => currentPc(loadPc(), loadBuild()));
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>();
  const [sorts, setSorts] = useState<Partial<Record<CategoryId, ComparisonSort>>>({});
  useEffect(() => {
    const onSelection = (event: StorageEvent) => {
      if ((event.storageArea && event.storageArea !== localStorage) || !CATEGORIES.some((category) => comparisonSelectionKey(category) === event.key)) return;
      setKeys((current) => applyComparisonSelection(current, event.oldValue, event.newValue));
    };
    window.addEventListener('storage', onSelection);
    return () => window.removeEventListener('storage', onSelection);
  }, []);
  useEffect(() => {
    document.title = 'Comparar Peças · Upgradezin';
    const url = compareUrl(keys);
    if (location.pathname + location.search !== url) history.replaceState(history.state, '', url);
    if (!keys.length) {
      setProducts(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all(keys.map((key) => fetchProduct(key, controller.signal).catch(() => null))).then((pages) => {
      if (!controller.signal.aborted) setProducts(pages);
    });
    return () => controller.abort();
  }, [keys]);

  const available = products?.filter((page) => page !== null) ?? [];
  const groups = groupComparison(available);
  const categories: CategoryId[] = ['cpu', 'gpu', ...[...groups.keys()].filter((category) => category !== 'cpu' && category !== 'gpu')];
  const tabs = categories.filter((category) => groups.has(category));
  const activeCategory = selectedCategory && groups.has(selectedCategory) ? selectedCategory : tabs[0];
  const searchCategory = activeCategory ?? 'cpu';
  const addHardware = (
    <a href={searchCategoryHref(searchCategory)} target="_blank" rel="noopener noreferrer" title="Abre a busca em uma nova guia"
      className="button-link inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-semibold hover:border-accent-500 dark:border-zinc-700">
      <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar Hardware
    </a>
  );
  const widestGroup = Math.max(0, ...[...groups].map(([category, pages]) => pages.length + Number(category === 'cpu' && !!pc?.cpu)));
  const maxWidth = `max(64rem, ${12 * (widestGroup + 1) + 2}rem + 2px)`;
  return (
    <div className="min-h-screen">
      <CatalogHeader title="Comparar Peças" maxWidth={maxWidth} category={activeCategory} />
      <main className="mx-auto w-full space-y-6 px-4 py-6" style={{ maxWidth }}>
        {!keys.length ? <div className="space-y-3">
          <p>Use o ícone de comparação na busca ou o botão Comparar nas páginas de produto.</p>
          {addHardware}
        </div>
          : !products ? <p role="status">Carregando a comparação…</p>
          : !available.length ? <p role="status">Nenhuma das peças selecionadas pôde ser carregada.</p>
          : (
            <>
              {available.length < keys.length && <p role="status">Algumas das peças selecionadas não puderam ser carregadas.</p>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="tablist" aria-label="Categorias da Comparação" className="flex flex-wrap gap-2">
                {tabs.map((category, index) => {
                  const Icon = CATEGORY_ICONS[category];
                  const active = activeCategory === category;
                  const label = category === 'cpu' ? 'Processadores' : category === 'gpu' ? 'Placas de Vídeo' : CATEGORY_DEFS[category].name;
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
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${active
                        ? 'accent-control'
                        : 'border-zinc-300 bg-white hover:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-accent-500'}`}>
                      <Icon aria-hidden="true" className="h-4 w-4" /> {label} <span className="font-normal tabular-nums">{groups.get(category)?.length}</span>
                    </button>
                  );
                })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(activeCategory === 'cpu' || activeCategory === 'gpu') && <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                    Ordenar por
                    <select value={sorts[activeCategory] ?? 'overall'} onChange={(event) => {
                      const sort = event.target.value as ComparisonSort;
                      setSorts((current) => ({ ...current, [activeCategory]: sort }));
                    }} className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                      <option value="overall">Nota Geral</option>
                      <option value="price">Menor Preço</option>
                      <option value="score">Desempenho Bruto</option>
                      <option value="value">Custo-Benefício</option>
                    </select>
                  </label>}
                  {addHardware}
                </div>
              </div>
              {[...groups].map(([category, pages]) => (
                <div key={category} id={`panel-${category}`} role="tabpanel" aria-labelledby={`tab-${category}`} tabIndex={0} hidden={category !== activeCategory}>
                  <ComparisonGroup category={category} pages={pages} pc={pc} sort={sorts[category] ?? 'overall'} />
                </div>
              ))}
            </>
          )}
      </main>
    </div>
  );
}

function ComparisonGroup({ category, pages, pc, sort }: { category: CategoryId; pages: ProductPage[]; pc: PcProfile | null; sort: ComparisonSort }) {
  const performance = category === 'cpu' || category === 'gpu';
  const { ranked, topScore, topValue, lowestPrice, bestOverall } = rankComparison(pages, sort);
  const specs = ranked.map(({ page }) => sheetRows(category, page.values));
  const names = ranked.map(({ page, specs }) => comparisonName(page, specs));
  const monitor = [...(pc?.monitors ?? [])].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
  const res = resolutionOf(monitor?.width, monitor?.height);
  const hz = monitor?.maxHz;
  const cpuSheet = useCpuSheet(performance ? pc?.cpu?.specs.cpuModel : undefined);
  const computer = pc && performance ? comparisonComputer(pc, res, hz, cpuSheet) : null;
  const currentCpu = cpuScore(pc?.cpu?.specs, cpuSheet);
  const currentCpuPart = category === 'cpu' ? pc?.cpu : undefined;
  const currentSpecs = currentCpuPart && sheetRows('cpu', {
    ...cpuSheet,
    ...Object.fromEntries(Object.entries({
      model: currentCpuPart.specs.cpuModel,
      socket: currentCpuPart.specs.socket,
      cores: currentCpuPart.specs.cores,
      threads: currentCpuPart.specs.threads,
    }).filter((entry): entry is [string, string | number] => entry[1] !== undefined)),
  } satisfies SheetValues);
  const currentGpu = gpuPerf(pc?.gpu?.specs);
  const currentIntegrated = !pc?.gpu && pc?.cpu ? budgetIgpuScore(pc.cpu.specs) : undefined;
  const currentScore = category === 'cpu' ? currentCpu : currentGpu;
  const compatibility = pc && category === 'cpu' ? ranked.map(({ specs }) => comparisonCpuCompatibility(pc, specs)) : undefined;
  const currentName = category === 'cpu' ? pc?.cpu?.title : pc?.gpu?.title ?? (currentIntegrated !== undefined ? 'Vídeo Integrado' : undefined);
  const balance = (metric: typeof ranked[number]) => {
    const cpu = category === 'cpu' ? metric.score : currentCpu;
    const gpu = category === 'gpu' ? metric.score : pc?.gpu ? currentGpu : budgetIgpuScore(metric.specs, metric.page.values);
    if (cpu === undefined || gpu === undefined) return absent;
    const ratio = cpu / cpuNeeded(gpu, res, hz);
    return ratio <= CPU_BOUND ? 'Processador Limita' : ratio >= GPU_BOUND ? 'Vídeo Limita' : 'Equilibrado';
  };
  const rows: { label: string; description?: string; cells: ReactNode[]; current?: ReactNode }[] = [
    ...(compatibility ? [
      { label: 'Compatibilidade Direta', cells: compatibility.map(({ status }) => status), current: 'Compatível' },
      { label: 'Componentes Adicionais Necessários', cells: compatibility.map(({ parts }) => parts), current: 'Nenhum' },
    ] : []),
    ...(performance ? [
      { label: 'Desempenho em Jogos', cells: ranked.map(({ score }) => score === undefined ? absent : number.format(score)),
        current: currentCpu === undefined ? absent : number.format(currentCpu) },
      ...(pages.length > 1 ? [
        { label: 'Desempenho vs. Alternativa Mais Rápida', cells: ranked.map(({ score }) => delta(score, topScore)), current: delta(currentCpu, topScore) },
        { label: 'Desempenho vs. Alternativa à Direita', cells: ranked.map(({ score }, index) => delta(score, ranked[index + 1]?.score)) },
      ] : []),
      { label: 'Pontos por R$ 1.000', cells: ranked.map(({ value }) => value === undefined ? absent : number.format(value)) },
      ...(pages.length > 1 ? [{ label: 'Custo-benefício vs. Melhor Valor', cells: ranked.map(({ value }) => delta(value, topValue)) }] : []),
    ] : []),
    ...(pages.length > 1 && Number.isFinite(lowestPrice) ? [{ label: 'Preço vs. Mais Barata', cells: ranked.map(({ price }) => {
      const difference = relativeGain(price, lowestPrice);
      return difference === undefined ? absent : `${percent.format(difference)}%`;
    }) }] : []),
    ...(pc && performance ? [
      {
        label: category === 'cpu' ? 'Ganho Estimado do Processador' : 'Ganho Estimado da Placa de Vídeo',
        description: currentName ? `vs. ${currentName}` : undefined,
        cells: ranked.map(({ score }) => delta(score, currentScore ?? (category === 'gpu' ? currentIntegrated : undefined))),
        current: 'Referência',
      },
      ...(computer ? [{
        label: 'Ganho Estimado no PC em Jogos',
        description: `${RES_LABEL[res]}${hz ? ` a ${hz} Hz` : ''} · troca de uma peça`,
        cells: ranked.map((part) => delta(computer.withPart(part), computer.baseline)),
        current: computer.baseline === undefined ? absent : 'Referência',
      }] : []),
      { label: `Equilíbrio no Seu PC · ${RES_LABEL[res]}${hz ? ` a ${hz} Hz` : ''}`, cells: ranked.map(balance) },
    ] : []),
  ];
  const columns = <colgroup><col className="w-48" />{ranked.map(({ page }) => <col key={page.key} />)}{currentCpuPart && <col />}</colgroup>;
  const tableWidth = { minWidth: `${12 * (ranked.length + 1 + Number(!!currentCpuPart))}rem` };

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
                  <span className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">{index + 1}º Lugar</span>
                  <a href={productPath(page.key)} title={page.title} className="block break-words font-semibold hover:underline">{names[index]}</a>
                  {names[index] !== page.title && names.filter((name) => name === names[index]).length > 1 &&
                    <p className="break-words text-xs font-normal text-zinc-500">{page.title}</p>}
                  {performance && <div className="tabular-nums text-accent-800 dark:text-accent-300">
                    {overall === undefined ? <span className="text-xs font-normal text-zinc-500">Sem Nota Geral</span>
                      : <><span aria-label="Nota Geral" className="text-2xl">{number.format(overall)}</span><span className="text-xs font-medium"> / 100</span></>}
                  </div>}
                  {best && price !== undefined
                    ? <a href={best.url} target="_blank" rel="noreferrer" className="block font-semibold tabular-nums hover:underline">{brl(price)}</a>
                    : <span className="block text-xs font-normal text-zinc-500">Sem Oferta em Estoque da Própria Loja</span>}
                  {ranked.length > 1 && <div className="flex flex-wrap gap-1.5">
                    {overall !== undefined && overall === bestOverall && <Winner icon={Trophy} tone="orange">Melhor Nota</Winner>}
                    {score !== undefined && score === topScore && <Winner icon={Gauge} tone="orange">Mais Rápida</Winner>}
                    {price !== undefined && price === lowestPrice && <Winner icon={Tag} tone="green">Menor Preço</Winner>}
                    {value !== undefined && value === topValue && <Winner icon={Wallet} tone="green">Melhor Custo-Benefício</Winner>}
                  </div>}
                </th>
              ))}
              {currentCpuPart && (
                <th scope="col" className={`space-y-2 p-4 ${referenceColumn}`}>
                  <span className="block text-xs font-semibold text-accent-800 dark:text-accent-300">Seu Processador Atual</span>
                  <span className="block break-words font-semibold">{currentCpuPart.title}</span>
                  <span className="block text-xs font-normal text-zinc-600 dark:text-zinc-400">Referência do PC Importado</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, cells, description, current }) => (
              <ComparisonRow key={label} label={label} description={description} cells={cells} ranked={ranked} current={currentCpuPart ? current ?? '—' : undefined} />
            ))}
          </tbody>
        </table>
      </div>
      <details className="group overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
          Ficha Técnica <ChevronDown aria-hidden="true" className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Ficha Técnica · ${CATEGORY_DEFS[category].name}`}>
          <table className="w-full table-fixed border-t border-zinc-200 text-sm dark:border-zinc-800" style={tableWidth}>
            {columns}
            <thead className="bg-zinc-100 text-left dark:bg-zinc-800/80">
              <tr>
                <th scope="col" className="p-3">Especificação</th>
                {ranked.map(({ page }, index) => <th key={page.key} scope="col" className="break-words p-3">{names[index]}</th>)}
                {currentCpuPart && <th scope="col" className={`p-3 ${referenceColumn}`}>Seu Processador Atual</th>}
              </tr>
            </thead>
            <tbody>
            {specs[0]!.map(({ key, label }, index) => (
              <ComparisonRow key={key} label={key === 'model' ? 'Modelo na Ficha' : label} ranked={ranked}
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
