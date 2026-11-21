import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Gauge, RefreshCw, Wrench } from 'lucide-react';
import {
  BUILD_SLOTS,
  CATEGORY_DEFS,
  EFFICIENCY_LEVELS,
  effectiveCash,
  groupOffers,
  type BuildSlot,
  type CategoryId,
  type Offer,
  type UpgradeAction,
} from '@upgradezin/shared';
import { applySheets, checkCandidate, itemFromGroup, loadBuild, MAX_QTY, sanitizeBuild, saveBuild, sheetRequests, slotFilters, type SavedBuild } from './build.ts';
import { discountOf, SORT_LABEL } from './format.ts';
import { applyFilters, CATEGORY_SORTS, commonWords, DEFAULT_FILTERS, resetResultFilters, type Filters } from './filters.ts';
import { MAX_TERMS, planSearch } from './searchPlan.ts';
import { storeIds, storeName } from './stores.ts';
import { settleStatus, useSearch, type Fresh, type SearchSnapshot } from './useSearch.ts';
import { BuildView } from './components/BuildView.tsx';
import { loadSharedBuild, sharedIdFromUrl, type SharedBuild } from './share.ts';
import { loadUi, saveUi } from './uiState.ts';
import { applyPc, clearPc, fillPc, loadPc, savePc } from './pc.ts';
import { PcAnalysis } from './components/PcAnalysis.tsx';
import { CategoryPicker } from './components/CategoryPicker.tsx';
import { FilterPanel } from './components/FilterPanel.tsx';
import { LocalSearch } from './components/LocalSearch.tsx';
import { ProductCard } from './components/ProductCard.tsx';
import { SearchSetup } from './components/SearchSetup.tsx';

type Group = ReturnType<typeof groupOffers>[number];
/** R$ por watt; sem potência identificada vai para o fim (número grande, nunca Infinity - Infinity = NaN). */
const perWatt = (o: Offer) => (o.specs.watts ? effectiveCash(o) / o.specs.watts : Number.MAX_SAFE_INTEGER);
const effRank = (g: Group) => (g.specs.efficiency ? EFFICIENCY_LEVELS.indexOf(g.specs.efficiency) : -1);
const byPrice = (a: Group, b: Group) => effectiveCash(a.best) - effectiveCash(b.best);
/** R$ por GB de memória RAM; sem capacidade identificada vai para o fim. */
const perGb = (o: Offer) => (o.specs.ramCapacity ? effectiveCash(o) / o.specs.ramCapacity : Number.MAX_SAFE_INTEGER);
/** R$ por TB de SSD; sem capacidade identificada vai para o fim. */
const perTb = (o: Offer) => (o.specs.ssdCapacity ? effectiveCash(o) / (o.specs.ssdCapacity / 1000) : Number.MAX_SAFE_INTEGER);
/** Maior primeiro, sem valor no fim; empate pelo preço. */
const desc = (pick: (g: Group) => number | undefined) => (a: Group, b: Group) => (pick(b) ?? -1) - (pick(a) ?? -1) || byPrice(a, b);
const SORTS: Record<Filters['sort'], (a: Group, b: Group) => number> = {
  price: byPrice,
  'price-desc': (a, b) => effectiveCash(b.best) - effectiveCash(a.best),
  // Maior desconto contra o preço "de" da loja (com cupom); sem desconto no fim, empate pelo preço.
  discount: (a, b) => discountOf(b.best) - discountOf(a.best) || byPrice(a, b),
  efficiency: (a, b) => effRank(b) - effRank(a) || byPrice(a, b),
  watts: desc((g) => g.specs.watts),
  'per-watt': (a, b) => perWatt(a.best) - perWatt(b.best) || byPrice(a, b),
  cores: desc((g) => g.specs.cores),
  vram: desc((g) => g.specs.vram),
  'per-gb': (a, b) => perGb(a.best) - perGb(b.best) || byPrice(a, b),
  speed: desc((g) => g.specs.ramSpeed),
  'per-tb': (a, b) => perTb(a.best) - perTb(b.best) || byPrice(a, b),
  read: desc((g) => g.specs.ssdRead),
};

