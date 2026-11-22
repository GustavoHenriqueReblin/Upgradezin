import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ExternalLink, Search } from 'lucide-react';
import { CATEGORY_DEFS, ENABLED_CATEGORIES, type AdminProduct, type AdminProductPage, type AdminStoreConfig } from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { Box, Table, Td } from './DataPanels.tsx';
import { formatWhen, specPairs } from './format.ts';
import { useLiveReload } from './live.ts';
import { Pager } from './Pager.tsx';

type Props = { onUnauthorized: () => void };

const select = 'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
interface Filters {
  store: string;
  category: string;
  inStock: string;
  q: string;
  page: number;
}
const NO_FILTERS: Filters = { store: '', category: '', inStock: '', q: '', page: 1 };

/**
 * Produtos: o catálogo (cada anúncio guardado), paginado, com as specs do título, o índice de
 * desempenho e o mesmo produto nas outras lojas. A ficha técnica fica na aba Fichas.
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
      <Catalog fail={fail} />
    </div>
  );
}

type Shared = { fail: (err: unknown) => void };

/** Catálogo paginado, com filtros e detalhes por produto. */
function Catalog({ fail }: Shared) {
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
    for (const k of ['store', 'category', 'inStock', 'q'] as const) if (filters[k]) q.set(k, filters[k]);
    adminApi<AdminProductPage>(`/products?${q}`).then(setData).catch(fail);
  }, [filters, fail]);
  useEffect(load, [load]);
  // Coletas mudam preço e estoque da página aberta: recarrega (juntando 2 s de avisos).
  useLiveReload(['attempt', 'admin'], load, { delayMs: 2_000, fallbackMs: 60_000 });

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

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
        <Table head={['', 'Loja', 'Categoria', 'Produto', 'Preço', 'Estoque', 'Visto']}>
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
                </tr>
                {isOpen && (
                  <tr className="bg-zinc-50 dark:bg-zinc-950/40">
                    <td colSpan={7} className="px-3 py-3">
                      <ProductDetail p={p} names={stores} />
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

/** Detalhes de um produto: specs do título, índice de desempenho e o mesmo produto nas outras lojas. */
function ProductDetail({ p, names }: { p: AdminProduct; names: Map<string, string> }) {
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
        {(p.category === 'gpu' || p.category === 'cpu') && (
          <>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Índice de desempenho</p>
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
        <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Mesmo produto</p>
        {p.siblings?.length ? (
          <ul className="space-y-0.5 text-xs">
            {p.siblings.map((x) => (
              <li key={`${x.store}:${x.sku}`}>
                <a href={x.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  <span className="font-medium">{names.get(x.store) ?? x.store}</span> · <span className="text-zinc-500">{x.title.slice(0, 70)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-zinc-500">Nenhum outro anúncio com o mesmo part number.</p>
        )}
      </div>
    </div>
  );
}


