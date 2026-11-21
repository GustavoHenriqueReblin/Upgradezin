import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CATEGORY_DEFS, ENABLED_CATEGORIES, MODE_SECONDS_MAX, MODE_SECONDS_MIN, ROUTINE_MODES, type AdminStoreState, type CategoryId, type RoutineInfo, type RoutineInput, type RoutineMode, type StoreAttempt, type StoreId } from '@upgradezin/shared';
import { Pause, Play, Search } from 'lucide-react';
import { AdminError, adminApi } from './api.ts';
import { attemptLabel, countdown, formatWhen, MODE_LABEL, modeHint, pauseLabel, queueLabel, routineStores, shortDuration } from './format.ts';
import { Switch } from './Switch.tsx';

const PAUSES = [
  { label: '30 min', minutes: 30 },
  { label: '1 h', minutes: 60 },
  { label: '6 h', minutes: 360 },
  { label: '24 h', minutes: 1440 },
];

/** Coleta: rotina (ligada, lojas) e o painel de cada loja (pausa, páginas, últimas consultas, ações). */
export function CollectPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [states, setStates] = useState<AdminStoreState[] | null>(null);
  const [routine, setRoutine] = useState<RoutineInfo | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof AdminError && err.status === 401) return onUnauthorized();
      const errors = err instanceof AdminError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : null;
      setMessage({ ok: false, text: errors?.join(' ') ?? 'Não foi possível agora.' });
    },
    [onUnauthorized],
  );

  const load = useCallback(() => {
    adminApi<AdminStoreState[]>('/stores/state').then(setStates).catch(fail);
    adminApi<RoutineInfo>('/routine').then(setRoutine).catch(fail);
  }, [fail]);

  useEffect(() => {
    load();
    // A cada 5 s: a fila e a contagem mudam a cada consulta.
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      load();
    } catch (err) {
      fail(err);
    }
  };

  if (!states || !routine) return <p className="text-zinc-500">Carregando…</p>;
  // Um switch por loja: a rotina roda nas lojas ligadas, e fica desligada quando nenhuma está.
  const active = routineStores(routine);
  const save = (change: Partial<RoutineInput>, ok: string) => {
    const stores = change.stores ?? active;
    const body: RoutineInput = { ...change, enabled: stores.length > 0, stores };
    return act(() => adminApi<RoutineInfo>('/routine', { method: 'PUT', body }).then(setRoutine), ok);
  };
  const toggleStore = (id: StoreId, name: string, on: boolean) =>
    save({ stores: on ? [...active, id] : active.filter((x) => x !== id) }, `${name}: ${on ? 'entrou na' : 'saiu da'} rotina.`);
  const setMode = (id: StoreId, name: string, mode: RoutineMode) => save({ modes: { [id]: mode } }, `${name}: rotina no modo ${MODE_LABEL[mode].toLowerCase()}.`);
  const setLive = (id: StoreId, name: string, live: boolean) =>
    save({ live: { [id]: live } }, live ? `${name}: consultada na hora quando alguém busca no site.` : `${name}: a busca do site mostra só o banco.`);

  return (
    <div className="space-y-4">
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>{message.text}</p>}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold">Rotina de coleta</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Rotina: em cada loja ligada, o servidor atualiza preços e histórico sozinho, no ritmo do modo. Busca ao vivo: quando alguém pesquisa no site, a loja é consultada na hora (na frente da rotina);
          desmarcada, a busca mostra só o que o banco tem. As duas são independentes e valem na hora.
        </p>

        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {states.map((s) => {
            const mode = routine.modes[s.id];
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">{modeHint(mode, routine.seconds)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-sm" title="Consultar esta loja na hora quando alguém pesquisa no site">
                    <input type="checkbox" checked={routine.live[s.id]} disabled={!s.enabled} onChange={(e) => setLive(s.id, s.name, e.target.checked)} className="h-4 w-4 accent-accent-500" />
                    Busca ao vivo
                  </label>
                  <span role="radiogroup" aria-label={`Modo da rotina na ${s.name}`} className="flex rounded-lg border border-zinc-300 p-0.5 text-xs dark:border-zinc-700">
                    {ROUTINE_MODES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={mode === m}
                        disabled={!s.enabled}
                        onClick={() => mode !== m && setMode(s.id, s.name, m)}
                        className={`rounded-md px-2.5 py-1 font-medium disabled:opacity-50 ${mode === m ? 'bg-accent-500 text-accent-950' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                      >
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </span>
                  <Switch label={`Rotina na ${s.name}`} on={active.includes(s.id)} onChange={(on) => toggleStore(s.id, s.name, on)} disabled={!s.enabled} />
                </span>
              </li>
            );
          })}
        </ul>

        <ModeSeconds key={ROUTINE_MODES.map((m) => routine.seconds[m]).join()} seconds={routine.seconds} onSave={(seconds) => save({ seconds }, 'Intervalos da rotina salvos.')} />

        <div className="mt-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
          {!active.length ? (
            'Nenhuma loja ligada: as lojas só são consultadas quando alguém busca no site ou em "Coletar".'
          ) : (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {routine.busy && (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> rodando agora
                </span>
              )}
              <span>{routine.lastTickAt ? `Última rodada ${formatWhen(routine.lastTickAt)}` : 'Primeira rodada em instantes'}</span>
              {routine.nextTickAt && <span>Próxima {formatWhen(routine.nextTickAt)}</span>}
            </span>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {states.map((s) => (
          <StoreCard key={s.id} s={s} act={act} />
        ))}
      </div>
    </div>
  );
}

/** Segundos entre duas coletas da rotina em cada modo (vale para todas as lojas naquele modo). */
function ModeSeconds({ seconds, onSave }: { seconds: Record<RoutineMode, number>; onSave: (s: Record<RoutineMode, number>) => void }) {
  const [draft, setDraft] = useState<Record<RoutineMode, string>>(() => Object.fromEntries(ROUTINE_MODES.map((m) => [m, String(seconds[m])])) as Record<RoutineMode, string>);
  const parsed = Object.fromEntries(ROUTINE_MODES.map((m) => [m, Number(draft[m])])) as Record<RoutineMode, number>;
  const valid = ROUTINE_MODES.every((m) => Number.isInteger(parsed[m]) && parsed[m] >= MODE_SECONDS_MIN && parsed[m] <= MODE_SECONDS_MAX);
  const changed = ROUTINE_MODES.some((m) => parsed[m] !== seconds[m]);
  return (
    <form
      className="mt-1 flex flex-wrap items-end gap-3 border-t border-zinc-200 py-3 text-sm dark:border-zinc-800"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && changed) onSave(parsed);
      }}
    >
      <span className="w-full text-xs text-zinc-500">Intervalo da rotina em cada modo, em segundos ({MODE_SECONDS_MIN} a {MODE_SECONDS_MAX}). Não afeta a busca do site.</span>
      {ROUTINE_MODES.map((m) => (
        <label key={m} className="flex flex-col gap-1 text-xs text-zinc-500">
          {MODE_LABEL[m]}
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              min={MODE_SECONDS_MIN}
              max={MODE_SECONDS_MAX}
              value={draft[m]}
              onChange={(e) => setDraft({ ...draft, [m]: e.target.value })}
              className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            {Number.isInteger(parsed[m]) && parsed[m] >= 60 && <span>{shortDuration(parsed[m])}</span>}
          </span>
        </label>
      ))}
      <Btn type="submit" disabled={!valid || !changed}>
        Salvar intervalos
      </Btn>
    </form>
  );
}

function StoreCard({ s, act }: { s: AdminStoreState; act: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [category, setCategory] = useState<CategoryId>('gpu');
  const [term, setTerm] = useState('');
  const counts = s.last24h;
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <Box
      title={
        <span className="flex items-center gap-2">
          {s.name} <span className="font-normal text-zinc-500">({s.id})</span>
          {!s.enabled && <Tag tone="zinc">desligada</Tag>}
          {s.pause ? <Tag tone={s.pause.reason === 'paused' ? 'amber' : 'red'}>{pauseLabel(s.pause)}</Tag> : s.enabled && <Tag tone="emerald">consultando</Tag>}
        </span>
      }
    >
      <dl className="space-y-1 text-sm">
        <Row k="Páginas na última hora">
          {s.pagesUsed} de {s.pagesPerHour} <span className="text-zinc-500">(rotina até {s.routinePagesPerHour})</span>
        </Row>
        <Row k="Rotina">{s.inRoutine ? `sim, modo ${MODE_LABEL[s.mode].toLowerCase()}` : 'não'}</Row>
        <Row k="Busca ao vivo">{s.live ? 'sim, na hora' : 'não (só o banco)'}</Row>
        <Row k="Fila">
          <span className="inline-flex items-center gap-1.5">
            {s.queue.running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />}
            {s.queue.running ? 'consultando agora; ' : ''}
            {queueLabel(s.queue)}
          </span>
        </Row>
        {s.queue.running || s.busy ? null : s.nextAt && <Row k="Próxima consulta em"><Countdown at={s.nextAt} /></Row>}
        <Row k="Última coleta boa">{s.lastOk ? <AttemptLine a={s.lastOk} /> : '—'}</Row>
        <Row k="Último bloqueio">{s.lastBlock ? <AttemptLine a={s.lastBlock} /> : '—'}</Row>
        <Row k="Últimas 24 h">
          {total ? `${counts.ok ?? 0} ok · ${counts.blocked ?? 0} bloqueio(s)${counts.error ? ` · ${counts.error} erro(s)` : ''}${counts.partial ? ` · ${counts.partial} parcial(is)` : ''}` : 'nenhuma consulta'}
        </Row>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        {s.pause ? (
          <Btn onClick={() => act(() => adminApi(`/stores/${s.id}/unpause`, { method: 'POST' }), `${s.name}: pausa retirada.`)}>
            <Play className="h-3.5 w-3.5" /> Tirar pausa
          </Btn>
        ) : null}
        {PAUSES.map((p) => (
          <Btn key={p.minutes} subtle onClick={() => act(() => adminApi(`/stores/${s.id}/pause`, { method: 'POST', body: { minutes: p.minutes } }), `${s.name}: pausada por ${p.label}.`)}>
            <Pause className="h-3.5 w-3.5" /> {p.label}
          </Btn>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!term.trim()) return;
          void act(
            () => adminApi<{ startsAt: string }>(`/stores/${s.id}/collect`, { method: 'POST', body: { category, term } }),
            `${s.name}: "${term.trim()}" na fila. O resultado aparece em Consultas.`,
          );
        }}
      >
        <select value={category} onChange={(e) => setCategory(e.target.value as CategoryId)} className="rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950">
          {ENABLED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_DEFS[c].name}
            </option>
          ))}
        </select>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Termo (ex. RTX 3050)"
          maxLength={60}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <Btn type="submit" disabled={!s.enabled || !!s.pause}>
          <Search className="h-3.5 w-3.5" /> Coletar
        </Btn>
      </form>
    </Box>
  );
}

/** Contagem regressiva que anda a cada segundo: "00:08:22 (22:32)". */
function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{countdown(at, now)}</span>;
}

function AttemptLine({ a }: { a: StoreAttempt }) {
  return (
    <span title={a.detail}>
      {formatWhen(a.at)} · {attemptLabel(a)}
    </span>
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

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="flex gap-2">
    <dt className="w-44 shrink-0 text-zinc-500">{k}</dt>
    <dd className="min-w-0">{children}</dd>
  </div>
);

const TONES = {
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  zinc: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
};
const Tag = ({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;

function Btn({ children, subtle, ...rest }: { children: ReactNode; subtle?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
        subtle ? 'border border-zinc-300 hover:border-accent-500 dark:border-zinc-700' : 'bg-accent-500 text-accent-950 hover:bg-accent-400'
      }`}
    >
      {children}
    </button>
  );
}
