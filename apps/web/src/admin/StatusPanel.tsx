import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ServerStatus } from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { formatDuration, formatWhen } from './format.ts';
import { useLiveReload } from './live.ts';
import { SystemPanel } from './SystemPanel.tsx';

/** Status do servidor, atualizado a cada 10 s. */
export function StatusPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [s, setS] = useState<ServerStatus | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(
    () =>
      void adminApi<ServerStatus>('/status')
        .then((r) => (setS(r), setError(false)))
        .catch((err) => (err instanceof AdminError && err.status === 401 ? onUnauthorized() : setError(true))),
    [onUnauthorized],
  );
  useEffect(load, [load]);
  // Consultas, lojas lendo e mudanças do admin na hora; memória e tempo no ar a cada 10 s.
  useLiveReload(['attempt', 'store', 'admin'], load, { fallbackMs: 10_000, inBackground: true });

  return (
    <div className="space-y-6">
      {!s ? <p className="text-zinc-500">{error ? 'Não foi possível ler o status.' : 'Carregando…'}</p> : (
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
          {error && <p className="text-sm text-amber-600 sm:col-span-2 lg:col-span-3">Última atualização falhou; mostrando a anterior.</p>}
        </div>
      )}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Máquina agora</h2>
        <SystemPanel onUnauthorized={onUnauthorized} />
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 text-xs font-medium text-zinc-500">{title}</div>
      {children}
    </div>
  );
}
const Big = ({ children }: { children: ReactNode }) => <div className="text-xl font-semibold tabular-nums">{children}</div>;
const Sub = ({ children }: { children: ReactNode }) => <div className="mt-0.5 text-xs text-zinc-500">{children}</div>;
