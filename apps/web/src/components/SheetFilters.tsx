import { formatSheetValue, type CategoryId, type Offer, type SheetField } from '@upgradezin/shared';
import { applyFilters, sheetOnlyFields, sheetValues, type Filters } from '../filters.ts';
import { Check, Pill, Section, toggle } from './ui.tsx';

/** Número com mais valores que isto no resultado vira faixa (de / até) em vez de botões. */
const MAX_PILLS = 12;

/**
 * Filtros da ficha técnica: um por campo da ficha da categoria que não tem filtro próprio no painel.
 * Valores e contagens saem da ficha das ofertas do resultado (a contagem de cada campo desconsidera o
 * próprio filtro); campo sem nenhum valor no resultado não aparece.
 */
export function SheetFilters({ category, offers, filters: f, onChange }: { category: CategoryId; offers: Offer[]; filters: Filters; onChange: (f: Filters) => void }) {
  const fields = sheetOnlyFields(category);
  return (
    <>
      {fields.map((field) => (
        <SheetFieldFilter key={field.key} field={field} offers={applyFilters(offers, f, `sheet:${field.key}`)} filters={f} onChange={onChange} />
      ))}
    </>
  );
}

function SheetFieldFilter({ field, offers, filters: f, onChange }: { field: SheetField; offers: Offer[]; filters: Filters; onChange: (f: Filters) => void }) {
  const counts = new Map<string, number>();
  for (const o of offers) for (const v of new Set(sheetValues(o, field))) counts.set(v, (counts.get(v) ?? 0) + 1);
  const selected = f.sheet[field.key] ?? [];
  const range = f.sheetRange[field.key] ?? {};
  const numeric = field.type === 'int' || field.type === 'real';
  const values = [...new Set([...counts.keys(), ...selected])];
  if (!values.length && range.min == null && range.max == null) return null;
  const title = field.unit && numeric ? `${field.label} (${field.unit})` : field.label;

  const pick = (v: string) => onChange({ ...f, sheet: { ...f.sheet, [field.key]: toggle(selected, v) } });

  if (numeric) {
    const nums = values.map(Number).filter(Number.isFinite);
    // Muitos valores (comprimento, clock, altura…): faixa de / até.
    if (nums.length > MAX_PILLS || range.min != null || range.max != null) {
      const setRange = (patch: { min?: number; max?: number }) => onChange({ ...f, sheetRange: { ...f.sheetRange, [field.key]: { ...range, ...patch } } });
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      return (
        <Section title={title} hint={nums.length ? `de ${formatSheetValue(field, lo)} a ${formatSheetValue(field, hi)} nos resultados` : undefined}>
          <div className="flex items-center gap-2">
            <NumberInput placeholder="De" value={range.min} onChange={(min) => setRange({ min })} />
            <span className="text-zinc-400">–</span>
            <NumberInput placeholder="Até" value={range.max} onChange={(max) => setRange({ max })} />
          </div>
        </Section>
      );
    }
    return (
      <Section title={field.label}>
        <div className="flex flex-wrap gap-1">
          {values
            .sort((a, b) => Number(a) - Number(b))
            .map((v) => (
              <Pill key={v} active={selected.includes(v)} muted={!counts.get(v)} onClick={() => pick(v)}>
                {formatSheetValue(field, Number(v))}
                <span className="ml-1 opacity-60">{counts.get(v) ?? 0}</span>
              </Pill>
            ))}
        </div>
      </Section>
    );
  }

  // Texto, lista e sim/não: caixas, os mais comuns primeiro.
  const sorted = values.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, 'pt-BR', { numeric: true }));
  return (
    <Section title={title}>
      <div className="max-h-48 overflow-y-auto pr-1">
        {sorted.map((v) => (
          <Check key={v} label={v} count={counts.get(v) ?? 0} checked={selected.includes(v)} onChange={() => pick(v)} />
        ))}
      </div>
    </Section>
  );
}

function NumberInput({ value, placeholder, onChange }: { value?: number; placeholder: string; onChange: (v?: number) => void }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      placeholder={placeholder}
      className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
    />
  );
}
