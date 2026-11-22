import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORY_DEFS, type ActivityInfo, type BackupFile, type MergeReport } from '@upgradezin/shared';
import { Database, Download, Trash2, Upload } from 'lucide-react';
import { AdminError, adminApi, adminUpload } from './api.ts';
import { formatWhen, mergeLines } from './format.ts';
import { useLiveReload } from './live.ts';

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

/** Atividade do site: buscas recentes (sem IP), conexões abertas e quem está no limite. */
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
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Buscas abertas agora" value={a.searchesOpen} />
        <Stat label="Telas de resultado abertas" value={a.watchesOpen} />
        <Stat label="Pessoas desde o reinício" value={a.people} />
        <Stat
          label="No limite agora"
          value={limits ? `${limits} (atualizar ${a.atLimit.force}, texto ${a.atLimit.text}, links ${a.atLimit.share})` : 'ninguém'}
        />
      </div>
      <Box title="Buscas recentes">
        <p className="mb-2 text-xs text-zinc-500">Sem IP: cada pessoa aparece como um apelido que muda a cada reinício do servidor. Guardadas só em memória.</p>
        {!a.recent.length ? (
          <p className="text-sm text-zinc-500">Nenhuma busca desde o reinício.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                {['Quando', 'Pessoa', 'Categoria', 'Termos', 'Lojas', ''].map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.recent.map((r, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-3">{formatWhen(r.at)}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.person}</td>
                  <td className="py-1.5 pr-3">{CATEGORY_DEFS[r.category]?.name ?? r.category}</td>
                  <td className="py-1.5 pr-3">{r.terms.join(', ')}</td>
                  <td className="py-1.5 pr-3">{r.stores.join(', ')}</td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-500">{[r.text && 'texto livre', r.force && 'atualizar'].filter(Boolean).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Box>
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
          className="mb-3 flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-semibold text-accent-950 hover:bg-accent-400 disabled:opacity-50"
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
                <a href={`/api/admin/backups/${encodeURIComponent(b.name)}`} className="ml-auto rounded p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" title="Baixar">
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
                className="rounded-lg bg-accent-500 px-3 py-1.5 font-semibold text-accent-950 hover:bg-accent-400 disabled:opacity-50"
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
