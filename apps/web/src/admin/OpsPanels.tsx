import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ACTIVITY_ACTIONS, ACTIVITY_SCREENS, CATEGORY_DEFS, productPath, type ActivityInfo, type BackupFile, type MergeReport, type UsageReport } from '@upgradezin/shared';
import { Database, Download, Trash2, Upload } from 'lucide-react';
import { AdminError, adminApi, adminUpload } from './api.ts';
import { formatWhen, mergeLines } from './format.ts';
import { Pager } from './Pager.tsx';
import { useLiveReload, watchLive } from './live.ts';

type Props = { onUnauthorized: () => void };

function Box({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
    <div className="text-xs text-zinc-500">{label}</div>
    <div className="text-lg font-semibold tabular-nums">{value}</div>
  </div>
);

/** Uso do site e indicadores de busca em tempo real. */
export function ActivityPanel({ onUnauthorized }: Props) {
  const [a, setA] = useState<ActivityInfo | null>(null);
  const load = useCallback(
    () => void adminApi<ActivityInfo>('/activity').then(setA).catch((err) => err instanceof AdminError && err.status === 401 && onUnauthorized()),
    [onUnauthorized],
  );
  useEffect(load, [load]);
  // Cada busca no site na hora; telas abertas e limites (que não avisam) a cada 10 s.
  useLiveReload(['activity'], load, { fallbackMs: 10_000 });
  if (!a) return <p className="text-zinc-500">Carregando…</p>;
  const limits = a.atLimit.force + a.atLimit.text + a.atLimit.share;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Buscas abertas agora" value={a.searchesOpen} />
        <Stat label="Telas de resultado abertas" value={a.watchesOpen} />
        <Stat
          label="No limite agora"
          value={limits ? `${limits} (atualizar ${a.atLimit.force}, texto ${a.atLimit.text}, links ${a.atLimit.share})` : 'ninguém'}
        />
      </div>
      <UsagePanel onUnauthorized={onUnauthorized} />
    </div>
  );
}

const usageField = 'min-h-10 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900';
const activityCount = new Intl.NumberFormat('pt-BR');

