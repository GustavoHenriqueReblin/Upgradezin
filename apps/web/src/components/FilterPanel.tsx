import { useMemo } from 'react';
import {
  CPU_LINES,
  EFFICIENCY_LEVELS,
  effectiveCash,
  FORM_FACTORS,
  GPU_MAKERS,
  GPU_SERIES,
  MEMORY_TYPES,
  SOCKETS,
  COOLER_TYPES,
  SSD_INTERFACES,
  SSD_TIERS,
  ssdTier,
  type CategoryId,
  type FormFactor,
  type Offer,
} from '@upgradezin/shared';
import { SlidersHorizontal } from 'lucide-react';
import { applyFilters, caseFitsAll, countBy, MODULAR_OPTS, resetResultFilters, type ColorOpt, type FilterKey, type Filters, type PsuFormatOpt } from '../filters.ts';
import {
  brl,
  COLOR_LABEL,
  COOLER_TYPE_LABEL,
  EFF_LABEL,
  FORM_FACTOR_LABEL,
  GPU_MAKER_LABEL,
  MEMORY_LABEL,
  MODULAR_LABEL,
  PSU_FORMAT_LABEL,
  SOCKET_LABEL,
  SSD_INTERFACE_LABEL,
} from '../format.ts';
import { storeList } from '../stores.ts';
import { Check, Pill, PriceInput, Section, toggle } from './ui.tsx';
import { SheetFilters } from './SheetFilters.tsx';

interface Props {
  category: CategoryId;
  offers: Offer[];
  filters: Filters;
  onChange: (f: Filters) => void;
  onEditSearch: () => void;
}

/** Filtros de lista cujo campo em Filters tem o mesmo nome do predicado. */
type ListKey = Extract<
  FilterKey,
  | 'stores' | 'brands' | 'watts' | 'sockets' | 'chipsets' | 'formFactors' | 'memory'
  | 'cpuLines' | 'cpuGens' | 'cores' | 'gpuMakers' | 'gpuSeries' | 'gpuModels' | 'vram' | 'vramTypes'
  | 'ramCapacity' | 'ramModules' | 'ramSpeed' | 'ramLatency'
  | 'ssdInterfaces' | 'ssdCapacity' | 'ssdPcie' | 'coolerTypes' | 'radiators'
>;
type BoolKey = Extract<FilterKey, 'atx3' | 'pcie5' | 'wifi' | 'bluetooth' | 'igpu' | 'cooler' | 'unlocked' | 'lowProfile' | 'rgb' | 'caseGlass' | 'caseFans'>;

interface Facet<T extends string | number> {
  values: T[];
  count: (v: T) => number;
  active: (v: T) => boolean;
  toggle: (v: T) => void;
}

/** Ordem fixa (quando há) e, depois, o resto em ordem natural. */
const orderBy =
  <T extends string | number>(fixed: readonly T[] = []) =>
  (a: T, b: T) => {
    const ia = fixed.indexOf(a);
    const ib = fixed.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
  };

const GPU_SERIES_ORDER = GPU_SERIES.map((s) => s.series);
const SSD_TIER_LABEL = Object.fromEntries(SSD_TIERS.map((t) => [t.value, t.label])) as Record<number, string>;
const CPU_LINE_ORDER = [...CPU_LINES.amd, ...CPU_LINES.intel];

/**
 * Filtros sobre o resultado já buscado (não refazem a busca). Valores e
 * contagens saem das próprias ofertas: marca, modelo ou frequência nova aparece sozinha.
 * A contagem de cada filtro desconsidera o próprio filtro (como nas lojas).
 */
