import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ExternalLink, FileSearch, FileText, Search } from 'lucide-react';
import {
  ENABLED_CATEGORIES,
  CATEGORY_DEFS,
  formatSheetValue,
  productPath,
  sheetFields,
  SHEET_FIELDS,
  webKeys,
  type AdminStoreConfig,
  type CategoryId,
  type SheetCoverageRow,
  type SheetPageText,
  type SheetProduct,
  type SheetProductPage,
  type SheetRoutineInput,
  type SheetRoutineStatus,
  type SheetFilterState,
  type SheetValueFrom,
  type SheetState,
  type StoreId,
  type StoreInterval,
} from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { Box, Table, Td } from './DataPanels.tsx';
import { countdown, fieldLabels, formatWhen, intervalLabel, SHEET_FILTER_LABEL, SHEET_STATE_LABEL, sheetEta } from './format.ts';
import { IntervalInputs } from './IntervalInputs.tsx';
import { useLiveReload } from './live.ts';
import { Pager } from './Pager.tsx';
import { Switch } from './Switch.tsx';

type Props = { onUnauthorized: () => void };
type Shared = { fail: (err: unknown) => void; onMessage: (m: { ok: boolean; text: string }) => void };

const select = 'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';
const STATE_TONE: Record<SheetState, string> = {
  complete: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  incomplete: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  unread: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
};
/** De onde veio o campo que não é da página da loja. */
const VALUE_FROM_LABEL: Record<SheetValueFrom, string> = { manual: 'manual', title: 'título', web: 'web', estimate: 'estimado', default: 'padrão' };
const pct = (x: number, total: number) => (total ? Math.round((x / total) * 100) : 0);

/**
 * Fichas técnicas: a rotina que lê as páginas dos produtos (ligar, lojas, intervalo, andamento por
 * loja), a cobertura por categoria (completas, incompletas, não lidas, campos que mais faltam) e os
 * produtos de uma categoria com os campos lidos, de onde veio cada um, o texto guardado e "Ler ficha".
 */
export function SheetsPanel({ onUnauthorized }: Props) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // '' = todas as categorias (colunas gerais: categoria e o que falta).
  const [category, setCategory] = useState<CategoryId | ''>('cpu');
  // A situação filtrada vale para todas as categorias (trocar de categoria não volta a "qualquer situação").
  const [state, setState] = useState<SheetFilterState | ''>('');
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof AdminError && err.status === 401) return onUnauthorized();
      const errors = err instanceof AdminError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : null;
      setMessage({ ok: false, text: errors?.join(' ') ?? 'Não foi possível agora.' });
    },
    [onUnauthorized],
  );
  return (
    <div className="space-y-4">
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>{message.text}</p>}
      <SheetRoutine fail={fail} onMessage={setMessage} />
      <Coverage fail={fail} onPick={setCategory} />
      <Products key={category} category={category} onCategory={setCategory} state={state} onState={setState} fail={fail} onMessage={setMessage} />
    </div>
  );
}

