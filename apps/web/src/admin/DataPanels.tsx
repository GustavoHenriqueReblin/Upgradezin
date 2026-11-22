import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CATEGORY_DEFS, type AdminPage, type AdminStoreConfig, type CoverageRow, type PerfGap, type StoreAttempt, type TimelineBucket } from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { useLiveReload, type LiveKind } from './live.ts';
import { Pager } from './Pager.tsx';
import { attemptResult, attemptWhat, formatDuration, formatWhen, originText, statusText } from './format.ts';

type Props = { onUnauthorized: () => void };

/**
 * Carrega uma rota do admin; 401 volta ao login. Com `live`, recarrega sozinha quando chega um desses
 * avisos no canal ao vivo (`delayMs` junta avisos seguidos).
 */
function useAdmin<T>(path: string | null, onUnauthorized: () => void, live: LiveKind[] = [], delayMs = 500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    if (!path) return;
    adminApi<T>(path)
      .then((d) => (setData(d), setError(false)))
      .catch((err) => (err instanceof AdminError && err.status === 401 ? onUnauthorized() : setError(true)));
  }, [path, onUnauthorized]);
  useEffect(load, [load]);
  useLiveReload(live, load, { delayMs, fallbackMs: live.length ? 60_000 : 0 });
  return { data, error, reload: load };
}

