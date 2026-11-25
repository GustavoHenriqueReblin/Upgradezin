import {
  CATEGORY_DEFS,
  CHIPSETS,
  COOLER_TYPES,
  CPU_LINES,
  EFFICIENCY_LEVELS,
  FORM_FACTORS,
  GPU_BRANDS,
  GPU_MAKERS,
  GPU_SERIES,
  GPU_VRAM,
  MEMORY_TYPES,
  RAM_CAPACITIES,
  RAM_SPEEDS,
  RADIATORS,
  SOCKET_BRAND,
  SOCKET_MEMORY,
  SOCKETS,
  SSD_INTERFACES,
  SSD_TIERS,
  type CategoryId,
  type CpuBrand,
  type SearchOptionCounts,
  type FormFactor,
  type Socket,
} from '@upgradezin/shared';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { PSU_POWERS } from '../build.ts';
import { MODULAR_OPTS, type Filters } from '../filters.ts';
import {
  COOLER_TYPE_LABEL,
  CPU_BRAND_LABEL,
  EFF_LABEL,
  FORM_FACTOR_LABEL,
  GPU_MAKER_LABEL,
  MEMORY_LABEL,
  MODULAR_LABEL,
  SOCKET_LABEL,
  SSD_INTERFACE_LABEL,
} from '../format.ts';
import { planSearch } from '../searchPlan.ts';
import { countOf, numbersOf } from '../searchOptions.ts';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { Check, Pill, PriceInput, Section, toggle } from './ui.tsx';


interface Props {
  category: CategoryId;
  filters: Filters;
  onChange: (f: Filters) => void;
  onSearch: () => void;
  /** Presente quando já existe um resultado para voltar. */
  onBack?: () => void;
}

interface BodyProps {
  f: Filters;
  set: (patch: Partial<Filters>) => void;
  /** Produtos em estoque por opção (do servidor); null enquanto carrega ou se falhou: listas fixas, sem contagem. */
  c: SearchOptionCounts | null;
}

// ---------- Contagem das opções ----------

const optionsCache = new Map<CategoryId, SearchOptionCounts>();

/** Contagem das opções da categoria (GET /api/search/options), guardada enquanto a página está aberta. */
function useOptionCounts(category: CategoryId): SearchOptionCounts | null {
  const [counts, setCounts] = useState<SearchOptionCounts | null>(() => optionsCache.get(category) ?? null);
  useEffect(() => {
    const hit = optionsCache.get(category);
    setCounts(hit ?? null);
    if (hit) return;
    let alive = true;
    fetch(`/api/search/options?category=${category}`)
      .then((r) => (r.ok ? (r.json() as Promise<SearchOptionCounts>) : null))
      .then((c) => {
        if (!c) return;
        optionsCache.set(category, c);
        if (alive) setCounts(c);
      })
      .catch(() => {}); // sem contagem: o formulário fica com as listas fixas
    return () => {
      alive = false;
    };
  }, [category]);
  return counts;
}

/** Opção em botão com a contagem; sem produto (e não escolhida), não aparece. */
function Opt({ n, active, onClick, children }: { n: number | undefined; active: boolean; onClick: () => void; children: ReactNode }) {
  if (n === 0 && !active) return null;
  return (
    <Pill size="md" active={active} onClick={onClick}>
      {children}
      {n !== undefined && <span className="ml-1.5 text-xs opacity-60">{n}</span>}
    </Pill>
  );
}

