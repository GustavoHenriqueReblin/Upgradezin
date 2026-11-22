import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ExternalLink, FileSearch, Search } from 'lucide-react';
import {
  CATEGORY_DEFS,
  ENABLED_CATEGORIES,
  SHEET_SECONDS_MAX,
  SHEET_SECONDS_MIN,
  type AdminProduct,
  type AdminProductPage,
  type AdminStoreConfig,
  type SheetRoutineInput,
  type SheetRoutineStatus,
  type SheetStatus,
  type StoreId,
} from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { Box, Table, Td } from './DataPanels.tsx';
import { countdown, formatWhen, SHEET_STATUS_LABEL, SHEET_UNITS, sheetEta, sheetSummary, shortDuration, specPairs, splitSeconds } from './format.ts';
import { useLiveReload } from './live.ts';
import { Pager } from './Pager.tsx';
import { Switch } from './Switch.tsx';

type Props = { onUnauthorized: () => void };

const select = 'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_TONE: Record<SheetStatus, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  empty: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  missing: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
  na: 'text-zinc-400',
};

interface Filters {
  store: string;
  category: string;
  sheet: string;
  inStock: string;
  q: string;
  page: number;
}
const NO_FILTERS: Filters = { store: '', category: '', sheet: '', inStock: '', q: '', page: 1 };

/**
 * Produtos: o catálogo (cada anúncio guardado), paginado, com as specs do título, o índice de
 * desempenho e a ficha técnica; a rotina de fichas (ligar, lojas, intervalo, andamento por loja) e "Ler ficha".
 */
export function ProductsPanel({ onUnauthorized }: Props) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
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
      <Catalog fail={fail} onMessage={setMessage} />
    </div>
  );
}

type Shared = { fail: (err: unknown) => void; onMessage: (m: { ok: boolean; text: string }) => void };