export function FilterPanel({ category, offers, filters: f, onChange, onEditSearch }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const base = (k: FilterKey) => applyFilters(offers, f, k);

  function list<T extends string | number>(key: ListKey, pick: (o: Offer) => T | undefined, fixed?: readonly T[]): Facet<T> {
    const counts = countBy(base(key), pick);
    const selected = f[key] as T[];
    const values = [...new Set([...counts.keys(), ...selected])].sort(orderBy(fixed));
    return {
      values,
      count: (v) => counts.get(v) ?? 0,
      active: (v) => selected.includes(v),
      toggle: (v) => set({ [key]: toggle(selected, v) } as Partial<Filters>),
    };
  }
  const boolCount = (key: BoolKey, has: (o: Offer) => boolean) => base(key).filter(has).length;
  const bool = (key: BoolKey, label: string, has: (o: Offer) => boolean) => (
    <Check label={label} count={boolCount(key, has)} checked={f[key]} onChange={(v) => set({ [key]: v } as Partial<Filters>)} />
  );

  const priceRange = useMemo(() => {
    const prices = applyFilters(offers, f, 'price').map(effectiveCash);
    return prices.length ? ([Math.min(...prices), Math.max(...prices)] as const) : null;
  }, [offers, f]);

  const effCounts = countBy(base('eff'), (o) => o.specs.efficiency);
  const modularCounts = countBy(base('modular'), (o) => o.specs.modular ?? 'unknown');
  const psuFormat = countBy(base('psuFormat'), (o): PsuFormatOpt => (o.specs.sfx ? 'sfx' : 'atx'));
  const colors = countBy(base('colors'), (o): ColorOpt => (o.specs.white ? 'white' : 'black'));
  const brands = list('brands', (o) => o.brand);
  brands.values.sort((a, b) => brands.count(b) - brands.count(a));
  const stores = list('stores', (o) => o.store);

  return (
    <div className="space-y-5 text-sm">
      <button
        onClick={onEditSearch}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent-600 px-3 py-2 font-medium text-accent-700 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-950/40"
      >
        <SlidersHorizontal className="h-4 w-4" />
        Alterar Busca
      </button>

      <div className="flex items-center justify-between">
        <span className="font-semibold">Refinar Resultado</span>
        <button className="text-xs text-zinc-500 hover:underline" onClick={() => onChange(resetResultFilters(f, category))}>
          Limpar
        </button>
      </div>

      <Section title="Preço à Vista">
        <div className="flex items-center gap-2">
          <PriceInput placeholder="De R$" value={f.priceMin} onChange={(v) => set({ priceMin: v })} />
          <span className="text-zinc-400">–</span>
          <PriceInput placeholder="Até R$" value={f.priceMax} onChange={(v) => set({ priceMax: v })} />
        </div>
        {priceRange && (
          <div className="mt-1 text-xs text-zinc-400">
            de {brl(priceRange[0])} a {brl(priceRange[1])} nos resultados
          </div>
        )}
      </Section>

      {category === 'psu' && (
        <>
          <Pills title="Potência" facet={list('watts', (o) => o.specs.watts)} label={(w) => `${w} W`} />

          <Section title="Eficiência Mínima">
            <div className="flex flex-wrap gap-1">
              <Pill active={!f.effMin} onClick={() => set({ effMin: undefined })}>
                Qualquer
              </Pill>
              {EFFICIENCY_LEVELS.map((e) => (
                <Pill key={e} active={f.effMin === e} onClick={() => set({ effMin: e })} muted={!effCounts.get(e)}>
                  {EFF_LABEL[e]}
                  {effCounts.get(e) ? <span className="ml-1 opacity-60">{effCounts.get(e)}</span> : null}
                </Pill>
              ))}
            </div>
          </Section>

          <Section title="Cabeamento">
            {MODULAR_OPTS.map((m) => (
              <Check
                key={m}
                label={MODULAR_LABEL[m]}
                count={modularCounts.get(m) ?? 0}
                checked={f.modular.includes(m)}
                onChange={() => set({ modular: toggle(f.modular, m) })}
              />
            ))}
          </Section>

          <Section title="Padrão">
            {bool('atx3', 'ATX 3.0 / 3.1', (o) => !!o.specs.atx)}
            {bool('pcie5', 'PCIe 5 / 12V-2x6', (o) => !!o.specs.pcie5 || !!o.specs.atx)}
          </Section>

          {/* Só aparece quando o resultado tem fonte SFX (ou o filtro já está ligado). */}
          {(psuFormat.get('sfx') || f.psuFormat.length > 0) && (
            <Section title="Formato">
              {(['atx', 'sfx'] as PsuFormatOpt[]).map((pf) => (
                <Check
                  key={pf}
                  label={PSU_FORMAT_LABEL[pf]}
                  count={psuFormat.get(pf) ?? 0}
                  checked={f.psuFormat.includes(pf)}
                  onChange={() => set({ psuFormat: toggle(f.psuFormat, pf) })}
                />
              ))}
            </Section>
          )}
        </>
      )}

      {category === 'motherboard' && (
        <>
          <Pills title="Chipset" facet={list('chipsets', (o) => o.specs.chipset)} />
          <Checks title="Formato" facet={list('formFactors', (o) => o.specs.formFactor, FORM_FACTORS)} label={(v) => FORM_FACTOR_LABEL[v]} />
          <Checks title="Memória" facet={list('memory', (o) => o.specs.memory, MEMORY_TYPES)} label={(v) => MEMORY_LABEL[v]} />
          <Section title="Conexão">
            {bool('wifi', 'Com Wi-Fi', (o) => !!o.specs.wifi)}
            {bool('bluetooth', 'Com Bluetooth', (o) => !!o.specs.bluetooth)}
          </Section>
        </>
      )}

      {category === 'cpu' && (
        <>
          <Pills title="Linha" facet={list('cpuLines', (o) => o.specs.cpuLine, CPU_LINE_ORDER)} />
          <Checks title="Plataforma" facet={list('sockets', (o) => o.specs.socket, SOCKETS)} label={(v) => SOCKET_LABEL[v]} />
          <Pills title="Geração" facet={list('cpuGens', (o) => o.specs.cpuGen)} />
          <Pills title="Núcleos" facet={list('cores', (o) => o.specs.cores)} />
          <Section title="Recursos">
            {bool('igpu', 'Com Vídeo Integrado', (o) => o.specs.igpu === true)}
            {bool('cooler', 'Com Cooler', (o) => o.specs.cooler === true)}
            {bool('unlocked', 'Desbloqueado para Overclock', (o) => o.specs.unlocked === true)}
          </Section>
        </>
      )}

      {category === 'gpu' && (
        <>
          <Checks title="Fabricante do Chip" facet={list('gpuMakers', (o) => o.specs.gpuMaker, GPU_MAKERS)} label={(v) => GPU_MAKER_LABEL[v]} />
          <Pills title="Série" facet={list('gpuSeries', (o) => o.specs.gpuSeries, GPU_SERIES_ORDER)} />
          <Pills title="Modelo" facet={list('gpuModels', (o) => o.specs.gpuModel)} />
          <Pills title="Memória de Vídeo" facet={list('vram', (o) => o.specs.vram)} label={(v) => `${v} GB`} />
          <Checks title="Tipo de Memória" facet={list('vramTypes', (o) => o.specs.vramType)} />
          <Section title="Formato">{bool('lowProfile', 'Low Profile (Gabinete Fino)', (o) => !!o.specs.lowProfile)}</Section>
        </>
      )}

      {category === 'ram' && (
        <>
          <Checks title="Tipo" facet={list('memory', (o) => o.specs.memory, MEMORY_TYPES)} label={(v) => MEMORY_LABEL[v]} />
          <Pills title="Capacidade Total" facet={list('ramCapacity', (o) => o.specs.ramCapacity)} label={(v) => `${v} GB`} />
          <Checks title="Pentes" facet={list('ramModules', (o) => o.specs.ramModules)} label={(n) => (n === 1 ? '1 Pente' : `Kit com ${n}`)} />
          <Pills title="Frequência" facet={list('ramSpeed', (o) => o.specs.ramSpeed)} label={(v) => `${v} MHz`} />
          <Pills title="Latência" facet={list('ramLatency', (o) => o.specs.ramLatency)} label={(v) => `CL${v}`} />
        </>
      )}

      {category === 'ssd' && (
        <>
          <Checks title="Interface" facet={list('ssdInterfaces', (o) => o.specs.ssdInterface, SSD_INTERFACES)} label={(v) => SSD_INTERFACE_LABEL[v]} />
          <Pills title="Capacidade" facet={list('ssdCapacity', (o) => ssdTier(o.specs.ssdCapacity), SSD_TIERS.map((t) => t.value))} label={(v) => SSD_TIER_LABEL[v] ?? `${v} GB`} />
          <Pills title="Geração PCIe" facet={list('ssdPcie', (o) => o.specs.ssdPcie)} label={(v) => `PCIe ${v}.0`} />
        </>
      )}

      {category === 'cooler' && (
        <>
          <Checks title="Tipo" facet={list('coolerTypes', (o) => o.specs.coolerType, COOLER_TYPES)} label={(v) => COOLER_TYPE_LABEL[v]} />
          <Pills title="Radiador" facet={list('radiators', (o) => o.specs.radiator)} label={(v) => `${v} mm`} />
        </>
      )}

      {category === 'case' && (
        <>
          <Section title="Placa-Mãe que Cabe">
            {FORM_FACTORS.map((ff: FormFactor) => (
              <Check
                key={ff}
                label={FORM_FACTOR_LABEL[ff]}
                count={base('caseFormFactors').filter((o) => caseFitsAll(o.specs.caseFormFactor, [ff])).length}
                checked={f.caseFormFactors.includes(ff)}
                onChange={() => set({ caseFormFactors: toggle(f.caseFormFactors, ff) })}
              />
            ))}
          </Section>
          <Section title="Recursos">
            {bool('caseGlass', 'Com Vidro', (o) => !!o.specs.caseGlass)}
            {bool('caseFans', 'Com Fans', (o) => (o.specs.caseFans ?? 0) > 0)}
          </Section>
        </>
      )}

      <SheetFilters category={category} offers={offers} filters={f} onChange={onChange} />

      <Section title="Visual">
        {(['black', 'white'] as ColorOpt[]).map((c) => (
          <Check
            key={c}
            label={COLOR_LABEL[c]}
            count={colors.get(c) ?? 0}
            checked={f.colors.includes(c)}
            onChange={() => set({ colors: toggle(f.colors, c) })}
          />
        ))}
        {bool('rgb', 'Com RGB', (o) => !!o.specs.rgb)}
      </Section>

      <Section title={`Marca${f.brands.length ? ` (${f.brands.length})` : ''}`}>
        <div className="max-h-64 overflow-y-auto pr-1">
          {brands.values.map((b) => (
            <Check key={b} label={b} count={brands.count(b)} checked={brands.active(b)} onChange={() => brands.toggle(b)} />
          ))}
          {!brands.values.length && <span className="text-zinc-500">—</span>}
        </div>
      </Section>

      <Section title="Loja">
        {storeList().map((s) => (
          <Check key={s.id} label={s.name} count={stores.count(s.id)} checked={stores.active(s.id)} onChange={() => stores.toggle(s.id)} />
        ))}
      </Section>

      <Section title="Disponibilidade">
        <Check label="Só em Estoque" checked={f.inStockOnly} onChange={(v) => set({ inStockOnly: v })} />
        <Check
          label="Só com Cupom"
          count={base('coupon').filter((o) => effectiveCash(o) < o.priceCash).length}
          checked={f.couponOnly}
          onChange={(v) => set({ couponOnly: v })}
        />
        <Check label="Só Vendido pela Própria Loja" checked={f.trustedOnly} onChange={(v) => set({ trustedOnly: v })} />
      </Section>
    </div>
  );
}

/** Faceta em botões com contagem; some quando não há valores. */
function Pills<T extends string | number>({ title, facet, label = String }: { title: string; facet: Facet<T>; label?: (v: T) => string }) {
  if (!facet.values.length) return null;
  return (
    <Section title={title}>
      <div className="flex flex-wrap gap-1">
        {facet.values.map((v) => (
          <Pill key={v} active={facet.active(v)} muted={!facet.count(v)} onClick={() => facet.toggle(v)}>
            {label(v)}
            <span className="ml-1 opacity-60">{facet.count(v)}</span>
          </Pill>
        ))}
      </div>
    </Section>
  );
}

/** Faceta em caixas de seleção com contagem; some quando não há valores. */
function Checks<T extends string | number>({ title, facet, label = String }: { title: string; facet: Facet<T>; label?: (v: T) => string }) {
  if (!facet.values.length) return null;
  return (
    <Section title={title}>
      {facet.values.map((v) => (
        <Check key={v} label={label(v)} count={facet.count(v)} checked={facet.active(v)} onChange={() => facet.toggle(v)} />
      ))}
    </Section>
  );
}