/** Opção em caixa com a contagem; sem produto (e não marcada), não aparece. */
function OptCheck({ n, label, checked, onChange }: { n: number | undefined; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  if (n === 0 && !checked) return null;
  return <Check label={label} count={n} checked={checked} onChange={onChange} />;
}

/**
 * Passo obrigatório antes de buscar: o usuário diz o que quer e a busca nas
 * lojas fica pequena (só o que foi escolhido, não a categoria inteira).
 */
export function SearchSetup({ category, filters: f, onChange, onSearch, onBack }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const Icon = CATEGORY_ICONS[category];
  const def = CATEGORY_DEFS[category];
  const plan = planSearch(category, f);
  const Body = BODIES[category] ?? PsuBody;
  const counts = useOptionCounts(category);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-accent-600/10 p-2.5 text-accent-600 dark:text-accent-400">
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Que {def.name.toLowerCase()} você procura?</h2>
          <p className="text-sm text-zinc-500">Quanto mais específico, mais rápido o resultado.</p>
        </div>
        {onBack && (
          <button onClick={onBack} className="ml-auto text-sm text-zinc-500 hover:underline">
            Voltar ao Resultado
          </button>
        )}
      </div>

      <div className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <Body f={f} set={set} c={counts} />

        <Section title="Preço à Vista">
          <div className="flex max-w-sm items-center gap-2">
            <PriceInput placeholder="De R$" value={f.priceMin} onChange={(v) => set({ priceMin: v })} />
            <span className="text-zinc-400">–</span>
            <PriceInput placeholder="Até R$" value={f.priceMax} onChange={(v) => set({ priceMax: v })} />
          </div>
        </Section>

        <button
          onClick={onSearch}
          disabled={!plan.ready}
          className="flex w-full items-center justify-center gap-2 rounded-xl accent-control px-4 py-3 text-base font-semibold shadow-sm transition disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
        >
          <Search className="h-5 w-5" />
          {plan.label}
        </button>
      </div>
    </div>
  );
}