/** Rotina de fichas (separada da coleta): chave, lojas, intervalo de fichas de cada loja e o andamento. Atualiza ao vivo. */
function SheetRoutine({ fail, onMessage }: Shared) {
  const [status, setStatus] = useState<SheetRoutineStatus | null>(null);

  const load = useCallback(() => {
    adminApi<SheetRoutineStatus>('/sheets').then(setStatus).catch(fail);
  }, [fail]);
  useEffect(load, [load]);
  useLiveReload(['attempt', 'store', 'admin'], load, { delayMs: 2_000, fallbackMs: 15_000 });

  if (!status)
    return (
      <Box title="Rotina de fichas técnicas">
        <p className="text-sm text-zinc-500">Carregando…</p>
      </Box>
    );

  const save = (input: SheetRoutineInput, ok: string) =>
    adminApi<SheetRoutineStatus>('/sheets', { method: 'PUT', body: input })
      .then((r) => {
        setStatus(r);
        onMessage({ ok: true, text: ok });
      })
      .catch(fail);
  const saveInterval = (store: StoreId, name: string, i: StoreInterval) =>
    adminApi(`/stores/${store}/interval`, { method: 'PUT', body: { kind: 'sheet', ...i } })
      .then(() => {
        onMessage({ ok: true, text: `${name}: ${intervalLabel(i)} de produto (fichas).` });
        load();
      })
      .catch(fail);
  const toggleStore = (id: StoreId, on: boolean) => {
    const stores = on ? [...status.stores, id] : status.stores.filter((s) => s !== id);
    const name = status.progress.find((p) => p.store === id)?.name ?? id;
    void save({ stores }, `${name}: ${on ? 'entrou na' : 'saiu da'} rotina de fichas.`);
  };

  return (
    <Box
      title={
        <span className="flex flex-wrap items-center gap-3">
          Rotina de fichas técnicas
          <Switch label="Rotina de fichas" on={status.enabled} onChange={(on) => save({ enabled: on }, on ? 'Rotina de fichas ligada.' : 'Rotina de fichas parada.')} />
        </span>
      }
    >
      <p className="text-sm text-zinc-500">
        Abre, aos poucos, a página de cada produto do catálogo (todas as categorias) e lê a ficha técnica: os campos fixos de cada categoria. Cada página é lida uma vez; o texto fica guardado e é relido
        quando o leitor muda. Produto com a ficha completa por uma loja não precisa da página das outras. Primeiro o que a coleta achou há menos tempo, em estoque antes. Separada da rotina de coleta:
        divide com ela só a fila da loja, a pausa por bloqueio e o limite de páginas por hora.
      </p>
      {status.enabled && !status.stores.length && <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">Nenhuma loja marcada: as fichas não andam.</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {status.progress.map((s) => {
          const marked = status.stores.includes(s.store);
          return (
            <div key={s.store} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="flex items-center justify-between gap-2 text-sm font-medium">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={marked} disabled={!s.canRead} onChange={(e) => toggleStore(s.store, e.target.checked)} />
                  {s.name}
                </label>
                <span className="text-xs font-normal tabular-nums text-zinc-500">{s.read + s.queue ? `${pct(s.read, s.read + s.queue)}%` : '—'}</span>
              </p>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                <div className="h-full bg-emerald-500" style={{ width: `${pct(s.read, s.read + s.queue)}%` }} />
              </div>
              {!s.canRead ? (
                <p className="mt-2 text-xs text-zinc-500">Esta loja não tem leitor de ficha.</p>
              ) : (
                <div className="mt-2">
                  <IntervalInputs
                    key={`${s.interval.minS}-${s.interval.maxS}`}
                    interval={s.interval}
                    label="uma ficha a cada"
                    title="Intervalo de fichas desta loja: entre duas páginas de produto, um tempo aleatório entre os dois valores. Vale na hora. As páginas de lista têm o seu, na aba Coleta."
                    onSave={(i) => void saveInterval(s.store, s.name, i)}
                  />
                </div>
              )}
              {s.canRead && (
                <dl className="mt-2 space-y-0.5 text-xs text-zinc-500">
                  <div className="tabular-nums">
                    {s.read.toLocaleString('pt-BR')} páginas lidas · {s.queue.toLocaleString('pt-BR')} na fila
                  </div>
                  <div className="tabular-nums">
                    {s.lastHour} na última hora{s.lastAt ? ` · última ${formatWhen(s.lastAt)}` : ''}
                  </div>
                  {s.nextAt && (s.queue > 0 ? <div className="tabular-nums">Próxima: {countdown(s.nextAt)}</div> : <div>Nada a ler agora (confere produtos novos a cada minuto).</div>)}
                  {s.nextAt && s.queue > 0 && <div>No ritmo atual, faltam {sheetEta(s.queue, s.interval)}.</div>}
                  {status.enabled && !marked && <div>Fora da rotina de fichas.</div>}
                </dl>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Na fila: anúncios desta loja de produtos sem ficha completa, com a página ainda não lida (produtos vistos nas lojas nos últimos 14 dias).</p>
    </Box>
  );
}

/** Cobertura por categoria. Clicar na linha abre os produtos da categoria abaixo. */
function Coverage({ fail, onPick }: { fail: (err: unknown) => void; onPick: (c: CategoryId) => void }) {
  const [rows, setRows] = useState<SheetCoverageRow[] | null>(null);
  const load = useCallback(() => {
    adminApi<SheetCoverageRow[]>('/sheets/coverage').then(setRows).catch(fail);
  }, [fail]);
  useEffect(load, [load]);
  useLiveReload(['attempt'], load, { delayMs: 5_000, fallbackMs: 60_000 });

  return (
    <Box title="Cobertura das fichas">
      {!rows ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : (
        <Table head={['Categoria', 'Produtos', 'Completas', 'Incompletas', 'Não lidas', 'Só a web completa', 'Precisa de você', 'Campos que mais faltam']}>
          {rows.map((r) => {
            const top = Object.entries(r.missing)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4);
            return (
              <tr key={r.category} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40" onClick={() => onPick(r.category)}>
                <Td className="whitespace-nowrap font-medium">{r.name}</Td>
                <Td className="tabular-nums">{r.products.toLocaleString('pt-BR')}</Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {r.complete} <span className="text-zinc-500">({pct(r.complete, r.products)}%)</span>
                </Td>
                <Td className="tabular-nums">{r.incomplete}</Td>
                <Td className="tabular-nums">{r.unread}</Td>
                <Td className="tabular-nums">{r.exhausted}</Td>
                <Td className={`tabular-nums ${r.needsHuman ? 'text-amber-600 dark:text-amber-400' : ''}`}>{r.needsHuman}</Td>
                <Td className="text-xs text-zinc-500">{top.length ? top.map(([k, n]) => `${fieldLabels(r.category, [k])} ${n}`).join(' · ') : '—'}</Td>
              </tr>
            );
          })}
        </Table>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Produto = os anúncios do mesmo produto nas lojas (mesmo part number). Completa: tem todos os campos principais, juntando as páginas de todas as lojas. Só a web completa: incompletas com a página de
        todas as lojas já lida. Precisa de você: dessas, as que a busca na web já perguntou e ainda faltam campos; preencha à mão no produto (filtro "precisa de você").
      </p>
    </Box>
  );
}

interface Filters {
  q: string;
  page: number;
}

/** Produtos de uma categoria com os campos da ficha. A situação vem do painel (fica ao trocar de categoria). */
function Products({
  category,
  onCategory,
  state,
  onState,
  fail,
  onMessage,
}: Shared & { category: CategoryId | ''; onCategory: (c: CategoryId | '') => void; state: SheetFilterState | ''; onState: (s: SheetFilterState | '') => void }) {
  const [filters, setFilters] = useState<Filters>({ q: '', page: 1 });
  const [text, setText] = useState('');
  const [data, setData] = useState<SheetProductPage | null>(null);
  const [stores, setStores] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const fields = category ? sheetFields(category).filter((f) => f.key !== 'brand' && f.key !== 'model') : [];

  useEffect(() => {
    adminApi<AdminStoreConfig[]>('/stores')
      .then((list) => setStores(new Map(list.filter((s) => s.configured).map((s) => [s.id, s.name || s.id]))))
      .catch(fail);
  }, [fail]);
  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(filters.page) });
    if (category) q.set('category', category);
    if (state) q.set('state', state);
    if (filters.q) q.set('q', filters.q);
    adminApi<SheetProductPage>(`/sheets/products?${q}`).then(setData).catch(fail);
  }, [category, state, filters, fail]);
  useEffect(load, [load]);
  useLiveReload(['attempt', 'admin'], load, { delayMs: 3_000, fallbackMs: 60_000 });
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <Box
      title={
        <span className="flex flex-wrap items-center gap-2">
          Fichas por produto
          {data && <span className="text-sm font-normal text-zinc-500">{data.total.toLocaleString('pt-BR')}</span>}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={select} value={category} onChange={(e) => onCategory(e.target.value as CategoryId | '')} aria-label="Categoria">
          <option value="">todas as categorias</option>
          {ENABLED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_DEFS[c].name}
            </option>
          ))}
        </select>
        <select
          className={select}
          value={state}
          onChange={(e) => {
            onState(e.target.value as SheetFilterState | '');
            set({ page: 1 });
          }}
          aria-label="Situação da ficha"
        >
          <option value="">qualquer situação</option>
          {(['complete', 'incomplete', 'exhausted', 'manual', 'unread'] as const).map((s) => (
            <option key={s} value={s}>
              {SHEET_FILTER_LABEL[s]}
            </option>
          ))}
        </select>
        <form
          className="flex min-w-0 flex-1 gap-1"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            set({ q: text.trim() });
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Título ou código" maxLength={80} className={`${select} min-w-0 flex-1`} />
          <button type="submit" className="rounded-lg border border-zinc-300 px-2 hover:border-accent-500 dark:border-zinc-700" aria-label="Buscar">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>

      {!data ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : !data.items.length ? (
        <p className="text-sm text-zinc-500">Nenhum produto com esses filtros.</p>
      ) : (
        <Table head={['', 'Produto', ...(category ? [] : ['Categoria']), 'Ficha', ...(category ? fields.map((f) => f.label) : ['Faltando'])]}>
          {data.items.map((p) => {
            const isOpen = open === p.key;
            return (
              <Fragment key={p.key}>
                <tr className="cursor-pointer border-t border-zinc-100 align-top hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40" onClick={() => setOpen(isOpen ? null : p.key)}>
                  <Td>
                    <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  </Td>
                  <Td className="min-w-[16rem] max-w-md">
                    <span className="line-clamp-2">{p.title}</span>
                    <span className="text-xs text-zinc-500">{[...new Set(p.listings.map((l) => stores.get(l.store) ?? l.store))].join(' · ')}</span>
                  </Td>
                  {!category && <Td className="whitespace-nowrap text-xs">{CATEGORY_DEFS[p.category].name}</Td>}
                  <Td>
                    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STATE_TONE[p.state]}`}>{SHEET_STATE_LABEL[p.state]}</span>
                  </Td>
                  {!category && (
                    <Td className="text-xs text-amber-600 dark:text-amber-400">
                      {p.missing.length ? fieldLabels(p.category, p.missing) : <span className="text-zinc-500">—</span>}
                    </Td>
                  )}
                  {fields.map((f) => (
                    <Td key={f.key} className={`whitespace-nowrap text-xs ${p.missing.includes(f.key) ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                      {formatSheetValue(f, p.values[f.key]) || (p.missing.includes(f.key) ? 'falta' : '')}
                    </Td>
                  ))}
                </tr>
                {isOpen && (
                  <tr className="bg-zinc-50 dark:bg-zinc-950/40">
                    <td colSpan={category ? fields.length + 3 : 5} className="px-3 py-3">
                      <ProductDetail p={p} names={stores} fail={fail} onMessage={onMessage} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </Table>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => set({ page })} />}
    </Box>
  );
}

/**
 * Preencher à mão os campos principais que faltam (produto "precisa de você", ou qualquer incompleto).
 * Opções fechadas viram lista; o servidor valida como na busca na web (tipo, opções, faixa).
 */
function ManualFill({ p, fail, onMessage }: Shared & { p: SheetProduct }) {
  const keys = webKeys(p.category).filter((k) => p.missing.includes(k.field));
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!keys.length) return null;
  const save = () => {
    const values = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    if (!Object.keys(values).length) return;
    setSaving(true);
    adminApi('/sheets/manual', { method: 'PUT', body: { key: p.key, category: p.category, values } })
      .then(() => {
        onMessage({ ok: true, text: `${p.title.slice(0, 60)}: ${fieldLabels(p.category, Object.keys(values))} preenchido à mão.` });
        setForm({});
      })
      .catch(fail)
      .finally(() => setSaving(false));
  };
  return (
    <div className={`mb-3 rounded-lg border p-2 ${p.needsHuman ? 'border-amber-500/40 bg-amber-500/5' : 'border-zinc-200 dark:border-zinc-800'}`}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{p.needsHuman ? 'Precisa de você: a busca na web não achou' : 'Preencher à mão'}</p>
      <div className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-1 text-xs">
        {keys.map((k) => {
          const label = fieldLabels(p.category, [k.field]);
          const unit = SHEET_FIELDS[p.category].find((f) => f.key === k.field)?.unit;
          return (
            <Fragment key={k.field}>
              <label htmlFor={`m-${p.key}-${k.field}`} className="text-zinc-500">
                {label}
                {unit ? ` (${unit})` : ''}
              </label>
              {k.options ? (
                <select id={`m-${p.key}-${k.field}`} className={select} value={form[k.field] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k.field]: e.target.value }))}>
                  <option value="">—</option>
                  {[...new Set(Object.values(k.options))].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`m-${p.key}-${k.field}`}
                  className={select}
                  value={form[k.field] ?? ''}
                  placeholder={k.type === 'list' ? 'itens separados por vírgula' : k.type === 'int' || k.type === 'real' ? 'número' : ''}
                  maxLength={80}
                  onChange={(e) => setForm((f) => ({ ...f, [k.field]: e.target.value }))}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      <button
        type="button"
        disabled={saving || !Object.values(form).some((v) => v.trim())}
        onClick={save}
        className="mt-2 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs hover:border-accent-500 disabled:opacity-50 dark:border-zinc-700"
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}

/** Um produto: os anúncios (página lida ou não, texto guardado, "Ler ficha") e de onde veio cada campo. */
function ProductDetail({ p, names, fail, onMessage }: Shared & { p: SheetProduct; names: Map<string, string> }) {
  const [page, setPage] = useState<SheetPageText | null>(null);
  const name = (s: StoreId) => names.get(s) ?? s;
  const fields = sheetFields(p.category);
  const readSheet = (store: StoreId, sku: string, title: string) =>
    adminApi(`/products/${store}/${encodeURIComponent(sku)}/sheet`, { method: 'POST' })
      .then(() => onMessage({ ok: true, text: `Ficha de "${title.slice(0, 60)}" na fila da loja (na frente da rotina). A lista atualiza sozinha quando ela for lida.` }))
      .catch(fail);
  const showText = (store: StoreId, sku: string) =>
    adminApi<SheetPageText>(`/sheets/page?store=${store}&sku=${encodeURIComponent(sku)}`)
      .then(setPage)
      .catch(fail);

  return (
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <div>
        <p className="mb-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Anúncios
          <a href={productPath(p.key)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 normal-case tracking-normal text-accent-600 hover:underline dark:text-accent-400">
            Ver página do produto <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <ul className="space-y-2 text-xs">
          {p.listings.map((l) => (
            <li key={`${l.store}:${l.sku}`} className="space-y-1">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                <span className="font-medium">{name(l.store)}</span> · <span className="text-zinc-500">{l.title.slice(0, 80)}</span> <ExternalLink className="h-3 w-3" />
              </a>
              <div className="flex flex-wrap items-center gap-2 text-zinc-500">
                <span>
                  {l.sku} · {!l.read ? 'página não lida' : l.hasSheet ? `ficha lida ${formatWhen(l.at!)}` : `página sem ficha (${formatWhen(l.at!)})`}
                </span>
                {l.read && l.hasSheet && (
                  <button type="button" onClick={() => void showText(l.store, l.sku)} className="flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 hover:border-accent-500 dark:border-zinc-700">
                    <FileText className="h-3 w-3" /> Ver texto
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void readSheet(l.store, l.sku, l.title)}
                  className="flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 hover:border-accent-500 dark:border-zinc-700"
                  title="Abre a página do produto e lê a ficha de novo"
                >
                  <FileSearch className="h-3 w-3" /> Ler ficha
                </button>
              </div>
            </li>
          ))}
        </ul>
        {page && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-zinc-500">
              Texto guardado: {name(page.store)} {page.sku} ({formatWhen(page.at)})
            </p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">{page.text ?? '(sem ficha)'}</pre>
          </div>
        )}
      </div>
      <div>
        {p.missing.length > 0 && <ManualFill p={p} fail={fail} onMessage={onMessage} />}
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Campos</p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
          {fields.map((f) => {
            const v = formatSheetValue(f, p.values[f.key]);
            const from = p.origin[f.key];
            return (
              <Fragment key={f.key}>
                <dt className="text-zinc-500">{f.label}</dt>
                <dd className={p.missing.includes(f.key) ? 'text-amber-600 dark:text-amber-400' : ''}>
                  {v || (p.missing.includes(f.key) ? 'falta (principal)' : '—')}
                  {v && from && (from.from || p.listings.length > 1) && (
                    <span className="text-zinc-500">
                      {' '}
                      · {from.from ? VALUE_FROM_LABEL[from.from] : name(from.store)}
                      {from.from === 'title' && p.listings.length > 1 ? ` ${name(from.store)}` : ''}
                    </span>
                  )}
                </dd>
              </Fragment>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
