import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CATEGORY_DEFS, type AdminStoreState, type CategoryId, type FullSweepSettings, type ProbeResult, type RoutineInfo, type RoutineInput, type StoreAttempt, type StoreId } from '@upgradezin/shared';
import { FlaskConical, Pause, Play, RefreshCw, Square } from 'lucide-react';
import { AdminError, adminApi } from './api.ts';
import { attemptLabel, countdown, probeLabel, formatWhen, intervalLabel, pauseLabel, queueLabel, routineStores } from './format.ts';
import { useLiveReload } from './live.ts';
import { IntervalInputs } from './IntervalInputs.tsx';
import { Switch } from './Switch.tsx';

const PAUSES = [
  { label: '30 min', minutes: 30 },
  { label: '1 h', minutes: 60 },
  { label: '6 h', minutes: 360 },
  { label: '24 h', minutes: 1440 },
];

/** Coleta: rotina de preços (ligada, lojas) e o painel de cada loja (pausa, páginas, últimas consultas, "varredura completa"). */
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

  useEffect(load, [load]);
  // Na hora: loja começou ou terminou uma página, consulta terminou, pausa, mudança pelo admin.
  // A cada 10 s, por garantia (a fila de espera e o fim da pausa pelo tempo não avisam).
  useLiveReload(['attempt', 'store', 'admin'], load, { delayMs: 300, fallbackMs: 10_000 });

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
  const setLive = (id: StoreId, name: string, live: boolean) =>
    save({ live: { [id]: live } }, live ? `${name}: "Não achou? Buscar nas lojas" consulta a loja na hora.` : `${name}: a busca por texto mostra só o banco.`);

  return (
    <div className="space-y-4">
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>{message.text}</p>}

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold">Rotina de preços</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Rotina: em cada loja ligada, o servidor lê cada categoria pela página dela na loja (configurada em Lojas), todas as páginas com estoque, e passa à próxima categoria; a busca do
          site mostra o que ela gravou. Intervalo de listagens: o tempo entre duas páginas de lista da loja ("/fonte", "/fonte" página 2…), na rotina, na varredura completa, na busca e nos testes; as fichas têm o seu, na aba Fichas. A "Varredura completa" de cada loja lê também os esgotados. Busca ao vivo: o "Não achou? Buscar nas lojas" consulta a loja na hora (na frente da rotina); desmarcada, mostra só o banco. As duas são independentes e valem na hora.
        </p>

        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {states.map((s) => {
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-medium">{s.name}</span>
                  <IntervalInputs
                    key={`${s.listInterval.minS}-${s.listInterval.maxS}`}
                    interval={s.listInterval}
                    label="uma página de lista a cada"
                    title="Intervalo de listagens desta loja: entre duas páginas de lista (rotina, varredura completa, busca e testes), um tempo aleatório entre os dois valores. Vale na hora."
                    onSave={(i) => void act(() => adminApi(`/stores/${s.id}/interval`, { method: 'PUT', body: { kind: 'list', ...i } }), `${s.name}: ${intervalLabel(i)} de lista.`)}
                  />
                </span>
                <span className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-sm" title="Buscar o texto nesta loja na hora (Não achou? Buscar nas lojas)">
                    <input type="checkbox" checked={routine.live[s.id]} disabled={!s.enabled} onChange={(e) => setLive(s.id, s.name, e.target.checked)} className="h-4 w-4 accent-accent-500" />
                    Busca ao vivo
                  </label>
                  <Switch label={`Rotina na ${s.name}`} on={active.includes(s.id)} onChange={(on) => toggleStore(s.id, s.name, on)} disabled={!s.enabled} />
                </span>
              </li>
            );
          })}
        </ul>


        <div className="mt-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
          {!active.length ? (
            'Nenhuma loja ligada: as lojas só são consultadas pela busca por texto ou na "Varredura completa".'
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
          {routine.nightly && (
            <p className="mt-1">
              {routine.nightly.hour === null
                ? 'Varredura completa de madrugada: desligada (NIGHTLY_SWEEP_HOUR no .env).'
                : `Varredura completa de madrugada: todo dia às ${String(routine.nightly.hour).padStart(2, '0')}:00, em todas as lojas (pausa as rotinas de preços e de fichas e volta cada uma a como estava)${routine.nightly.nextAt ? `; próxima ${formatWhen(routine.nightly.nextAt)}` : ''}${routine.nightly.lastAt ? `; última ${formatWhen(routine.nightly.lastAt)}` : ''}.`}
            </p>
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

function StoreCard({ s, act }: { s: AdminStoreState; act: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
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
        <Row k="Rotina">{s.inRoutine ? 'sim' : 'não'}</Row>
        {s.fullSweep && (
          <Row k="Varredura completa">
            {CATEGORY_DEFS[s.fullSweep.category].name} ({s.fullSweep.index + 1} de {s.fullSweep.total})
          </Row>
        )}
        <Row k="Busca por texto">{s.live ? 'sim, na hora' : 'não (só o banco)'}</Row>
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

      {/* Testes de página da S2 (página 2 direto e 5 páginas por um endereço próprio): fora da tela; a rota e a lógica continuam. Para voltar, descomente.
      {s.id === 's2' && <ProbeButton s={s} act={act} category="psu" page={2} />}
      {s.id === 's2' && <ProbeButton s={s} act={act} category="psu" page={1} pages={5} path="/hardware/fonte?product_category=6444" />}
      */}

      <FullSweepForm key={JSON.stringify(s.fullSweepSettings)} s={s} act={act} />
    </Box>
  );
}

/**
 * Teste: abre páginas de categoria direto pelo endereço (cada uma numa aba nova, sem passar pelas
 * anteriores), com o intervalo da varredura completa da loja antes de cada uma, e mostra o que a loja
 * devolveu em cada; para na primeira que não abrir. Bloqueio não pausa a loja. Com `path`, o endereço
 * fica editável (um caminho do site, com parâmetros).
 */
function ProbeButton({ s, act, category, page, pages = 1, path }: { s: AdminStoreState; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; category: CategoryId; page: number; pages?: number; path?: string }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [own, setOwn] = useState(path ?? '');
  const name = CATEGORY_DEFS[category].name.toLowerCase();
  const { minS, maxS } = s.listInterval;
  const last = page + pages - 1;
  const what = path !== undefined ? `${own} (páginas ${page} a ${last})` : pages > 1 ? `páginas ${page} a ${last} de ${name}` : `página ${page} de ${name}`;
  const validPath = path === undefined || /^\/(?!\/)[^\s\\]{0,300}$/.test(own);
  const run = async () => {
    setRunning(true);
    setResults(null);
    const body = { category, page, ...(pages > 1 && { pages }), ...(path !== undefined && { path: own }) };
    await act(() => adminApi<ProbeResult[]>(`/stores/${s.id}/probe`, { method: 'POST', body }).then(setResults), `${s.name}: teste de ${what} terminou.`);
    setRunning(false);
  };
  const wait = pages > 1 ? ` Uma página a cada ${minS} a ${maxS} s (o intervalo de listagens), parando na primeira que não abrir.` : '';
  return (
    <div className="mt-3 space-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          subtle
          disabled={running || !s.enabled || !!s.pause || !!s.fullSweep || !validPath}
          title={path !== undefined ? `Abre o endereço numa aba e vai para as páginas seguintes clicando no link da próxima, como a rotina.${wait} Bloqueio não pausa a loja.` : `Abre ${what} direto pelo endereço, numa aba nova, sem passar pelas anteriores. Bloqueio não pausa a loja.`}
          onClick={() => void run()}
        >
          <FlaskConical className={`h-3.5 w-3.5 ${running ? 'animate-pulse' : ''}`} /> {running ? 'Testando…' : path !== undefined ? `Testar páginas ${page} a ${last} de` : `Testar ${what}`}
        </Btn>
        {path !== undefined && (
          <input
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            disabled={running}
            aria-label="Endereço do teste (caminho do site da loja)"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        )}
      </div>
      {running && pages > 1 && <p>Uma página a cada {minS} a {maxS} s: pode levar até {Math.ceil((pages * maxS) / 60)} min.</p>}
      {results?.map((r, i) => (
        <p key={i} className={r.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          Pág. {page + i}: {probeLabel(r)} <span className="break-all text-zinc-500">{r.url}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Varredura completa da loja: as categorias marcadas, guardadas para o botão e a varredura da
 * madrugada. O ritmo é o intervalo de listagens da loja. O botão guarda o que está na tela e começa.
 */
function FullSweepForm({ s, act }: { s: AdminStoreState; act: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const saved = s.fullSweepSettings;
  const [categories, setCategories] = useState<CategoryId[]>(saved.categories);
  const body: FullSweepSettings = { categories: s.sweepCategories.filter((c) => categories.includes(c)) };
  const changed = body.categories.join() !== saved.categories.join();
  const toggle = (c: CategoryId) => setCategories((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const names = body.categories.map((c) => CATEGORY_DEFS[c].name.toLowerCase()).join(', ');

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Btn
          disabled={!s.enabled || !!s.pause || !!s.fullSweep || !body.categories.length}
          title="Pausa a rotina de preços e a de fichas e lê as categorias marcadas desta loja, uma depois da outra, até o fim da lista, no intervalo de listagens: os esgotados também entram no banco (a rotina só lê o que está em estoque). No fim, cada rotina volta a como estava."
          onClick={() =>
            void act(
              () => adminApi<{ startsAt: string }>(`/stores/${s.id}/sweep`, { method: 'POST', body }),
              `${s.name}: varredura completa começou (${names}; esgotados também; ${intervalLabel(s.listInterval)}). As rotinas de preços e de fichas ficam pausadas até ela terminar e voltam sozinhas a como estavam. As páginas aparecem em Consultas; cada volta, em Cobertura.`,
            )
          }
        >
          <RefreshCw className={`h-3.5 w-3.5 ${s.fullSweep ? 'animate-spin' : ''}`} /> {s.fullSweep ? 'Varredura completa rodando' : 'Varredura completa'}
        </Btn>
        {s.fullSweep && (
          <Btn
            subtle
            title="Interrompe a varredura completa desta loja. A categoria do meio volta ao normal e as rotinas voltam a como estavam."
            onClick={() => void act(() => adminApi(`/stores/${s.id}/sweep/stop`, { method: 'POST' }), `${s.name}: varredura completa parada. As rotinas voltam a como estavam.`)}
          >
            <Square className="h-3.5 w-3.5" /> Parar varredura
          </Btn>
        )}
        {changed && (
          <Btn
            subtle
            title="Guarda as categorias sem começar (vale também para a varredura da madrugada)"
            onClick={() => void act(() => adminApi(`/stores/${s.id}/full-sweep`, { method: 'PUT', body }), `${s.name}: categorias da varredura completa salvas (valem também para a da madrugada).`)}
          >
            Salvar categorias
          </Btn>
        )}
      </div>
      {s.sweepCategories.length ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {s.sweepCategories.map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" checked={categories.includes(c)} onChange={() => toggle(c)} />
              {CATEGORY_DEFS[c].name}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">Nenhuma página de categoria configurada nesta loja (aba Lojas).</p>
      )}
    </div>
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
        subtle ? 'border border-zinc-300 hover:border-accent-500 dark:border-zinc-700' : 'accent-control'
      }`}
    >
      {children}
    </button>
  );
}