type View = 'setup' | 'results';

/** Tudo que a tela de uma categoria precisa para voltar exatamente como estava. */
interface CategoryState extends SearchSnapshot {
  view: View;
  filters: Filters;
  hasResults: boolean;
}

export function App() {
  const { offers, status, running, lastTerms, fresh, search, cancel, restore } = useSearch();
  /** Categoria e filtros da última visita (navegador): o app reabre onde estava. */
  const [initialUi] = useState(loadUi);
  const uiRef = useRef(initialUi);
  /** Busca a refazer ao abrir (lida antes de qualquer gravação desta visita). */
  const [resumeAtStart] = useState(() => {
    const c = initialUi.category;
    const s = c ? initialUi.byCategory[c] : undefined;
    return c && s?.results ? { c, filters: s.filters } : null;
  });
  const [category, setCategory] = useState<CategoryId | null>(() => uiRef.current.category ?? null);
  const [view, setView] = useState<View>('setup');
  const [filters, setFilters] = useState<Filters>(() => {
    const c = uiRef.current.category;
    return (c && uiRef.current.byCategory[c]?.filters) || DEFAULT_FILTERS;
  });
  const [showFilters, setShowFilters] = useState(false);
  const [hasResults, setHasResults] = useState(false);

  /** Montagem do PC: fica no navegador. buildSlot = escolhendo essa peça no resultado. */
  const [build, setBuild] = useState<SavedBuild>(loadBuild);
  /** PC importado do CPU-Z (Identificar Gargalo). */
  const [pc, setPc] = useState(loadPc);
  const [pcOpen, setPcOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [buildSlot, setBuildSlot] = useState<BuildSlot | null>(null);
  const [onlyCompatible, setOnlyCompatible] = useState(true);
  useEffect(() => saveBuild(build), [build]);
  // Medidas físicas (ficha técnica da loja) da placa de vídeo, do cooler e do gabinete, para conferir se cabem.
  useEffect(() => {
    const requests = sheetRequests(build);
    if (!requests.length) return;
    let alive = true;
    fetch(`/api/sheets?items=${encodeURIComponent(requests.map((r) => r.item).join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((results) => {
        if (alive && results) setBuild((b) => applySheets(b, requests, results));
      })
      .catch(() => {}); // sem resposta: tenta de novo na próxima mudança da montagem
    return () => {
      alive = false;
    };
  }, [build]);

  /** Montagem aberta por link (/m/<id>): só leitura, até "Usar Esta Montagem" ou voltar. */
  const [shared, setShared] = useState<{ id: string; state: 'loading' | 'missing' | 'error'; data?: SharedBuild } | null>(() => {
    const id = sharedIdFromUrl();
    return id ? { id, state: 'loading' } : null;
  });
  const sharedId = shared?.id;
  useEffect(() => {
    if (!sharedId) return;
    loadSharedBuild(sharedId)
      .then((data) => setShared(data ? { id: sharedId, state: 'loading', data } : { id: sharedId, state: 'missing' }))
      .catch(() => setShared({ id: sharedId, state: 'error' }));
  }, [sharedId]);
  const leaveShared = (use: boolean) => {
    if (use && shared?.data) {
      const hasOwn = BUILD_SLOTS.some((s) => build[s]);
      if (hasOwn && !window.confirm('Trocar a sua montagem atual por esta?')) return;
      setBuild(sanitizeBuild(shared.data.build));
    }
    history.replaceState(null, '', '/');
    setShared(null);
    setBuildOpen(true);
  };

  /** Cache na página: estado de cada categoria, para trocar e voltar sem buscar de novo. */
  const cacheRef = useRef(new Map<CategoryId, CategoryState>());

  // Guarda categoria e filtros a cada mudança.
  useEffect(() => {
    const ui = uiRef.current;
    ui.category = category ?? undefined;
    if (category) ui.byCategory[category] = { filters, results: hasResults && view === 'results' };
    saveUi(ui);
  }, [category, filters, hasResults, view]);

  /** Refaz a busca com os filtros guardados (do banco do servidor: na hora). */
  const resumeSearch = (c: CategoryId, f: Filters) => {
    const plan = planSearch(c, f);
    if (!plan.ready) return false;
    search(c, plan.terms, storeIds());
    setHasResults(true);
    setView('results');
    return true;
  };

  // Ao abrir o app: se a última visita estava num resultado, volta nele.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || shared) return;
    resumed.current = true;
    if (resumeAtStart) resumeSearch(resumeAtStart.c, resumeAtStart.filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCurrent = () => {
    if (!category) return;
    // Busca interrompida pela troca de categoria aparece como cancelada ao voltar.
    cacheRef.current.set(category, { offers, status: settleStatus(status), lastTerms, view, filters, hasResults });
  };

  /** Abre uma categoria (volta como estava). Com `prefill`, começa pelo formulário já preenchido. */
  const openCategory = (c: CategoryId, prefill?: Filters) => {
    if (c !== category) {
      saveCurrent();
      const saved = cacheRef.current.get(c);
      // Sem estado nesta página (ex. app reaberto): usa os filtros guardados no navegador.
      const stored = saved ? undefined : uiRef.current.byCategory[c];
      restore(saved ?? null);
      setCategory(c);
      setFilters(prefill ?? saved?.filters ?? stored?.filters ?? DEFAULT_FILTERS);
      setHasResults(saved?.hasResults ?? false);
      setView(prefill ? 'setup' : (saved?.view ?? 'setup'));
      if (!prefill && stored?.results) resumeSearch(c, stored.filters);
    } else if (prefill) {
      setFilters(prefill);
      setView('setup');
    }
    setBuildOpen(false);
    setPcOpen(false);
  };

  const pickCategory = (c: CategoryId) => {
    setBuildSlot(null);
    openCategory(c);
  };

  /** Escolher/trocar uma peça da montagem: a busca já vem filtrada pelas outras peças. */
  const openSlot = (slot: BuildSlot) => {
    const base = slot === category ? filters : (cacheRef.current.get(slot)?.filters ?? DEFAULT_FILTERS);
    setBuildSlot(slot);
    setOnlyCompatible(true);
    openCategory(slot, slotFilters(slot, build, base));
  };

  const openBuild = () => {
    setBuildSlot(null);
    setPcOpen(false);
    setBuildOpen(true);
  };

  const openAnalysis = () => {
    setBuildSlot(null);
    setBuildOpen(false);
    setPcOpen(true);
  };

  /**
   * Sugestão de upgrade: abre a busca da peça já filtrada (ex. placas de vídeo na faixa certa)
   * e roda. As peças do PC importado entram na montagem onde ela estiver vazia, para a
   * compatibilidade conferir contra o que a pessoa tem.
   */
  const openUpgrade = (action: UpgradeAction) => {
    const next = pc ? fillPc(build, pc) : build;
    setBuild(next);
    const f: Filters = { ...slotFilters(action.slot, next, DEFAULT_FILTERS), ...action.filters };
    setBuildSlot(action.slot);
    setOnlyCompatible(true);
    openCategory(action.slot, f);
    const plan = planSearch(action.slot, f);
    if (plan.ready) {
      search(action.slot, plan.terms, storeIds());
      setHasResults(true);
      setView('results');
    }
  };

  const goHome = () => {
    saveCurrent();
    restore(null);
    setCategory(null);
    setBuildOpen(false);
    setPcOpen(false);
    setBuildSlot(null);
  };

  const startSearch = () => {
    if (!category) return;
    const plan = planSearch(category, filters);
    if (!plan.ready) return;
    search(category, plan.terms, storeIds());
    // Loja volta a "todas"; a marca fica, porque o formulário pode tê-la escolhido.
    setFilters((f) => ({ ...f, stores: [] }));
    setHasResults(true);
    setView('results');
  };

  /**
   * "Buscar nas lojas" do filtro de texto: os termos da busca atual mais o texto, que vai às lojas
   * como termo próprio (na S2, que rende uma página por consulta, a página já traz o produto). O filtro de
   * texto continua, então a tela mostra o que bate com ele.
   */
  const searchText = (text: string) => {
    if (!category) return;
    const base = (lastTerms ?? []).filter((t) => t.toLowerCase() !== text.toLowerCase());
    search(category, [...base.slice(-(MAX_TERMS - 1)), text], storeIds(), true);
  };

  const filtered = useMemo(() => applyFilters(offers, filters), [offers, filters]);
  // Sugestões da busca local: nomes comuns entre o que os outros filtros deixam (sem repetir marcas, que já têm filtro).
  const suggestions = useMemo(() => {
    const pool = applyFilters(offers, filters, 'text');
    // Marca de mais de uma palavra ("Rise Mode") sai palavra por palavra.
    return commonWords(pool, 12, [...new Set(pool.flatMap((o) => (o.brand ?? '').split(/\s+/)).filter(Boolean))]);
  }, [offers, filters]);
  const hiddenByFilters = offers.length - filtered.length;
  // Só as ordenações da categoria, e só as que mudam algo: ordenar por potência com uma potência só é inútil.
  const varies = (pick: (o: Offer) => unknown) => new Set(filtered.map(pick).filter((v) => v !== undefined)).size > 1;
  const SORT_FIELD: Partial<Record<Filters['sort'], (o: Offer) => unknown>> = {
    watts: (o) => o.specs.watts,
    'per-watt': (o) => o.specs.watts,
    cores: (o) => o.specs.cores,
    vram: (o) => o.specs.vram,
    'per-gb': (o) => o.specs.ramCapacity,
    speed: (o) => o.specs.ramSpeed,
    'per-tb': (o) => o.specs.ssdCapacity,
    read: (o) => o.specs.ssdRead,
  };
  const extraSorts = (category ? CATEGORY_SORTS[category] : undefined)?.filter((s) => !SORT_FIELD[s] || varies(SORT_FIELD[s]!)) ?? [];
  const sort = filters.sort === 'price' || filters.sort === 'price-desc' || filters.sort === 'discount' || extraSorts.includes(filters.sort) ? filters.sort : 'price';
  // Depois que a busca termina, novidade que chega sozinha (GET /api/watch) não embaralha a tela:
  // os cards já mostrados ficam onde estavam (só preço e lojas mudam) e produto novo entra no fim.
  // Mudar ordenação, filtros ou buscar de novo volta à ordem normal.
  const orderRef = useRef<{ sig: string; pos: Map<string, number> } | null>(null);
  const groups = useMemo(() => {
    const sorted = groupOffers(filtered).sort(SORTS[sort]);
    const sig = JSON.stringify([sort, filters, lastTerms]);
    const prev = orderRef.current;
    // Posição de um grupo = a menor posição anterior de qualquer oferta dele (a chave do grupo muda quando outra loja entra nele).
    const at = (g: Group) => Math.min(...g.offers.map((o) => prev!.pos.get(`${o.store}:${o.storeSku}`) ?? Infinity));
    // Dois produtos novos (posição infinita) ficam na ordem normal entre si (Infinity - Infinity não é número).
    const byPrev = (a: Group, b: Group) => {
      const [x, y] = [at(a), at(b)];
      return x === y ? 0 : x - y;
    };
    const out = !running && prev?.sig === sig ? [...sorted].sort(byPrev) : sorted;
    const pos = new Map<string, number>();
    out.forEach((g, i) => g.offers.forEach((o) => pos.set(`${o.store}:${o.storeSku}`, i)));
    // Ofertas que saíram da lista continuam lembradas na mesma posição (um produto pode voltar a ter loja).
    if (prev?.sig === sig) for (const [k, v] of prev.pos) if (!pos.has(k)) pos.set(k, v);
    orderRef.current = { sig, pos };
    return out;
  }, [filtered, sort, filters, lastTerms, running]);

  // Escolhendo peça para a montagem: cada produto é checado contra as outras peças.
  // Toda categoria que é peça da montagem pode mandar o produto para ela, viesse ou não da montagem.
  // A checagem só aparece quando há outra peça para comparar.
  const choosing = buildSlot && buildSlot === category ? buildSlot : null;
  const pickSlot = category && (BUILD_SLOTS as readonly string[]).includes(category) ? (category as BuildSlot) : null;
  const hasOthers = !!pickSlot && BUILD_SLOTS.some((s) => s !== pickSlot && build[s]);
  const slot = choosing ?? (hasOthers ? pickSlot : null);
  const compat = useMemo(() => (slot ? new Map(groups.map((g) => [g.key, checkCandidate(build, slot, g.specs)])) : null), [groups, build, slot]);
  const shown = compat && onlyCompatible ? groups.filter((g) => compat.get(g.key)!.status !== 'error') : groups;
  const hiddenIncompatible = groups.length - shown.length;
  const buildCount = BUILD_SLOTS.filter((s) => build[s]).length;

  const pickPart = (g: Group) => {
    if (!pickSlot) return;
    // Trocar a memória mantém a quantidade escolhida.
    setBuild((b) => ({ ...b, [pickSlot]: { ...itemFromGroup(g), qty: b[pickSlot]?.qty } }));
    // Vindo da montagem, volta para ela; na busca comum, fica no resultado (o card mostra "Na Montagem").
    if (choosing) {
      setBuildSlot(null);
      setBuildOpen(true);
    }
  };

  const buildButton = (
    <button
      onClick={openBuild}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
        buildOpen ? 'bg-accent-500 text-accent-950' : 'border border-zinc-300 hover:border-accent-500 dark:border-zinc-700'
      }`}
    >
      <Wrench className="h-4 w-4" strokeWidth={1.75} />
      <span className="hidden sm:inline">Montagem</span>
      {buildCount > 0 && (
        <span className="tabular-nums">
          {buildCount}/{BUILD_SLOTS.length}
        </span>
      )}
    </button>
  );

  if (shared) {
    const data = shared.data;
    const when = data ? new Date(data.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex max-w-3xl items-center px-4 py-3">
            <button onClick={() => leaveShared(false)} className="text-lg font-bold tracking-tight" title="Início">
              Upgradezin<span className="text-accent-500">.</span>
            </button>
          </div>
        </header>
        <main className="px-4 py-8">
          {data ? (
            <BuildView
              build={sanitizeBuild(data.build)}
              header={
                <div className="mb-6 flex flex-wrap items-end gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Montagem Compartilhada</h2>
                    <p className="text-sm text-zinc-500">Salva em {when}. Os preços são os mais recentes que o Upgradezin tem.</p>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <button onClick={() => leaveShared(false)} className="text-sm text-zinc-500 hover:underline">
                      Ir para a Minha Montagem
                    </button>
                    <button
                      onClick={() => leaveShared(true)}
                      className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-accent-950 hover:bg-accent-400"
                    >
                      Usar Esta Montagem
                    </button>
                  </div>
                </div>
              }
            />
          ) : (
            <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-zinc-300 p-10 text-center text-zinc-500 dark:border-zinc-700">
              {shared.state === 'loading' ? 'Carregando a montagem…' : shared.state === 'missing' ? 'Esta montagem não existe ou o link está errado.' : 'Não foi possível carregar agora.'}{' '}
              {shared.state !== 'loading' && (
                <button className="font-medium text-accent-600 underline" onClick={() => leaveShared(false)}>
                  Ir para o Início
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    );
  }

  if (!category && !buildOpen && !pcOpen) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="w-full max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight">
            Upgradezin<span className="text-accent-500">.</span>
          </h1>
          <p className="mb-8 mt-1 text-zinc-500">Qual peça você quer trocar?</p>
          <CategoryPicker variant="grid" value={null} onChange={pickCategory} />
          <button
            onClick={openBuild}
            className="group mt-3 flex w-full items-center gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-left transition hover:border-accent-500 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <Wrench className="h-8 w-8 shrink-0 text-zinc-500 transition group-hover:text-accent-500" strokeWidth={1.5} />
            <span className="flex-1">
              <span className="block font-medium">Montar o PC</span>
              <span className="block text-sm text-zinc-500">Peça por peça, com a compatibilidade conferida a cada escolha.</span>
            </span>
            {buildCount > 0 && (
              <span className="text-sm tabular-nums text-zinc-500">
                {buildCount}/{BUILD_SLOTS.length} Peças
              </span>
            )}
          </button>
          <button
            onClick={openAnalysis}
            className="group mt-3 flex w-full items-center gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-left transition hover:border-accent-500 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <Gauge className="h-8 w-8 shrink-0 text-zinc-500 transition group-hover:text-accent-500" strokeWidth={1.5} />
            <span className="flex-1">
              <span className="block font-medium">Identificar Gargalo</span>
              <span className="block text-sm text-zinc-500">Importe o seu PC e veja qual peça segura o desempenho e o que vale trocar.</span>
            </span>
            {pc?.cpu && <span className="hidden text-sm text-zinc-500 sm:block">{pc.cpu.title}</span>}
          </button>
          <p className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-600">v{__APP_VERSION__}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <button onClick={goHome} className="shrink-0 text-lg font-bold tracking-tight" title="Início">
            Upgradezin<span className="text-accent-500">.</span>
          </button>
          <CategoryPicker variant="bar" value={buildOpen ? null : category} onChange={pickCategory} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {buildButton}
          </div>
        </div>
        {choosing && !buildOpen && (
          <div className="border-t border-accent-200 bg-accent-50 dark:border-accent-900 dark:bg-accent-950/40">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm text-accent-900 dark:text-accent-200">
              <button onClick={openBuild} className="flex items-center gap-1 font-medium hover:underline">
                <ArrowLeft className="h-4 w-4" /> Voltar à Montagem
              </button>
              <span>Escolhendo {CATEGORY_DEFS[choosing].name.toLowerCase()} para a montagem.</span>
            </div>
          </div>
        )}
      </header>

      {pcOpen ? (
        <main className="px-4 py-8">
          <PcAnalysis
            pc={pc}
            psu={!pc?.psu && build.psu?.current ? build.psu.specs : undefined}
            psuTitle={!pc?.psu && build.psu?.current ? build.psu.title : undefined}
            onImport={(p) => {
              savePc(p);
              setPc(p);
            }}
            onUpgrade={openUpgrade}
            onToBuild={() => {
              if (pc) setBuild((b) => applyPc(b, pc));
              openBuild();
            }}
            onForget={() => {
              clearPc();
              setPc(null);
            }}
          />
        </main>
      ) : buildOpen || !category ? (
        <main className="px-4 py-8">
          <BuildView
            build={build}
            edit={{
              onOpen: openSlot,
              onRemove: (s) =>
                setBuild((b) => {
                  const next = { ...b };
                  delete next[s];
                  return next;
                }),
              onQty: (s, qty) => setBuild((b) => (b[s] ? { ...b, [s]: { ...b[s]!, qty: Math.min(MAX_QTY, Math.max(1, qty)) } } : b)),
              onClear: () => setBuild({}),
              onImport: (pc) => {
                savePc(pc);
                setPc(pc);
                setBuild((b) => applyPc(b, pc));
              },
              onOwned: (s, owned) =>
                setBuild((b) => {
                  if (!b[s]) return b;
                  const { current: _, ...item } = b[s]!;
                  return { ...b, [s]: owned ? { ...item, current: true } : item };
                }),
            }}
          />
        </main>
      ) : view === 'setup' ? (
        <main className="px-4 py-10">
          <SearchSetup
            category={category}
            filters={filters}
            onChange={setFilters}
            onSearch={startSearch}
            onBack={hasResults ? () => setView('results') : undefined}
          />
        </main>
      ) : (
        <main className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
          <FreshNotice fresh={fresh} />
          <aside
            className={`${showFilters ? 'fixed inset-0 z-30 overflow-y-auto bg-white p-4 dark:bg-zinc-950' : 'hidden'} w-full shrink-0 md:static md:block md:w-64 md:p-0`}
          >
            <div className="mb-3 flex items-center justify-between md:hidden">
              <span className="font-semibold">Filtros</span>
              <button onClick={() => setShowFilters(false)} className="rounded bg-zinc-200 px-3 py-1 dark:bg-zinc-800">
                Ver {shown.length} Produtos
              </button>
            </div>
            <FilterPanel
              category={category}
              offers={offers}
              filters={filters}
              onChange={setFilters}
              onEditSearch={() => {
                setShowFilters(false);
                setView('setup');
              }}
            />
          </aside>

          <section className="min-w-0 flex-1">
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
              <button onClick={() => setShowFilters(true)} className="rounded-lg border border-zinc-300 px-3 py-1 md:hidden dark:border-zinc-700">
                Filtros
              </button>
              <span className="text-zinc-500">
                {shown.length} produtos · {filtered.length} ofertas
                {running && ' · chegando mais…'}
              </span>
              {running && (
                <button onClick={cancel} className="text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200">
                  Parar
                </button>
              )}
              <select
                value={sort}
                onChange={(e) => setFilters({ ...filters, sort: e.target.value as Filters['sort'] })}
                className="ml-auto rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="price">Menor Preço à Vista</option>
                <option value="price-desc">Maior Preço à Vista</option>
                <option value="discount">Maior Desconto</option>
                {extraSorts.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            {compat && (
              <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={onlyCompatible} onChange={(e) => setOnlyCompatible(e.target.checked)} className="accent-accent-600" />
                  Só Compatíveis com a Montagem
                </label>
                {onlyCompatible && hiddenIncompatible > 0 && (
                  <span className="text-zinc-500">
                    {hiddenIncompatible} {hiddenIncompatible === 1 ? 'produto incompatível escondido' : 'produtos incompatíveis escondidos'}
                  </span>
                )}
              </div>
            )}

            {offers.length > 0 && (
              <LocalSearch
                value={filters.text}
                onChange={(text) => setFilters({ ...filters, text })}
                suggestions={suggestions}
                onSearchStores={running || lastTerms?.some((t) => t.toLowerCase() === filters.text.trim().replace(/s+/g, ' ').toLowerCase()) ? undefined : searchText}
              />
            )}

            {groups.length === 0 && hiddenByFilters > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Os filtros estão escondendo {hiddenByFilters} ofertas.
                <button className="font-medium underline" onClick={() => setFilters(resetResultFilters(filters, category))}>
                  Limpar Filtros
                </button>
              </div>
            )}

            {offers.length === 0 && !running && (
              <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-zinc-500 dark:border-zinc-700">
                Nada encontrado.{' '}
                <button className="font-medium text-accent-600 underline" onClick={() => setView('setup')}>
                  Alterar Busca
                </button>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((g) => (
                <ProductCard
                  key={g.key}
                  group={g}
                  compat={compat?.get(g.key)}
                  onPick={pickSlot ? () => pickPart(g) : undefined}
                  picked={!!pickSlot && build[pickSlot]?.key === g.key}
                  replacing={!!pickSlot && !!build[pickSlot] && build[pickSlot]?.key !== g.key}
                />
              ))}
              {running && shown.length < 6 && Array.from({ length: 6 - shown.length }, (_, i) => <SkeletonCard key={`sk${i}`} />)}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex gap-3">
        <div className="h-20 w-20 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
      <div className="mt-8 h-6 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

/**
 * Aviso discreto de novidade que chegou sozinha depois da busca ("Pichau: preços novos"),
 * no canto, some em alguns segundos. Não cobre os cards nem pede clique.
 */
function FreshNotice({ fresh }: { fresh: Fresh | null }) {
  const [shown, setShown] = useState<Fresh | null>(null);
  useEffect(() => {
    if (!fresh) return setShown(null);
    setShown(fresh);
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [fresh]);
  if (!shown) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-emerald-600/40 bg-white/95 px-3.5 py-1.5 text-sm shadow-lg dark:bg-zinc-900/95"
    >
      <RefreshCw className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
      <span>
        <span className="font-medium">{storeName(shown.store)}</span>: preços atualizados agora
      </span>
    </div>
  );
}