/** Rotina de fichas (separada da coleta): chave, lojas, intervalo e o andamento por loja. Atualiza ao vivo. */
function SheetRoutine({ fail, onMessage }: Shared) {
  const [status, setStatus] = useState<SheetRoutineStatus | null>(null);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(60);

  const load = useCallback(() => {
    adminApi<SheetRoutineStatus>('/sheets').then(setStatus).catch(fail);
  }, [fail]);
  useEffect(load, [load]);
  // Ficha lida (consulta), loja lendo ou em pausa, mudança pelo admin: na hora.
  useLiveReload(['attempt', 'store', 'admin'], load, { fallbackMs: 15_000 });
  const saved = status?.seconds;
  useEffect(() => {
    if (saved === undefined) return;
    const p = splitSeconds(saved);
    setValue(String(p.value));
    setUnit(p.unit);
  }, [saved]);

  if (!status) return <Box title="Rotina de fichas técnicas"><p className="text-sm text-zinc-500">Carregando…</p></Box>;

  const save = (input: SheetRoutineInput, ok: string) =>
    adminApi<SheetRoutineStatus>('/sheets', { method: 'PUT', body: input })
      .then((r) => {
        setStatus(r);
        onMessage({ ok: true, text: ok });
      })
      .catch(fail);
  const seconds = Number(value) * unit;
  const validGap = Number.isInteger(seconds) && seconds >= SHEET_SECONDS_MIN && seconds <= SHEET_SECONDS_MAX;
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
        Lê, aos poucos e uma vez por produto, as medidas físicas da página de cada placa de vídeo, gabinete e cooler (para a checagem da montagem). Separada da rotina de coleta: chave, lojas e intervalo
        próprios. Divide com a coleta só o que é da loja: a fila (a busca do site passa na frente), a pausa por bloqueio e o limite de páginas por hora.
      </p>
      {status.enabled && !status.stores.length && <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">Nenhuma loja marcada: as fichas não andam.</p>}

      <form
        className="mt-3 flex flex-wrap items-end gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (validGap && seconds !== status.seconds) void save({ seconds }, `Fichas: 1 por loja a cada ${shortDuration(seconds)}.`);
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Uma ficha por loja a cada
          <span className="flex gap-1">
            <input type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} className={`${select} w-24`} />
            <select value={unit} onChange={(e) => setUnit(Number(e.target.value))} className={select} aria-label="Unidade do intervalo">
              {SHEET_UNITS.map((u) => (
                <option key={u.s} value={u.s}>
                  {u.label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <button type="submit" disabled={!validGap || seconds === status.seconds} className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-950 disabled:opacity-40">
          Salvar
        </button>
        <span className="pb-1.5 text-xs text-zinc-500">{validGap ? `+ até 20% aleatório (≈ ${Math.round((3600 / seconds / 1.1) * 10) / 10} por loja por hora)` : `De ${SHEET_SECONDS_MIN} s a 24 h.`}</span>
      </form>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {status.progress.map((s) => {
          const pct = (x: number) => (s.total ? (x / s.total) * 100 : 0);
          const marked = status.stores.includes(s.store);
          return (
            <div key={s.store} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="flex items-center justify-between gap-2 text-sm font-medium">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={marked} disabled={!s.canRead} onChange={(e) => toggleStore(s.store, e.target.checked)} />
                  {s.name}
                </label>
                <span className="text-xs font-normal tabular-nums text-zinc-500">{s.total ? `${Math.round(pct(s.ok + s.empty))}%` : '—'}</span>
              </p>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                <div className="h-full bg-emerald-500" style={{ width: `${pct(s.ok)}%` }} />
                <div className="h-full bg-amber-400" style={{ width: `${pct(s.empty)}%` }} />
              </div>
              {!s.canRead ? (
                <p className="mt-2 text-xs text-zinc-500">Esta loja não tem leitor de ficha.</p>
              ) : (
                <dl className="mt-2 space-y-0.5 text-xs text-zinc-500">
                  <div className="tabular-nums">
                    {s.ok} lidas · {s.empty} sem ficha · {s.missing} faltam (de {s.total})
                  </div>
                  <div className="tabular-nums">
                    {s.lastHour} na última hora{s.lastAt ? ` · última ${formatWhen(s.lastAt)}` : ''}
                  </div>
                  {s.nextAt && (s.missing > 0 ? <div className="tabular-nums">Próxima: {countdown(s.nextAt)}</div> : <div>Nada a ler agora (confere produtos novos a cada minuto).</div>)}
                  {s.nextAt && s.missing > 0 && <div>No ritmo atual, faltam {sheetEta(s.missing, status.seconds)}.</div>}
                  {status.enabled && !marked && <div>Fora da rotina de fichas.</div>}
                </dl>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Produtos vistos nas lojas nos últimos 14 dias. Verde: ficha lida; amarelo: a página não tinha ficha (lida de novo depois de 30 dias).</p>
    </Box>
  );
}

/** Catálogo paginado, com filtros, detalhes por produto e "Ler ficha". */
function Catalog({ fail, onMessage }: Shared) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [text, setText] = useState('');
  const [data, setData] = useState<AdminProductPage | null>(null);
  const [stores, setStores] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    adminApi<AdminStoreConfig[]>('/stores')
      .then((list) => setStores(new Map(list.filter((s) => s.configured).map((s) => [s.id, s.name || s.id]))))
      .catch(fail);
  }, [fail]);

  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(filters.page) });
    for (const k of ['store', 'category', 'sheet', 'inStock', 'q'] as const) if (filters[k]) q.set(k, filters[k]);
    adminApi<AdminProductPage>(`/products?${q}`).then(setData).catch(fail);
  }, [filters, fail]);
  useEffect(load, [load]);
  // Coletas e fichas mudam preço, estoque e ficha da página aberta: recarrega (juntando 2 s de avisos).
  useLiveReload(['attempt', 'admin'], load, { delayMs: 2_000, fallbackMs: 60_000 });

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  const readSheet = (p: AdminProduct) =>
    adminApi(`/products/${p.store}/${encodeURIComponent(p.sku)}/sheet`, { method: 'POST' })
      .then(() => {
        onMessage({ ok: true, text: `Ficha de "${p.title.slice(0, 60)}" na fila da loja (na frente da rotina). A lista atualiza sozinha quando ela for lida.` });
      })
      .catch(fail);

  return (
    <Box
      title={
        <span className="flex flex-wrap items-center gap-2">
          Produtos catalogados
          {data && <span className="text-sm font-normal text-zinc-500">{data.total.toLocaleString('pt-BR')}</span>}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={select} value={filters.store} onChange={(e) => set({ store: e.target.value })} aria-label="Loja">
          <option value="">todas as lojas</option>
          {[...stores].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select className={select} value={filters.category} onChange={(e) => set({ category: e.target.value })} aria-label="Categoria">
          <option value="">todas as categorias</option>
          {ENABLED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_DEFS[c].name}
            </option>
          ))}
        </select>
        <select className={select} value={filters.sheet} onChange={(e) => set({ sheet: e.target.value })} aria-label="Ficha técnica">
          <option value="">qualquer ficha</option>
          {(['ok', 'empty', 'missing', 'na'] as const).map((s) => (
            <option key={s} value={s}>
              ficha: {SHEET_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className={select} value={filters.inStock} onChange={(e) => set({ inStock: e.target.value })} aria-label="Estoque">
          <option value="">com e sem estoque</option>
          <option value="1">em estoque</option>
          <option value="0">sem estoque</option>
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
        <Table head={['', 'Loja', 'Categoria', 'Produto', 'Preço', 'Estoque', 'Visto', 'Ficha', '']}>
          {data.items.map((p) => {
            const key = `${p.store}:${p.sku}`;
            const isOpen = open === key;
            return (
              <Fragment key={key}>
                <tr className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40" onClick={() => setOpen(isOpen ? null : key)}>
                  <Td>
                    <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  </Td>
                  <Td className="whitespace-nowrap">{stores.get(p.store) ?? p.store}</Td>
                  <Td className="whitespace-nowrap">{CATEGORY_DEFS[p.category]?.name ?? p.category}</Td>
                  <Td className="max-w-md">
                    <span className="line-clamp-2">{p.title}</span>
                    <span className="text-xs text-zinc-500">{p.sku}</span>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{brl(p.price)}</Td>
                  <Td className={p.inStock ? '' : 'text-zinc-400'}>{p.inStock ? 'sim' : 'não'}</Td>
                  <Td className="whitespace-nowrap text-zinc-500">{formatWhen(p.lastSeenAt)}</Td>
                  <Td>
                    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[p.sheetStatus]}`}>{SHEET_STATUS_LABEL[p.sheetStatus]}</span>
                    {p.sheetStatus === 'ok' && <span className="mt-0.5 block text-xs text-zinc-500">{sheetSummary(p.sheet)}</span>}
                  </Td>
                  <Td>
                    {p.sheetStatus !== 'na' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void readSheet(p);
                        }}
                        className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium hover:border-accent-500 dark:border-zinc-700"
                        title="Abre a página do produto e lê a ficha de novo"
                      >
                        <FileSearch className="h-3.5 w-3.5" /> Ler ficha
                      </button>
                    )}
                  </Td>
                </tr>
                {isOpen && (
                  <tr className="bg-zinc-50 dark:bg-zinc-950/40">
                    <td colSpan={9} className="px-3 py-3">
                      <ProductDetail p={p} />
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

/** Detalhes de um produto: specs do título, índice de desempenho e ficha técnica. */
function ProductDetail({ p }: { p: AdminProduct }) {
  const pairs = specPairs(p.specs);
  return (
    <div className="grid gap-4 text-sm md:grid-cols-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Specs do título</p>
        {pairs.length ? (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
            {pairs.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-zinc-500">{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-zinc-500">O título não trouxe specs reconhecidas.</p>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Ficha técnica</p>
        <p className="text-xs">{SHEET_STATUS_LABEL[p.sheetStatus]}{p.sheetAt ? ` · lida ${formatWhen(p.sheetAt)}` : ''}</p>
        {p.sheet && <p className="mt-1 text-xs text-zinc-500">{sheetSummary(p.sheet)}</p>}
        {(p.category === 'gpu' || p.category === 'cpu') && (
          <>
            <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Índice de desempenho</p>
            <p className="text-xs">{p.perf !== undefined ? `${p.perf} (${p.category === 'gpu' ? 'RTX 3060' : 'Ryzen 5 5600'} = 100)` : 'fora da tabela (aparece em Cobertura → modelos sem índice)'}</p>
          </>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Anúncio</p>
        <dl className="space-y-0.5 text-xs">
          <div>Visto pela primeira vez {formatWhen(p.firstSeenAt)}</div>
          <div>Última coleta {formatWhen(p.lastSeenAt)}</div>
        </dl>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline dark:text-accent-400">
          Abrir na loja <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}


