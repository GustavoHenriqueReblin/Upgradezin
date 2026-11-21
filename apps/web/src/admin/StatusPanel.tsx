import { useEffect, useState, type ReactNode } from 'react';
import type { ServerStatus } from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { formatDuration, formatWhen } from './format.ts';

/** Status do servidor, atualizado a cada 10 s. */
export function StatusPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [s, setS] = useState<ServerStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      adminApi<ServerStatus>('/status')
        .then((r) => alive && (setS(r), setError(false)))
        .catch((err) => {
          if (err instanceof AdminError && err.status === 401) onUnauthorized();
          else if (alive) setError(true);
        });
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [onUnauthorized]);

  if (!s) return <p className="text-zinc-500">{error ? 'Não foi possível ler o status.' : 'Carregando…'}</p>;
  const memPct = Math.round((1 - s.memory.systemFreeMb / s.memory.systemTotalMb) * 100);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Versão">
        <Big>v{s.version}</Big>
        <Sub>{s.commit ? `commit ${s.commit}` : 'commit desconhecido'} · Node {s.node}</Sub>
      </Card>
      <Card title="No ar há">
        <Big>{formatDuration(s.uptimeS)}</Big>
        <Sub>desde {formatWhen(s.startedAt)}</Sub>
      </Card>
      <Card title="Navegador (lojas com Chrome)">
        <Big>{s.browserOpen ? 'Aberto' : 'Fechado'}</Big>
        <Sub>{s.activeSessions ? `${s.activeSessions} coleta(s) usando agora` : 'nenhuma coleta usando agora'}</Sub>
      </Card>
      <Card title="Banco">
        <Big>{s.db.sizeMb} MB</Big>
        <Sub>
          {s.db.file} · WAL {s.db.walMb} MB · migração {s.db.migration}
        </Sub>
      </Card>
      <Card title="Memória do app">
        <Big>{s.memory.rssMb} MB</Big>
        <Sub>heap {s.memory.heapMb} MB</Sub>
      </Card>
      <Card title="Memória da máquina">
        <Big>{memPct}% em uso</Big>
        <Sub>
          {Math.round(s.memory.systemFreeMb)} MB livres de {Math.round(s.memory.systemTotalMb)} MB
        </Sub>
      </Card>
      {error && <p className="text-sm text-amber-600 sm:col-span-2 lg:col-span-3">Última atualização falhou; mostrando a anterior.</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
      {children}
    </div>
  );
}
const Big = ({ children }: { children: ReactNode }) => <div className="text-xl font-semibold tabular-nums">{children}</div>;
const Sub = ({ children }: { children: ReactNode }) => <div className="mt-0.5 text-xs text-zinc-500">{children}</div>;
