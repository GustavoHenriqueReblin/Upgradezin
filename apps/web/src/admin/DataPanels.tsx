import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CATEGORY_DEFS, ENABLED_CATEGORIES, type AdminStoreConfig, type AdminTerm, type CoverageRow, type StoreAttempt, type TimelineBucket } from '@upgradezin/shared';
import { ArrowUp, Trash2 } from 'lucide-react';
import { AdminError, adminApi } from './api.ts';
import { attemptResult, attemptWhat, formatDuration, formatWhen, matchesNever, originText, statusText, type NeverFilter } from './format.ts';

type Props = { onUnauthorized: () => void };

/** Carrega uma rota do admin; 401 volta ao login. */
function useAdmin<T>(path: string | null, onUnauthorized: () => void, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    if (!path) return;
    adminApi<T>(path)
      .then((d) => (setData(d), setError(false)))
      .catch((err) => (err instanceof AdminError && err.status === 401 ? onUnauthorized() : setError(true)));
  }, [path, onUnauthorized]);
  useEffect(() => {
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data, error, reload: load };
}

/** Nomes das lojas (para as tabelas). */
function useStoreNames(onUnauthorized: () => void) {
  const { data } = useAdmin<AdminStoreConfig[]>('/stores', onUnauthorized);
  return useMemo(() => new Map((data ?? []).map((s) => [s.id, s.name || s.id])), [data]);
}

const select = 'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';
const STATUS_TONE: Record<StoreAttempt['status'], string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  partial: 'text-amber-600 dark:text-amber-400',
  blocked: 'text-red-600 dark:text-red-400',
  limit: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
};

