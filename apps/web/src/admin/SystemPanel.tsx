import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SystemSnapshot } from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { formatDuration } from './format.ts';

/** A cada quantos ms lê a máquina enquanto o admin está aberto. */
const EVERY_MS = 2000;
/** Pontos nos gráficos: 2 min. */
const HISTORY = 60;

type Point = { cpu: number; mem: number; rx: number; tx: number };

/** Monitor da máquina, tipo um btop: CPU, memória, disco, rede e processos, com o histórico dos últimos 2 min. */
export function SystemPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [s, setS] = useState<SystemSnapshot | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [error, setError] = useState(false);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  useEffect(() => {
    let alive = true;
    let busy = false;
    const load = () => {
      if (busy) return;
      busy = true;
      adminApi<SystemSnapshot>('/system')
        .then((r) => {
          if (!alive) return;
          setS(r);
          setError(false);
          const p = {
            cpu: r.cpu.totalPct,
            mem: r.memory.totalMb ? (r.memory.usedMb / r.memory.totalMb) * 100 : 0,
            rx: r.net?.rxKbps ?? 0,
            tx: r.net?.txKbps ?? 0,
          };
          setHistory((h) => [...h, p].slice(-HISTORY));
        })
        .catch((err) => alive && (err instanceof AdminError && err.status === 401 ? unauthorized.current() : setError(true)))
        .finally(() => (busy = false));
    };
    load();
    const t = setInterval(load, EVERY_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  if (!s) return <p className="text-sm text-zinc-500">{error ? 'Não foi possível ler a máquina.' : 'Lendo a máquina…'}</p>;
  const m = s.memory;
  const netMax = Math.max(1, ...history.map((p) => Math.max(p.rx, p.tx)));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Box title="CPU" right={`${s.cpu.totalPct}%`}>
        <Spark values={history.map((p) => p.cpu)} max={100} tone="text-sky-500" />
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {s.cpu.coresPct.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs tabular-nums">
              <span className="w-7 text-zinc-500">C{i}</span>
              <Bar pct={v} />
              <span className="w-8 text-right">{v}%</span>
            </div>
          ))}
        </div>
        <Sub>
          carga {s.cpu.load.join(' / ')}
          {s.cpu.tempC !== null && <> · {s.cpu.tempC} °C</>} · ligada há {formatDuration(s.uptimeS)}
          {s.cpu.model && (
            <span className="block truncate" title={s.cpu.model}>
              {s.cpu.model}
            </span>
          )}
        </Sub>
      </Box>

      <Box title="Memória" right={`${gb(m.usedMb)} de ${gb(m.totalMb)}`}>
        <Spark values={history.map((p) => p.mem)} max={100} tone="text-violet-500" />
        <div className="mt-2 flex h-3 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800" title="em uso · cache · livre">
          <div className="bg-violet-500" style={{ width: `${(m.usedMb / m.totalMb) * 100}%` }} />
          <div
            className="bg-violet-300 dark:bg-violet-900"
            style={{
              width: `${(Math.min(m.cacheMb, m.availableMb) / m.totalMb) * 100}%`,
            }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-zinc-500">
          <Legend tone="bg-violet-500">em uso {gb(m.usedMb)}</Legend>
          <Legend tone="bg-violet-300 dark:bg-violet-900">cache {gb(m.cacheMb)}</Legend>
          <span>disponível {gb(m.availableMb)}</span>
          {m.swapTotalMb > 0 && (
            <span>
              swap {gb(m.swapUsedMb)} de {gb(m.swapTotalMb)}
            </span>
          )}
        </div>
        <Sub>O cache é devolvido na hora quando um programa precisa: o que conta é o disponível.</Sub>
      </Box>

      <Box title="Rede" right={s.net ? `↓ ${rate(s.net.rxKbps)} · ↑ ${rate(s.net.txKbps)}` : '—'}>
        {s.net ? (
          <div className="relative">
            <Spark values={history.map((p) => p.rx)} max={netMax} tone="text-emerald-500" />
            <div className="absolute inset-0">
              <Spark values={history.map((p) => p.tx)} max={netMax} tone="text-amber-500" />
            </div>
          </div>
        ) : (
          <Sub>Sem leitura de rede nesta máquina (só no Linux).</Sub>
        )}
        {s.net && (
          <div className="mt-1.5 flex gap-4 text-xs text-zinc-500">
            <Legend tone="bg-emerald-500">recebendo</Legend>
            <Legend tone="bg-amber-500">enviando</Legend>
            <span>pico {rate(netMax)}</span>
          </div>
        )}
      </Box>

      <Box title="Disco" right={s.disk ? `${s.disk.usedGb} de ${s.disk.totalGb} GB` : '—'}>
        {s.disk ? (
          <>
            <div className="flex items-center gap-2 text-xs tabular-nums">
              <Bar pct={(s.disk.usedGb / s.disk.totalGb) * 100} />
              <span className="w-9 text-right">{Math.round((s.disk.usedGb / s.disk.totalGb) * 100)}%</span>
            </div>
            <Sub>{(s.disk.totalGb - s.disk.usedGb).toFixed(1)} GB livres na partição raiz</Sub>
          </>
        ) : (
          <Sub>Sem leitura de disco.</Sub>
        )}
      </Box>

      <Box title="Processos" className="lg:col-span-2">
        {s.processes.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Nome</th>
                <th className="py-1 text-right font-medium">Qtd.</th>
                <th className="py-1 text-right font-medium">CPU</th>
                <th className="py-1 text-right font-medium">Memória</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {s.processes.map((p) => (
                <tr key={p.name} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1 font-mono text-xs">{p.name}</td>
                  <td className="py-1 text-right text-xs text-zinc-500">{p.count}</td>
                  <td className="py-1 text-right">{p.cpuPct}%</td>
                  <td className="py-1 text-right">{p.memMb >= 1024 ? gb(p.memMb) : `${p.memMb} MB`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Sub>Lista de processos só no Linux.</Sub>
        )}
        <Sub>Agrupados pelo nome. CPU em % de um núcleo (passa de 100% usando vários). A memória é a própria de cada processo, sem a que eles dividem.</Sub>
      </Box>
      {error && <p className="text-sm text-amber-600 lg:col-span-2">Última leitura falhou; mostrando a anterior.</p>}
    </div>
  );
}

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const rate = (kbps: number) => (kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${Math.round(kbps)} KB/s`);

function Box({ title, right, className = '', children }: { title: string; right?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</span>
        {right && <span className="text-sm font-semibold tabular-nums">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  const tone = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Linha do histórico (mais recente à direita), com a área embaixo. */
function Spark({ values, max, tone }: { values: number[]; max: number; tone: string }) {
  const W = 300;
  const H = 48;
  const pts = values.map((v, i) => [W - (values.length - 1 - i) * (W / (HISTORY - 1)), H - (Math.min(v, max) / max) * (H - 2) - 1] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`h-12 w-full ${tone}`} aria-hidden>
      {pts.length > 1 && (
        <>
          <polygon points={`${pts[0]![0]},${H} ${line} ${W},${H}`} fill="currentColor" opacity={0.15} />
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

const Legend = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1">
    <span className={`inline-block h-2 w-2 rounded-sm ${tone}`} />
    {children}
  </span>
);
const Sub = ({ children }: { children: ReactNode }) => <div className="mt-1.5 text-xs text-zinc-500">{children}</div>;
