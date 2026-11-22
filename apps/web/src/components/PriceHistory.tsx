import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ListingHistory, Offer, StoreId } from '@upgradezin/shared';
import { brl } from '../format.ts';
import { storeName } from '../stores.ts';

/**
 * Histórico de preço de um produto: uma linha em degrau por loja (o preço vale até a próxima
 * mudança), à vista com cupom. Trecho tracejado = sem estoque. Passar o mouse mostra o preço de
 * cada loja naquele dia; "Ver Tabela" lista as mudanças.
 */

const DAY = 86_400_000;
const RANGES = [
  { id: '30', label: '30 Dias', days: 30 },
  { id: '90', label: '90 Dias', days: 90 },
  { id: 'all', label: 'Tudo', days: Infinity },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

/** Cor fixa por loja no gráfico (index.css, .viz). */
const SERIES_VAR: Record<StoreId, string> = { s1: 'var(--viz-s1)', s2: 'var(--viz-s2)', s3: 'var(--viz-s3)' };

/** Anúncio que não aparece há mais que isto saiu da busca da loja: a linha para na última vez visto. */
const GONE_AFTER = 2 * DAY;

interface Series {
  store: StoreId;
  /** Trechos [início, fim) com preço e estoque. */
  steps: { from: number; to: number; price: number; inStock: boolean }[];
}

function toSeries(h: ListingHistory, now: number): Series | null {
  if (!h.points.length) return null;
  const seen = h.lastSeenAt ? Date.parse(h.lastSeenAt) : now;
  const end = now - seen > GONE_AFTER ? seen : now;
  const steps = h.points.map((p, i) => ({
    from: Date.parse(p.at),
    to: i + 1 < h.points.length ? Date.parse(h.points[i + 1]!.at) : end,
    price: p.effectiveCash,
    inStock: p.inStock,
  }));
  return { store: h.store, steps: steps.filter((s) => s.to > s.from || steps.length === 1) };
}

const valueAt = (s: Series, t: number) => s.steps.find((x) => t >= x.from && t <= x.to);

const day = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const dayFull = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Histórico em janela (botão do card da busca). */
export function PriceHistory({ title, offers, onClose }: { title: string; offers: Offer[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Histórico de preço"
        className="viz max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Histórico de Preço</h2>
            <p className="line-clamp-1 text-sm text-zinc-500" title={title}>
              {title}
            </p>
          </div>
          <button onClick={onClose} title="Fechar" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <PriceHistoryBody offers={offers} />
      </div>
    </div>
  );
}

/** Resumo, gráfico e tabela do histórico (na janela ou dentro da página do produto). */
export function PriceHistoryBody({ offers }: { offers: Offer[] }) {
  const [data, setData] = useState<ListingHistory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<RangeId>('90');
  const [table, setTable] = useState(false);

  useEffect(() => {
    const items = offers.map((o) => `${o.store}:${o.storeSku}`).join(',');
    fetch(`/api/prices/history?items=${encodeURIComponent(items)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ListingHistory[]>) : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true));
  }, [offers]);

  const now = useMemo(() => Date.now(), [data]);
  const series = useMemo(() => (data ?? []).map((h) => toSeries(h, now)).filter((s): s is Series => !!s), [data, now]);
  const first = series.length ? Math.min(...series.map((s) => s.steps[0]!.from)) : now;
  const days = RANGES.find((r) => r.id === range)!.days;
  const x0 = Number.isFinite(days) ? Math.max(first, now - days * DAY) : first;

  // Resumo: preço agora (menor entre as lojas com estoque) e menor/maior do período escolhido.
  const inWindow = series.flatMap((s) => s.steps.filter((x) => x.to >= x0 && x.inStock).map((x) => ({ ...x, store: s.store })));
  const nowPrices = series.map((s) => ({ store: s.store, v: valueAt(s, now) })).filter((x) => x.v?.inStock && x.v.to >= now - GONE_AFTER);
  const current = nowPrices.length ? nowPrices.reduce((a, b) => (b.v!.price < a.v!.price ? b : a)) : null;
  const low = inWindow.length ? inWindow.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const high = inWindow.length ? inWindow.reduce((a, b) => (b.price > a.price ? b : a)) : null;

  return (
    <div className="viz">
      {failed ? (
        <p className="py-10 text-center text-sm text-zinc-500">Não foi possível carregar o histórico agora.</p>
      ) : !data ? (
        <p className="py-10 text-center text-sm text-zinc-500">Carregando…</p>
      ) : !series.length ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          Ainda sem histórico. Os preços passam a ser guardados quando este produto é coletado.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Agora" value={current ? brl(current.v!.price) : '—'} sub={current ? storeName(current.store) : 'sem estoque'} />
            <Stat label="Menor no Período" value={low ? brl(low.price) : '—'} sub={low ? `${storeName(low.store)}, ${day(Math.max(low.from, x0))}` : ''} />
            <Stat label="Maior no Período" value={high ? brl(high.price) : '—'} sub={high ? `${storeName(high.store)}, ${day(Math.max(high.from, x0))}` : ''} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  range === r.id ? 'bg-accent-500 text-accent-950' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                {r.label}
              </button>
            ))}
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
              {series.map((s) => (
                <span key={s.store} className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded" style={{ backgroundColor: SERIES_VAR[s.store] }} />
                  {storeName(s.store)}
                </span>
              ))}
            </div>
          </div>

          {table ? <HistoryTable data={data} /> : <Chart series={series} x0={x0} x1={now} />}

          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
            <span>À vista com cupom. Tracejado: sem estoque. Acompanhado desde {dayFull(first)}.</span>
            <button onClick={() => setTable((v) => !v)} className="font-medium text-accent-600 hover:underline dark:text-accent-400">
              {table ? 'Ver Gráfico' : 'Ver Tabela'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-base font-bold tabular-nums sm:text-lg">{value}</div>
      <div className="truncate text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

const H = 240;
const M = { top: 12, right: 76, bottom: 26, left: 64 };

function Chart({ series, x0, x1 }: { series: Series[]; x0: number; x1: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Faixa de preço do período (com o preço que já valia no começo), com folga em cima e embaixo.
  const visible = series.flatMap((s) => s.steps.filter((x) => x.to >= x0).map((x) => x.price));
  let lo = Math.min(...visible);
  let hi = Math.max(...visible);
  if (hi - lo < 1) {
    lo -= 10;
    hi += 10;
  }
  const pad = (hi - lo) * 0.12;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const span = Math.max(x1 - x0, DAY);
  const iw = w - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const X = (t: number) => M.left + ((Math.max(t, x0) - x0) / span) * iw;
  const Y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * ih;

  const yTicks = niceTicks(lo, hi, 4);
  const nTicks = Math.min(5, Math.max(2, Math.round(span / DAY)));
  const xTicks = Array.from({ length: nTicks }, (_, i) => x0 + (span * i) / (nTicks - 1));

  // Rótulo no fim de cada linha (nome da loja), afastados para não se sobreporem.
  const ends = series
    .map((s) => {
      const last = s.steps[s.steps.length - 1]!;
      return { store: s.store, y: Y(last.price), x: X(last.to) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < M.left || px > M.left + iw) return setHover(null);
    setHover(x0 + ((px - M.left) / iw) * span);
  };
  const tip = hover !== null ? series.map((s) => ({ store: s.store, v: valueAt(s, hover) })).filter((x) => x.v) : [];

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={H} className="block touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + iw} y1={Y(v)} y2={Y(v)} stroke="var(--viz-grid)" />
            <text x={M.left - 8} y={Y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-axis)" className="tabular-nums">
              {brl(v).replace(',00', '')}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--viz-axis)">
            {day(t)}
          </text>
        ))}

        {series.map((s) =>
          s.steps
            .filter((x) => x.to >= x0)
            .map((x, i, arr) => {
              const next = arr[i + 1];
              // Degrau: horizontal até a próxima mudança, depois vertical até o novo preço.
              const d = `M${X(x.from)},${Y(x.price)}H${X(x.to)}${next ? `V${Y(next.price)}` : ''}`;
              return (
                <path
                  key={`${s.store}-${i}`}
                  d={d}
                  fill="none"
                  stroke={SERIES_VAR[s.store]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={x.inStock ? undefined : '4 4'}
                />
              );
            }),
        )}

        {ends.map((e) => (
          <text key={e.store} x={Math.min(e.x, M.left + iw) + 8} y={e.y} dy="0.32em" fontSize={11} fill="currentColor" className="text-zinc-600 dark:text-zinc-300">
            {storeName(e.store)}
          </text>
        ))}

        {hover !== null && (
          <g pointerEvents="none">
            <line x1={X(hover)} x2={X(hover)} y1={M.top} y2={M.top + ih} stroke="var(--viz-axis)" strokeDasharray="2 3" />
            {tip.map((t) => (
              <circle key={t.store} cx={X(hover)} cy={Y(t.v!.price)} r={4.5} fill={SERIES_VAR[t.store]} stroke="var(--viz-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>

      {hover !== null && tip.length > 0 && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900"
          style={X(hover) > w / 2 ? { right: w - X(hover) + 12 } : { left: X(hover) + 12 }}
        >
          <div className="mb-1 font-semibold">{dayFull(hover)}</div>
          {[...tip]
            .sort((a, b) => a.v!.price - b.v!.price)
            .map((t) => (
              <div key={t.store} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SERIES_VAR[t.store] }} />
                <span className="text-zinc-600 dark:text-zinc-300">{storeName(t.store)}</span>
                <span className="ml-auto pl-3 font-semibold tabular-nums">{brl(t.v!.price)}</span>
                {!t.v!.inStock && <span className="text-red-500">esgotado</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Ticks "redondos" (1, 2, 5 × 10ⁿ) dentro da faixa. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

function HistoryTable({ data }: { data: ListingHistory[] }) {
  const rows = data
    .flatMap((h) => h.points.map((p) => ({ ...p, store: h.store })))
    .sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800">
          <tr>
            <th className="px-3 py-2 font-medium">Data</th>
            <th className="px-3 py-2 font-medium">Loja</th>
            <th className="px-3 py-2 text-right font-medium">À Vista com Cupom</th>
            <th className="px-3 py-2 font-medium">Estoque</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={`${r.store}-${r.at}`}>
              <td className="px-3 py-1.5 tabular-nums">{new Date(r.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
              <td className="px-3 py-1.5">{storeName(r.store)}</td>
              <td className="px-3 py-1.5 text-right font-medium tabular-nums">{brl(r.effectiveCash)}</td>
              <td className="px-3 py-1.5">{r.inStock ? 'Sim' : <span className="text-red-500">Esgotado</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