function UsagePanel({ onUnauthorized }: Props) {
  const [filters, setFilters] = useState({ days: '7', person: '', screen: '', action: '' });
  const [personInput, setPersonInput] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ filters: string; page: number; report: UsageReport }>();
  const [failed, setFailed] = useState('');
  const params = new URLSearchParams(filters);
  for (const key of ['person', 'screen', 'action']) if (!params.get(key)) params.delete(key);
  const filterKey = params.toString();
  params.set('page', String(page));
  const query = params.toString();
  const report = result?.filters === filterKey ? result.report : undefined;
  const rows = result?.page === page ? report?.recent : undefined;

  useEffect(() => {
    let pending: AbortController | undefined;
    const reload = () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      void adminApi<UsageReport>(`/activity/usage?${query}`, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult({ filters: filterKey, page, report: data });
            setPage(Math.min(page, Math.max(1, Math.ceil(data.total / data.pageSize))));
            setFailed('');
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err instanceof AdminError && err.status === 401) onUnauthorized();
          else setFailed(query);
        });
    };
    reload();
    const stop = watchLive([], reload, { fallbackMs: 15_000 });
    return () => { stop(); pending?.abort(); };
  }, [query, filterKey, page, onUnauthorized]);

  const change = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const ranking = (rows: { label: string; count: number }[]) => rows.length ? (
    <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
      {rows.map(({ label, count }) => <li key={label} className="flex justify-between gap-4 border-b border-zinc-100 py-1 dark:border-zinc-800">
        <span>{label}</span><span className="tabular-nums">{activityCount.format(count)}</span>
      </li>)}
    </ul>
  ) : <p className="text-sm text-zinc-500">Sem registros no período.</p>;

  return (
    <div className="space-y-4">
      <Box title="Uso do site">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); change('person', personInput.trim()); }}>
          <label className="grid gap-1 text-sm">Período
            <select className={usageField} value={filters.days} onChange={(e) => change('days', e.target.value)}>
              <option value="1">Últimas 24 horas</option>
              {[7, 30, 90].map((days) => <option key={days} value={days}>Últimos {days} dias</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">Tela
            <select className={usageField} value={filters.screen} onChange={(e) => change('screen', e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(ACTIVITY_SCREENS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">Ação
            <select className={`${usageField} max-w-full`} value={filters.action} onChange={(e) => change('action', e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(ACTIVITY_ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">E-mail ou ID do visitante
            <input className={usageField} value={personInput} onChange={(e) => setPersonInput(e.target.value)} maxLength={254} />
          </label>
          <button className={`${usageField} accent-control`} type="submit">Filtrar pessoa</button>
          {filters.person && <button type="button" className={usageField} onClick={() => { setPersonInput(''); change('person', ''); }}>Limpar pessoa</button>}
        </form>
        {failed === query && <p role="status" className="mt-3 text-sm text-red-600 dark:text-red-400">Não foi possível carregar a atividade.</p>}
        {!report && failed !== query && <p className="mt-3 text-sm text-zinc-500">Carregando…</p>}
        {report && <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Eventos" value={activityCount.format(report.total)} />
          <Stat label="Contas" value={activityCount.format(report.accounts)} />
          <Stat label="IDs de visitantes" value={activityCount.format(report.visitors)} />
        </div>}
      </Box>
      {report && <>
        <div className="grid gap-4 lg:grid-cols-2">
          <Box title="Telas mais abertas">
            {ranking(report.screens.map((r) => ({ label: ACTIVITY_SCREENS[r.screen], count: r.count })))}
          </Box>
          <Box title="Ações mais usadas">
            {ranking(report.actions.map((r) => ({ label: `${ACTIVITY_ACTIONS[r.action]} · ${ACTIVITY_SCREENS[r.screen]}`, count: r.count })))}
          </Box>
        </div>
        <Box title="Histórico de atividade">
          <p className="mb-3 text-xs text-zinc-500">Histórico de até 90 dias. O ID dos visitantes muda quando o servidor reinicia.</p>
          {rows?.length ? <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>{['Quando', 'Pessoa', 'Tela', 'Ação', 'Detalhes'].map((label) => <th key={label} className="py-2 pr-3">{label}</th>)}</tr>
              </thead>
              <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="whitespace-nowrap py-2 pr-3">{formatWhen(r.at)}</td>
                <td className="py-2 pr-3">
                  <button type="button" className="break-all text-left text-accent-700 hover:underline dark:text-accent-400" onClick={() => {
                    setPersonInput(r.person);
                    change('person', r.person);
                  }}>{r.person}</button>
                  {!r.signedIn && <span className="ml-2 text-xs text-zinc-500">Visitante</span>}
                </td>
                <td className="py-2 pr-3">{ACTIVITY_SCREENS[r.screen]}</td>
                <td className="py-2 pr-3">{ACTIVITY_ACTIONS[r.action]}</td>
                <td className="py-2 pr-3">
                  {[r.category && CATEGORY_DEFS[r.category].name, r.mode && (r.mode === 'full' ? 'PC completo' : 'Upgrade'), r.store?.toUpperCase()].filter(Boolean).join(' · ')}
                  {r.product && r.productTitle && <a className="block hover:underline" href={productPath(r.product)}>{r.productTitle}</a>}
                </td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="text-sm text-zinc-500">{rows ? 'Nenhum evento nesta página.' : failed !== query ? 'Carregando página…' : 'Não foi possível carregar esta página.'}</p>}
          {result && <Pager page={result.page} pageSize={report.pageSize} total={report.total} onPage={setPage} />}
        </Box>
      </>}
    </div>
  );
}

/** Backups (criar, baixar, apagar) e merge de outro banco (prévia antes de aplicar). */
export function BackupsPanel({ onUnauthorized }: Props) {
  const [list, setList] = useState<BackupFile[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ id: string; name: string; report: MergeReport } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof AdminError && err.status === 401) return onUnauthorized();
      setMessage({ ok: false, text: err instanceof AdminError && Array.isArray(err.data.errors) ? (err.data.errors as string[]).join(' ') : 'Não foi possível agora.' });
    },
    [onUnauthorized],
  );
  const load = useCallback(() => adminApi<BackupFile[]>('/backups').then(setList).catch(fail), [fail]);
  useEffect(() => void load(), [load]);
  useLiveReload(['admin'], () => void load(), { fallbackMs: 60_000 }); // backup novo (manual, de outra aba ou antes de um merge)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      void load();
    }
  };

  const upload = (f: File) =>
    run(async () => {
      const r = await adminUpload<{ id: string; report: MergeReport }>('/merge', f);
      setPending({ id: r.id, name: f.name, report: r.report });
    });

  return (
    <div className="space-y-4">
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>{message.text}</p>}

      <Box title="Backups">
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const b = await adminApi<BackupFile>('/backups', { method: 'POST' });
              setMessage({ ok: true, text: `Backup criado: ${b.name} (${b.sizeMb} MB).` });
            })
          }
          className="mb-3 flex items-center gap-1.5 rounded-lg accent-control px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          <Database className="h-4 w-4" /> {busy ? 'Aguarde…' : 'Fazer backup agora'}
        </button>
        {!list ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : !list.length ? (
          <p className="text-sm text-zinc-500">Nenhum backup em data/backups.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {list.map((b) => (
              <li key={b.name} className="flex items-center gap-3 py-1.5">
                <span className="font-mono text-xs">{b.name}</span>
                <span className="text-zinc-500">{b.sizeMb} MB</span>
                <span className="text-zinc-500">{formatWhen(b.at)}</span>
                <a href={`/api/admin/backups/${encodeURIComponent(b.name)}`} className="button-link ml-auto inline-flex items-center rounded px-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" title="Baixar">
                  <Download className="h-4 w-4" />
                </a>
                <button
                  title="Apagar"
                  className="rounded p-1 text-zinc-500 hover:text-red-600"
                  onClick={() => confirm(`Apagar ${b.name}?`) && run(async () => void (await adminApi(`/backups/${encodeURIComponent(b.name)}`, { method: 'DELETE' })))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Box>

      <Box title="Merge de outro banco">
        <p className="mb-3 text-sm text-zinc-500">
          Junta neste servidor o que só o outro banco tem (anúncios, histórico de preço, termos, coletas, fichas). Não mexe em pausas, lojas nem montagens. Primeiro mostra o que entraria;
          ao aplicar, faz um backup antes.
        </p>
        <input ref={file} type="file" accept=".db,.gz" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {!pending ? (
          <button
            disabled={busy}
            onClick={() => file.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-accent-500 disabled:opacity-50 dark:border-zinc-700"
          >
            <Upload className="h-4 w-4" /> {busy ? 'Enviando…' : 'Escolher banco (.db ou .db.gz)'}
          </button>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">{pending.name}</span> traria:
            </p>
            <ul className="list-disc pl-5">
              {mergeLines(pending.report).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await adminApi<{ backup: string; report: MergeReport }>(`/merge/${pending.id}/apply`, { method: 'POST' });
                    setPending(null);
                    setMessage({ ok: true, text: `Merge aplicado (backup antes: ${r.backup}).` });
                  })
                }
                className="rounded-lg accent-control px-3 py-1.5 font-semibold disabled:opacity-50"
              >
                Aplicar
              </button>
              <button
                disabled={busy}
                onClick={() => run(async () => void (await adminApi(`/merge/${pending.id}`, { method: 'DELETE' }), setPending(null)))}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </Box>
    </div>
  );
}