/** Consultas: linha do tempo por hora (ok × bloqueio) e o registro de cada consulta, com filtros. */
export function AttemptsPanel({ onUnauthorized }: Props) {
  const names = useStoreNames(onUnauthorized);
  const [store, setStore] = useState('');
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const query = new URLSearchParams({ limit: '200', ...(store ? { store } : {}), ...(status ? { status } : {}), ...(origin ? { origin } : {}) });
  const list = useAdmin<StoreAttempt[]>(`/attempts?${query}`, onUnauthorized, 15_000);
  const timeline = useAdmin<TimelineBucket[]>('/attempts/timeline?hours=48', onUnauthorized, 60_000);

  return (
    <div className="space-y-4">
      <Box title="Últimas 48 h, por hora">
        {timeline.data ? <Timeline buckets={timeline.data} names={names} /> : <p className="text-sm text-zinc-500">Carregando…</p>}
      </Box>
      <Box
        title={
          <span className="flex flex-wrap items-center gap-2">
            Consultas
            <select className={select} value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">todas as lojas</option>
              {[...names].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select className={select} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">qualquer resultado</option>
              {(['ok', 'blocked', 'partial', 'limit', 'error'] as const).map((s) => (
                <option key={s} value={s}>
                  {statusText(s)}
                </option>
              ))}
            </select>
            <select className={select} value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">qualquer origem</option>
              {(['search', 'routine', 'admin'] as const).map((o) => (
                <option key={o} value={o}>
                  {originText(o)}
                </option>
              ))}
            </select>
          </span>
        }
      >
        {!list.data ? (
          <p className="text-sm text-zinc-500">{list.error ? 'Não foi possível ler.' : 'Carregando…'}</p>
        ) : !list.data.length ? (
          <p className="text-sm text-zinc-500">Nenhuma consulta registrada com esses filtros.</p>
        ) : (
          <Table head={['Quando', 'Loja', 'O quê', 'Resultado', 'Origem', 'Duração']}>
            {list.data.map((a) => (
              <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800" title={a.detail}>
                <Td>{formatWhen(a.at)}</Td>
                <Td>{names.get(a.store) ?? a.store}</Td>
                <Td>{attemptWhat(a)}</Td>
                <Td className={STATUS_TONE[a.status]}>
                  {attemptResult(a)}
                  {a.detail && a.status !== 'ok' && <span className="block text-xs text-zinc-500">{a.detail}</span>}
                </Td>
                <Td>{originText(a.origin)}</Td>
                <Td>{formatDuration(a.ms / 1000)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Box>
    </div>
  );
}

/** Uma linha por loja, um quadradinho por hora: verde (só ok), vermelho (teve bloqueio), cinza (outro), vazio (nada). */
function Timeline({ buckets, names }: { buckets: TimelineBucket[]; names: Map<string, string> }) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const hours = Array.from({ length: 48 }, (_, i) => new Date(now.getTime() - (47 - i) * 3_600_000).toISOString());
  const stores = [...new Set([...names.keys(), ...buckets.map((b) => b.store)])];
  const at = new Map(buckets.map((b) => [`${b.store}|${b.hour}`, b]));
  return (
    <div className="space-y-1.5 overflow-x-auto">
      {stores.map((s) => (
        <div key={s} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-sm">{names.get(s) ?? s}</span>
          <div className="flex gap-0.5">
            {hours.map((h) => {
              const b = at.get(`${s}|${h}`);
              const tone = !b ? 'bg-zinc-200 dark:bg-zinc-800' : b.blocked ? 'bg-red-500' : b.ok ? 'bg-emerald-500' : 'bg-zinc-400';
              return <span key={h} className={`h-4 w-2.5 rounded-sm ${tone}`} title={`${formatWhen(h)}: ${b ? `${b.ok} ok, ${b.blocked} bloqueio(s), ${b.other} outro(s)` : 'nenhuma consulta'}`} />;
            })}
          </div>
        </div>
      ))}
      <p className="pt-1 text-xs text-zinc-500">Verde: só coletas boas · vermelho: teve bloqueio · cinza: erro ou limite · apagado: nenhuma consulta. Passe o mouse para ver a hora.</p>
    </div>
  );
}

/** Cobertura por loja e categoria: anúncios, frescor, termos coletados. */
export function CoveragePanel({ onUnauthorized }: Props) {
  const names = useStoreNames(onUnauthorized);
  const { data, error } = useAdmin<CoverageRow[]>('/coverage', onUnauthorized);
  if (!data) return <p className="text-zinc-500">{error ? 'Não foi possível ler.' : 'Carregando…'}</p>;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <Box title="Cobertura por loja e categoria">
      <Table head={['Loja', 'Categoria', 'Anúncios', 'Vistos em 24 h', 'Vistos em 7 dias', 'Termos coletados', 'Última coleta boa']}>
        {data.map((r) => (
          <tr key={`${r.store}|${r.category}`} className="border-t border-zinc-100 dark:border-zinc-800">
            <Td>{names.get(r.store) ?? r.store}</Td>
            <Td>{CATEGORY_DEFS[r.category]?.name ?? r.category}</Td>
            <Td className="tabular-nums">{r.listings}</Td>
            <Td className="tabular-nums">
              {r.seen24h} <span className="text-zinc-500">({pct(r.seen24h, r.listings)}%)</span>
            </Td>
            <Td className="tabular-nums">
              {r.seen7d} <span className="text-zinc-500">({pct(r.seen7d, r.listings)}%)</span>
            </Td>
            <Td className={`tabular-nums ${r.termsOk < r.terms ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {r.termsOk} de {r.terms}
            </Td>
            <Td>{r.lastOkAt ? formatWhen(r.lastOkAt) : '—'}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-zinc-500">Termos coletados em amarelo: a loja ainda não teve coleta boa de todos os termos da categoria (comum enquanto a rotina ainda não deu a volta nos termos).</p>
    </Box>
  );
}

const ORIGIN_LABEL: Record<AdminTerm['origin'], string> = { seed: 'formulário', user: 'pesquisado', text: 'texto livre' };

/** Termos da rotina: última coleta por loja; apagar pesquisados e dar prioridade. */
export function TermsPanel({ onUnauthorized }: Props) {
  const names = useStoreNames(onUnauthorized);
  const [category, setCategory] = useState('');
  const [origin, setOrigin] = useState('');
  const [q, setQ] = useState('');
  const [never, setNever] = useState<NeverFilter>('');
  const [message, setMessage] = useState<string | null>(null);
  const query = new URLSearchParams({ ...(category ? { category } : {}), ...(origin ? { origin } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const { data, reload } = useAdmin<AdminTerm[]>(`/terms?${query}`, onUnauthorized);
  const stores = [...names.keys()];
  const shown = data?.filter((t) => matchesNever(t, stores, never));

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage(ok);
      reload();
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) return onUnauthorized();
      setMessage(err instanceof AdminError && Array.isArray(err.data.errors) ? (err.data.errors as string[]).join(' ') : 'Não foi possível agora.');
    }
  };

  return (
    <Box
      title={
        <span className="flex flex-wrap items-center gap-2">
          Termos
          <select className={select} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">todas as categorias</option>
            {ENABLED_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_DEFS[c].name}
              </option>
            ))}
          </select>
          <select className={select} value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">qualquer origem</option>
            {(['seed', 'user', 'text'] as const).map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABEL[o]}
              </option>
            ))}
          </select>
          <select className={select} value={never} onChange={(e) => setNever(e.target.value as NeverFilter)}>
            <option value="">qualquer coleta</option>
            <option value="none">nunca coletado em nenhuma loja</option>
            <option value="some">nunca coletado em alguma loja</option>
          </select>
          <input className={select} placeholder="Procurar termo" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
          {shown && <span className="text-sm font-normal text-zinc-500">{shown.length} termo(s)</span>}
        </span>
      }
    >
      {message && <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">{message}</p>}
      {!shown ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : (
        <Table head={['Categoria', 'Termo', 'Origem', 'Último pedido', ...stores.map((s) => names.get(s) ?? s), '']}>
          {shown.map((t) => (
            <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <Td>{CATEGORY_DEFS[t.category]?.name ?? t.category}</Td>
              <Td className="font-medium">{t.term}</Td>
              <Td>{ORIGIN_LABEL[t.origin]}</Td>
              <Td>{t.lastRequestedAt ? formatWhen(t.lastRequestedAt) : '—'}</Td>
              {stores.map((s) => {
                const r = t.runs.find((x) => x.store === s);
                return (
                  <Td key={s} className={!r ? 'text-zinc-400' : r.status === 'ok' ? '' : 'text-red-600 dark:text-red-400'}>
                    {!r ? 'nunca' : r.lastOkAt ? `${formatWhen(r.lastOkAt)} (${r.count})` : `nunca (${r.status === 'blocked' ? 'bloqueio' : r.status === 'error' ? 'erro' : r.status})`}
                  </Td>
                );
              })}
              <Td>
                <span className="flex gap-1">
                  <IconBtn title="Dar prioridade na rotina" onClick={() => act(() => adminApi(`/terms/${t.id}/prioritize`, { method: 'POST' }), `"${t.term}" vai primeiro na rotina.`)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  {t.origin !== 'seed' && (
                    <IconBtn title="Apagar termo" onClick={() => confirm(`Apagar "${t.term}"?`) && act(() => adminApi(`/terms/${t.id}`, { method: 'DELETE' }), `"${t.term}" apagado.`)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  )}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Box>
  );
}

function Box({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Td = ({ children, className = '' }: { children: ReactNode; className?: string }) => <td className={`py-1.5 pr-3 align-top ${className}`}>{children}</td>;

const IconBtn = ({ children, ...rest }: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" {...rest} className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
    {children}
  </button>
);