/** Nomes das lojas (para as tabelas). */
function useStoreNames(onUnauthorized: () => void) {
  const { data } = useAdmin<AdminStoreConfig[]>('/stores', onUnauthorized, ['admin']);
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

/** Consultas: linha do tempo por hora (ok × bloqueio) e o registro de cada consulta, com filtros e paginado. Atualiza a cada consulta nova (canal ao vivo). */
export function AttemptsPanel({ onUnauthorized }: Props) {
  const names = useStoreNames(onUnauthorized);
  const [store, setStore] = useState('');
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [page, setPage] = useState(1);
  // Mudar um filtro volta para a 1ª página.
  const filter = (set: (v: string) => void) => (v: string) => (set(v), setPage(1));
  const query = new URLSearchParams({ page: String(page), ...(store ? { store } : {}), ...(status ? { status } : {}), ...(origin ? { origin } : {}) });
  const list = useAdmin<AdminPage<StoreAttempt>>(`/attempts?${query}`, onUnauthorized, ['attempt']);
  const timeline = useAdmin<TimelineBucket[]>('/attempts/timeline?hours=48', onUnauthorized, ['attempt'], 2_000);

  return (
    <div className="space-y-4">
      <Box title="Últimas 48 h, por hora">
        {timeline.data ? <Timeline buckets={timeline.data} names={names} /> : <p className="text-sm text-zinc-500">Carregando…</p>}
      </Box>
      <Box
        title={
          <span className="flex flex-wrap items-center gap-2">
            Consultas
            {list.data && <span className="text-sm font-normal text-zinc-500">{list.data.total.toLocaleString('pt-BR')}</span>}
            <select className={select} value={store} onChange={(e) => filter(setStore)(e.target.value)}>
              <option value="">todas as lojas</option>
              {[...names].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select className={select} value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
              <option value="">qualquer resultado</option>
              {(['ok', 'blocked', 'partial', 'limit', 'error'] as const).map((s) => (
                <option key={s} value={s}>
                  {statusText(s)}
                </option>
              ))}
            </select>
            <select className={select} value={origin} onChange={(e) => filter(setOrigin)(e.target.value)}>
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
        ) : !list.data.items.length ? (
          <p className="text-sm text-zinc-500">Nenhuma consulta registrada com esses filtros.</p>
        ) : (
          <Table head={['Quando', 'Loja', 'O quê', 'Resultado', 'Origem', 'Duração']}>
            {list.data.items.map((a) => (
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
        {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
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

/** Cobertura por loja e categoria: anúncios (em estoque), frescor e a leitura da categoria pela rotina. */
export function CoveragePanel({ onUnauthorized }: Props) {
  const names = useStoreNames(onUnauthorized);
  const { data, error } = useAdmin<CoverageRow[]>('/coverage', onUnauthorized, ['attempt', 'admin'], 3_000);
  if (!data) return <p className="text-zinc-500">{error ? 'Não foi possível ler.' : 'Carregando…'}</p>;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <Box title="Cobertura por loja e categoria">
      <Table head={['Loja', 'Categoria', 'Anúncios', 'Em estoque', 'Vistos em 24 h', 'Vistos em 7 dias', 'Página da categoria', 'Fichas lidas', 'Último visto']}>
        {data.map((r) => (
          <tr key={`${r.store}|${r.category}`} className="border-t border-zinc-100 dark:border-zinc-800">
            <Td>{names.get(r.store) ?? r.store}</Td>
            <Td>{CATEGORY_DEFS[r.category]?.name ?? r.category}</Td>
            <Td className="tabular-nums">{r.listings}</Td>
            <Td className="tabular-nums">{r.inStock}</Td>
            <Td className="tabular-nums">
              {r.seen24h} <span className="text-zinc-500">({pct(r.seen24h, r.listings)}%)</span>
            </Td>
            <Td className="tabular-nums">
              {r.seen7d} <span className="text-zinc-500">({pct(r.seen7d, r.listings)}%)</span>
            </Td>
            <Td className={r.paths ? '' : 'text-amber-600 dark:text-amber-400'}>
              {!r.paths
                ? 'não configurada'
                : r.sweeping
                  ? `lendo: ${r.paths > 1 ? `caminho ${r.sweeping.path}, ` : ''}pág. ${r.sweeping.page}`
                  : r.sweptAt
                    ? `volta completa ${formatWhen(r.sweptAt)}`
                    : 'ainda não lida'}
            </Td>
            <Td className="tabular-nums">
              {r.sheets === null ? (
                <span className="text-zinc-400">—</span>
              ) : (
                <>
                  {r.sheets} <span className="text-zinc-500">({pct(r.sheets, r.listings)}%)</span>
                </>
              )}
            </Td>
            <Td>{r.lastOkAt ? formatWhen(r.lastOkAt) : '—'}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-zinc-500">
        Página da categoria: a rotina lê a lista da categoria na loja (configurada em Lojas) até acabar o que está em estoque; no fim de cada volta, o que estava em estoque e não apareceu passa a "sem
        estoque". "Não configurada": a loja não tem caminho para essa categoria. Fichas lidas: medidas físicas da página do produto (placa de vídeo, gabinete, cooler), lidas uma vez por produto pela rotina
        de fichas, aos poucos.
      </p>
    </Box>
  );
}

/**
 * Processadores e placas de vídeo à venda que a tabela de desempenho (packages/shared/src/perf.ts) não
 * conhece: ficam fora do "Identificar Gargalo" e do ranking de upgrade até alguém acrescentar.
 */
export function PerfGapsPanel({ onUnauthorized }: Props) {
  const names = useStoreNames(onUnauthorized);
  const { data, error } = useAdmin<PerfGap[]>('/perf-gaps', onUnauthorized, ['attempt'], 5_000);
  return (
    <Box title="Modelos sem índice de desempenho">
      {!data ? (
        <p className="text-sm text-zinc-500">{error ? 'Não foi possível ler.' : 'Carregando…'}</p>
      ) : !data.length ? (
        <p className="text-sm text-zinc-500">Todo processador e placa de vídeo visto nas lojas nos últimos 14 dias tem índice.</p>
      ) : (
        <>
          <Table head={['Categoria', 'Modelo', 'Anúncios', 'Exemplo']}>
            {data.map((g) => (
              <tr key={`${g.category}|${g.model}`} className="border-t border-zinc-100 dark:border-zinc-800">
                <Td>{CATEGORY_DEFS[g.category].name}</Td>
                <Td className="font-medium">{g.model || <span className="text-zinc-500">não lido do título</span>}</Td>
                <Td className="tabular-nums">{g.listings}</Td>
                <Td className="text-zinc-500">
                  {names.get(g.store) ?? g.store} · {g.example}
                </Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-zinc-500">
            Vistos nas lojas nos últimos 14 dias. Para entrarem no gargalo e no ranking de upgrade, acrescente o modelo na tabela de desempenho (packages/shared/src/perf.ts). Modelo "não lido do título": o
            leitor de specs não reconheceu o anúncio.
          </p>
        </>
      )}
    </Box>
  );
}

export function Box({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
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

export const Td = ({ children, className = '' }: { children: ReactNode; className?: string }) => <td className={`py-1.5 pr-3 align-top ${className}`}>{children}</td>;