function PsuBody({ f, set, c }: BodyProps) {
  // "A partir de": a contagem de cada nível soma os níveis acima.
  const effFrom = (e: (typeof EFFICIENCY_LEVELS)[number]) =>
    c ? EFFICIENCY_LEVELS.slice(EFFICIENCY_LEVELS.indexOf(e)).reduce((sum, x) => sum + (countOf(c, 'efficiency', x) ?? 0), 0) : undefined;
  return (
    <>
      <Section title="Potência" hint="Escolha uma ou mais. Cada potência é buscada nas três lojas.">
        <div className="flex flex-wrap gap-2">
          {numbersOf(c, 'watts', PSU_POWERS, f.watts).map((w) => (
            <Opt key={w} n={countOf(c, 'watts', w)} active={f.watts.includes(w)} onClick={() => set({ watts: toggle(f.watts, w) })}>
              {w} W
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Eficiência Mínima">
        <div className="flex flex-wrap gap-2">
          <Pill size="md" active={!f.effMin} onClick={() => set({ effMin: undefined })}>
            Qualquer
          </Pill>
          {EFFICIENCY_LEVELS.map((e) => (
            <Opt key={e} n={effFrom(e)} active={f.effMin === e} onClick={() => set({ effMin: e })}>
              {EFF_LABEL[e]}
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Cabeamento">
        <div className="flex flex-wrap gap-x-5">
          {MODULAR_OPTS.map((m) => (
            <OptCheck key={m} n={m === 'unknown' ? undefined : countOf(c, 'modular', m)} label={MODULAR_LABEL[m]} checked={f.modular.includes(m)} onChange={() => set({ modular: toggle(f.modular, m) })} />
          ))}
        </div>
      </Section>
    </>
  );
}

function MotherboardBody({ f, set, c }: BodyProps) {
  const sockets = SOCKETS.filter((s) => f.sockets.includes(s));
  // Só os tipos de memória que as plataformas escolhidas aceitam (sem plataforma: todos).
  const memoryOpts = sockets.length ? MEMORY_TYPES.filter((m) => sockets.some((s) => SOCKET_MEMORY[s].includes(m))) : [...MEMORY_TYPES];
  const toggleSocket = (s: Socket) => {
    const next = toggle(f.sockets, s);
    const allowed = next.length ? MEMORY_TYPES.filter((m) => next.some((x) => SOCKET_MEMORY[x].includes(m))) : [...MEMORY_TYPES];
    set({
      sockets: next,
      // Chipsets e memória que não cabem mais nas plataformas escolhidas saem.
      chipsets: f.chipsets.filter((c) => next.some((x) => CHIPSETS[x].includes(c))),
      memory: f.memory.filter((m) => allowed.includes(m)),
    });
  };
  return (
    <>
      <Section title="Plataforma" hint="A mesma do seu processador. Pode escolher mais de uma, ou nenhuma e buscar só pela memória.">
        <div className="flex flex-wrap gap-2">
          {SOCKETS.map((s) => (
            <Opt key={s} n={countOf(c, 'socket', s)} active={f.sockets.includes(s)} onClick={() => toggleSocket(s)}>
              {SOCKET_LABEL[s]}
            </Opt>
          ))}
        </div>
      </Section>

      {sockets.length > 0 && (
        <Section title="Chipset" hint="Escolha um ou mais, ou deixe em branco para todas da plataforma (mais demorado).">
          <div className="space-y-2">
            {sockets.map((s) => (
              <div key={s} className="flex flex-wrap items-center gap-2">
                {sockets.length > 1 && <span className="w-20 shrink-0 text-xs font-semibold text-zinc-500">{SOCKET_LABEL[s]}</span>}
                {CHIPSETS[s].map((x) => (
                  <Opt key={x} n={countOf(c, 'chipset', x)} active={f.chipsets.includes(x)} onClick={() => set({ chipsets: toggle(f.chipsets, x) })}>
                    {x}
                  </Opt>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-6 sm:grid-cols-3">
        <Section title="Formato">
          {(['mini-itx', 'matx', 'atx'] as FormFactor[]).map((ff) => (
            <OptCheck key={ff} n={countOf(c, 'formFactor', ff)} label={FORM_FACTOR_LABEL[ff]} checked={f.formFactors.includes(ff)} onChange={() => set({ formFactors: toggle(f.formFactors, ff) })} />
          ))}
        </Section>
        <Section title="Memória">
          {memoryOpts.length === 1 ? (
            <div className="py-0.5 text-zinc-500">{MEMORY_LABEL[memoryOpts[0]!]} (única {sockets.length > 1 ? 'destas plataformas' : 'desta plataforma'})</div>
          ) : (
            memoryOpts.map((m) => (
              <OptCheck key={m} n={countOf(c, 'memory', m)} label={MEMORY_LABEL[m]} checked={f.memory.includes(m)} onChange={() => set({ memory: toggle(f.memory, m) })} />
            ))
          )}
        </Section>
        <Section title="Conexão">
          <Check label="Com Wi-Fi" checked={f.wifi} onChange={(v) => set({ wifi: v })} />
        </Section>
      </div>
    </>
  );
}

function CpuBody({ f, set, c }: BodyProps) {
  const socket = f.sockets[0];
  const brands: CpuBrand[] = socket ? [SOCKET_BRAND[socket]] : ['amd', 'intel'];
  return (
    <>
      <Section title="Plataforma" hint="A mesma da sua placa-mãe. Opcional se escolher a linha.">
        <div className="flex flex-wrap gap-2">
          {SOCKETS.map((s) => (
            <Opt
              key={s}
              n={countOf(c, 'socket', s)}
              active={socket === s}
              onClick={() => {
                const next = socket === s ? undefined : s;
                // Linhas de outro fabricante não cabem no socket escolhido.
                const lines = next ? f.cpuLines.filter((l) => CPU_LINES[SOCKET_BRAND[next]].includes(l)) : f.cpuLines;
                set({ sockets: next ? [next] : [], cpuLines: lines });
              }}
            >
              {SOCKET_LABEL[s]}
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Linha" hint="Escolha uma ou mais. Cada linha é buscada nas três lojas.">
        <div className="space-y-2">
          {brands.map((b) => (
            <div key={b} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-zinc-500">{CPU_BRAND_LABEL[b]}</span>
              {CPU_LINES[b].map((l) => (
                <Opt key={l} n={countOf(c, 'cpuLine', l)} active={f.cpuLines.includes(l)} onClick={() => set({ cpuLines: toggle(f.cpuLines, l) })}>
                  {l}
                </Opt>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Extras">
        <div className="flex flex-wrap gap-x-5">
          <Check label="Com Vídeo Integrado" checked={f.igpu} onChange={(v) => set({ igpu: v })} />
          <Check label="Com Cooler" checked={f.cooler} onChange={(v) => set({ cooler: v })} />
          <Check label="Desbloqueado para Overclock" checked={f.unlocked} onChange={(v) => set({ unlocked: v })} />
        </div>
      </Section>
    </>
  );
}

function GpuBody({ f, set, c }: BodyProps) {
  const series = GPU_SERIES.filter((s) => f.gpuMakers.includes(s.maker));
  return (
    <>
      <Section title="Fabricante do Chip" hint="Escolha um ou mais. Cada fabricante é buscado nas três lojas.">
        <div className="flex flex-wrap gap-2">
          {GPU_MAKERS.map((m) => (
            <Opt
              key={m}
              n={countOf(c, 'gpuMaker', m)}
              active={f.gpuMakers.includes(m)}
              onClick={() => {
                const makers = toggle(f.gpuMakers, m);
                // Tira séries de fabricantes que saíram da seleção.
                const allowed = new Set(GPU_SERIES.filter((s) => makers.includes(s.maker)).map((s) => s.series));
                set({ gpuMakers: makers, gpuSeries: f.gpuSeries.filter((x) => allowed.has(x)) });
              }}
            >
              {GPU_MAKER_LABEL[m]}
            </Opt>
          ))}
        </div>
      </Section>

      {series.length > 0 && (
        <Section title="Série" hint="Opcional. Sem série, aparecem todas do fabricante.">
          <div className="flex flex-wrap gap-2">
            {series.map((s) => (
              <Opt key={s.series} n={countOf(c, 'gpuSeries', s.series)} active={f.gpuSeries.includes(s.series)} onClick={() => set({ gpuSeries: toggle(f.gpuSeries, s.series) })}>
                {s.label}
              </Opt>
            ))}
          </div>
        </Section>
      )}

      <Section title="Memória de Vídeo" hint="Opcional.">
        <div className="flex flex-wrap gap-2">
          {numbersOf(c, 'vram', GPU_VRAM, f.vram).map((v) => (
            <Opt key={v} n={countOf(c, 'vram', v)} active={f.vram.includes(v)} onClick={() => set({ vram: toggle(f.vram, v) })}>
              {v} GB
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Marca" hint="Opcional. O resultado mostra todas as marcas encontradas.">
        <div className="flex flex-wrap gap-2">
          {gpuBrands(c, f.brands).map((b) => (
            <Opt key={b} n={countOf(c, 'brand', b)} active={f.brands.includes(b)} onClick={() => set({ brands: toggle(f.brands, b) })}>
              {b}
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Extras">
        <Check label="Low Profile (Gabinete Fino)" checked={f.lowProfile} onChange={(v) => set({ lowProfile: v })} />
      </Section>
    </>
  );
}

/** Marcas de placa de vídeo: com contagem, as que mais têm produto (até 14); sem, a lista das mais vendidas. */
function gpuBrands(c: SearchOptionCounts | null, selected: string[]): string[] {
  if (!c?.brand) return GPU_BRANDS;
  const top = Object.entries(c.brand)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([b]) => b);
  return [...new Set([...top, ...selected])];
}

function RamBody({ f, set, c }: BodyProps) {
  const type = f.memory.length === 1 ? f.memory[0] : undefined;
  return (
    <>
      <Section title="Tipo" hint="O mesmo que a sua placa-mãe aceita.">
        <div className="flex flex-wrap gap-2">
          {MEMORY_TYPES.map((m) => (
            <Opt key={m} n={countOf(c, 'memory', m)} active={type === m} onClick={() => set({ memory: type === m ? [] : [m], ramSpeed: [] })}>
              {MEMORY_LABEL[m]}
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Capacidade Total" hint="Escolha uma ou mais. Em kit, é a soma dos pentes (2x 8 GB = 16 GB).">
        <div className="flex flex-wrap gap-2">
          {(type ? numbersOf(c, 'capacity', RAM_CAPACITIES, f.ramCapacity, `${type}:`) : RAM_CAPACITIES).map((cap) => (
            <Opt key={cap} n={type ? countOf(c, 'capacity', `${type}:${cap}`) : undefined} active={f.ramCapacity.includes(cap)} onClick={() => set({ ramCapacity: toggle(f.ramCapacity, cap) })}>
              {cap} GB
            </Opt>
          ))}
        </div>
      </Section>

      {type && (
        <Section title="Frequência" hint="Opcional. Confira a máxima que a sua placa-mãe aceita.">
          <div className="flex flex-wrap gap-2">
            {numbersOf(c, 'speed', RAM_SPEEDS[type], f.ramSpeed, `${type}:`).map((v) => (
              <Opt key={v} n={countOf(c, 'speed', `${type}:${v}`)} active={f.ramSpeed.includes(v)} onClick={() => set({ ramSpeed: toggle(f.ramSpeed, v) })}>
                {v} MHz
              </Opt>
            ))}
          </div>
        </Section>
      )}

      <Section title="Pentes">
        <div className="flex flex-wrap gap-x-5">
          <OptCheck n={countOf(c, 'modules', 1)} label="1 Pente" checked={f.ramModules.includes(1)} onChange={() => set({ ramModules: toggle(f.ramModules, 1) })} />
          <OptCheck n={countOf(c, 'modules', 2)} label="Kit com 2 (Dual Channel)" checked={f.ramModules.includes(2)} onChange={() => set({ ramModules: toggle(f.ramModules, 2) })} />
        </div>
      </Section>
    </>
  );
}

function SsdBody({ f, set, c }: BodyProps) {
  return (
    <>
      <Section title="Interface" hint="NVMe (plaquinha M.2) é bem mais rápido; SATA usa cabo e serve em qualquer PC. Escolha uma ou as duas.">
        <div className="flex flex-wrap gap-2">
          {SSD_INTERFACES.map((i) => (
            <Opt key={i} n={countOf(c, 'ssdInterface', i)} active={f.ssdInterfaces.includes(i)} onClick={() => set({ ssdInterfaces: toggle(f.ssdInterfaces, i) })}>
              {SSD_INTERFACE_LABEL[i]}
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Capacidade" hint="Opcional.">
        <div className="flex flex-wrap gap-2">
          {SSD_TIERS.map((t) => (
            <Opt key={t.value} n={countOf(c, 'ssdTier', t.value)} active={f.ssdCapacity.includes(t.value)} onClick={() => set({ ssdCapacity: toggle(f.ssdCapacity, t.value) })}>
              {t.label}
            </Opt>
          ))}
        </div>
      </Section>
    </>
  );
}

function CoolerBody({ f, set, c }: BodyProps) {
  return (
    <>
      <Section title="Tipo" hint="Air cooler é mais simples e barato; water cooler resfria mais e ocupa espaço no gabinete. Escolha um ou os dois.">
        <div className="flex flex-wrap gap-2">
          {COOLER_TYPES.map((t) => (
            <Opt
              key={t}
              n={countOf(c, 'coolerType', t)}
              active={f.coolerTypes.includes(t)}
              onClick={() => set({ coolerTypes: toggle(f.coolerTypes, t), ...(t === 'water' && f.coolerTypes.includes('water') && { radiators: [] }) })}
            >
              {COOLER_TYPE_LABEL[t]}
            </Opt>
          ))}
        </div>
      </Section>

      {f.coolerTypes.includes('water') && (
        <Section title="Radiador do Water Cooler" hint="Opcional. Confira o que cabe no seu gabinete.">
          <div className="flex flex-wrap gap-2">
            {numbersOf(c, 'radiator', RADIATORS, f.radiators).map((r) => (
              <Opt key={r} n={countOf(c, 'radiator', r)} active={f.radiators.includes(r)} onClick={() => set({ radiators: toggle(f.radiators, r) })}>
                {r} mm
              </Opt>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function CaseBody({ f, set, c }: BodyProps) {
  return (
    <>
      <Section title="Placa-Mãe" hint="O formato da sua placa-mãe: aparecem os gabinetes onde ela cabe. Opcional.">
        <div className="flex flex-wrap gap-2">
          {FORM_FACTORS.map((ff) => (
            <Opt key={ff} n={countOf(c, 'caseFormFactor', ff)} active={f.caseFormFactors.includes(ff)} onClick={() => set({ caseFormFactors: toggle(f.caseFormFactors, ff) })}>
              {FORM_FACTOR_LABEL[ff]}
            </Opt>
          ))}
        </div>
      </Section>

      <Section title="Extras">
        <div className="flex flex-wrap gap-x-5">
          <Check label="Com Vidro" checked={f.caseGlass} onChange={(v) => set({ caseGlass: v })} />
          <Check label="Com Fans" checked={f.caseFans} onChange={(v) => set({ caseFans: v })} />
        </div>
      </Section>
    </>
  );
}

const BODIES: Partial<Record<CategoryId, ComponentType<BodyProps>>> = {
  psu: PsuBody,
  motherboard: MotherboardBody,
  cpu: CpuBody,
  gpu: GpuBody,
  ram: RamBody,
  ssd: SsdBody,
  cooler: CoolerBody,
  case: CaseBody,
};
