import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import {
  CATEGORY_DEFS,
  ENABLED_CATEGORIES,
  productPath,
  type CategoryId,
  type WebAnswer,
  type WebAnswerPage,
  type WebFillInput,
  type WebFillStatus,
} from '@upgradezin/shared';
import { AdminError, adminApi } from './api.ts';
import { Box, Table, Td } from './DataPanels.tsx';
import { countdown, fieldLabels, formatWhen, intervalLabel } from './format.ts';
import { IntervalInputs } from './IntervalInputs.tsx';
import { useLiveReload } from './live.ts';
import { Pager } from './Pager.tsx';
import { Switch } from './Switch.tsx';

type Shared = { fail: (err: unknown) => void; onMessage: (m: { ok: boolean; text: string }) => void };

const select = 'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';
const CONFIDENCE_LABEL = { high: 'alta', medium: 'média', low: 'baixa (não usada)' } as const;
/** Valor longo na coluna Campos (soquetes, placas-mãe): corta aqui, o inteiro fica no "title". */
const FIELD_MAX = 30;
const aiModeUrl =(question: string) => `https://www.google.com/search?udm=50&hl=pt-BR&q=${encodeURIComponent(question)}`;

/**
 * Busca na web das fichas: a rotina (ligar, intervalo, perguntar agora, pausa) e os produtos já
 * perguntados, paginados, com o que voltou (valores aceitos, confiança, o JSON como veio) e "Refazer".
 */
export function WebSearchPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<WebFillStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof AdminError && err.status === 401) return onUnauthorized();
      const errors = err instanceof AdminError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : null;
      setMessage({ ok: false, text: errors?.join(' ') ?? 'Não foi possível agora.' });
    },
    [onUnauthorized],
  );
  const load = useCallback(() => {
    adminApi<WebFillStatus>('/sheets/web').then(setStatus).catch(fail);
  }, [fail]);
  useEffect(load, [load]);
  useLiveReload(['admin'], load, { delayMs: 1_000, fallbackMs: 30_000 });

  /** Pergunta a próxima da fila agora, ou refaz os campos em aberto do produto `key`. */
  const ask = (key?: string) => {
    setAsking(true);
    adminApi<{ answer: WebAnswer | null }>('/sheets/web/ask', { method: 'POST', body: key ? { key } : {} })
      .then(({ answer: a }) => {
        setMessage(
          !a
            ? { ok: false, text: 'Nada perguntado: fila vazia, busca em pausa ou já perguntando.' }
            : a.status === 'blocked'
              ? { ok: false, text: 'O Google pediu verificação ou confirmação da pesquisa: busca na web em pausa, nada guardado.' }
              : {
                  ok: a.status === 'ok',
                  text: `${a.title}: ${
                    a.fields
                      .filter((f) => f.value !== undefined)
                      .map((f) => `${fieldLabels(a.category, [f.field])} = ${String(f.value)}`)
                      .join(', ') || 'nenhum valor'
                  }.`,
                },
        );
        load();
      })
      .catch(fail)
      .finally(() => setAsking(false));
  };

  return (
    <div className="space-y-4">
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>{message.text}</p>}
      {!status ? (
        <Box title="Busca na web">
          <p className="text-sm text-zinc-500">Carregando…</p>
        </Box>
      ) : (
        <Routine status={status} setStatus={setStatus} asking={asking} ask={ask} fail={fail} onMessage={setMessage} />
      )}
      <Answers busy={asking || !!status?.busy} ask={ask} fail={fail} />
    </div>
  );
}

/** A rotina: chave, intervalo, fila, totais, pausa e "Perguntar agora". */
function Routine({
  status,
  setStatus,
  asking,
  ask,
  fail,
  onMessage,
}: Shared & { status: WebFillStatus; setStatus: (s: WebFillStatus) => void; asking: boolean; ask: (key?: string) => void }) {
  const save = (input: WebFillInput, ok: string) =>
    adminApi<WebFillStatus>('/sheets/web', { method: 'PUT', body: input })
      .then((r) => {
        setStatus(r);
        onMessage({ ok: true, text: ok });
      })
      .catch(fail);
  const resume = () =>
    adminApi<WebFillStatus>('/sheets/web/resume', { method: 'POST' })
      .then((r) => {
        setStatus(r);
        onMessage({ ok: true, text: 'Busca na web sem pausa.' });
      })
      .catch(fail);

  return (
    <Box
      title={
        <span className="flex flex-wrap items-center gap-3">
          Busca na web
          <Switch label="Busca na web" on={status.enabled} onChange={(on) => save({ enabled: on }, on ? 'Busca na web ligada.' : 'Busca na web parada.')} />
        </span>
      }
    >
      <p className="text-sm text-zinc-500">
        Para os produtos só a web completa, manda à IA do Google (Modo IA) o JSON da categoria, com os campos em aberto, para ela devolver preenchido; cada valor é validado (tipo, opções e
        faixa) e só preenche o que a ficha não tem. Resposta de confiança baixa não entra. Cada campo é perguntado automaticamente uma vez; o que continuar faltando vai para "precisa de você" (aba Fichas). Usa o
        navegador de uma loja, na fila dela. Se o Google pedir verificação ou confirmação, a busca para por 6 h, sem clicar nem tentar resolver.
      </p>
      {status.pausedUntil && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {status.pauseReason === 'confirmation'
            ? 'O Modo IA do Google pediu para uma pessoa confirmar a pesquisa (proteção para pedidos que chegam pelo endereço; não é clicada sozinha)'
            : 'O Google pediu verificação'}
          : em pausa até {formatWhen(status.pausedUntil)}.
          <button type="button" onClick={() => void resume()} className="rounded border border-amber-500/40 px-2 py-0.5 text-xs hover:border-amber-500">
            Tirar a pausa
          </button>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <IntervalInputs
          key={`${status.interval.minS}-${status.interval.maxS}`}
          interval={status.interval}
          label="uma pergunta a cada"
          title="Entre duas perguntas, um tempo aleatório entre os dois valores. Vale na hora."
          onSave={(i) => void save({ interval: i }, `Busca na web: ${intervalLabel(i)}.`)}
        />
        <span className="tabular-nums text-zinc-500">
          {status.queue.toLocaleString('pt-BR')} produtos na fila · campos: {status.answered.toLocaleString('pt-BR')} com valor, {status.empty.toLocaleString('pt-BR')} vazios
        </span>
        {status.enabled && status.nextAt && !status.pausedUntil && <span className="tabular-nums text-zinc-500">Próxima: {countdown(status.nextAt)}</span>}
        <button
          type="button"
          disabled={asking || status.busy || !status.queue}
          onClick={() => ask()}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1 text-sm hover:border-accent-500 disabled:opacity-50 dark:border-zinc-700"
        >
          <Search className="h-4 w-4" />
          {asking || status.busy ? 'Perguntando…' : 'Perguntar agora'}
        </button>
      </div>
      <ol aria-label="Prioridades da fila" className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        {([
          [1, 'Com Estoque · Vendido pela Própria Loja'],
          [2, 'Sem Estoque · Vendido pela Própria Loja'],
          [3, 'Demais Produtos'],
        ] as const).map(([priority, label]) => (
          <li key={priority} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span>{label}</span>
            <strong className="tabular-nums">{status.queueByPriority[priority].toLocaleString('pt-BR')}</strong>
          </li>
        ))}
      </ol>
    </Box>
  );
}

interface Filters {
  category: CategoryId | '';
  status: 'ok' | 'none' | '';
  q: string;
  page: number;
}

/** Produtos já perguntados, do mais recente, com filtros e paginação. */
function Answers({ busy, ask, fail }: { busy: boolean; ask: (key?: string) => void; fail: (err: unknown) => void }) {
  const [filters, setFilters] = useState<Filters>({ category: '', status: '', q: '', page: 1 });
  const [text, setText] = useState('');
  const [data, setData] = useState<WebAnswerPage | null>(null);
  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(filters.page) });
    if (filters.category) q.set('category', filters.category);
    if (filters.status) q.set('status', filters.status);
    if (filters.q) q.set('q', filters.q);
    adminApi<WebAnswerPage>(`/sheets/web/answers?${q}`).then(setData).catch(fail);
  }, [filters, fail]);
  useEffect(load, [load]);
  useLiveReload(['admin'], load, { delayMs: 1_000, fallbackMs: 60_000 });
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <Box
      title={
        <span className="flex flex-wrap items-center gap-2">
          Já perguntados
          {data && <span className="text-sm font-normal text-zinc-500">{data.total.toLocaleString('pt-BR')}</span>}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={select} value={filters.category} onChange={(e) => set({ category: e.target.value as CategoryId | '' })} aria-label="Categoria">
          <option value="">todas as categorias</option>
          {ENABLED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_DEFS[c].name}
            </option>
          ))}
        </select>
        <select className={select} value={filters.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })} aria-label="Resultado">
          <option value="">qualquer resultado</option>
          <option value="ok">com valor</option>
          <option value="none">sem nenhum valor</option>
        </select>
        <form
          className="flex min-w-0 flex-1 gap-1"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            set({ q: text.trim() });
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Título ou código" maxLength={80} className={`${select} min-w-0 flex-1`} />
          <button type="submit" className="rounded-lg border border-zinc-300 px-2 hover:border-accent-500 dark:border-zinc-700" aria-label="Buscar">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>
      {!data ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : !data.items.length ? (
        <p className="text-sm text-zinc-500">Nenhum produto perguntado com esses filtros.</p>
      ) : (
        <Table head={['Quando', 'Produto', 'Campos', 'Resposta']}>
          {data.items.map((a) => (
            <tr key={`${a.key}|${a.at}`} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <Td className="whitespace-nowrap text-xs text-zinc-500">{formatWhen(a.at)}</Td>
              <Td className="min-w-56 text-xs">
                {a.title}
                <span className="block text-zinc-500">{CATEGORY_DEFS[a.category].name}</span>
                <a
                  href={productPath(a.key)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-accent-600 hover:underline dark:text-accent-400"
                >
                  {a.key} <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => ask(a.key)}
                  title="Apaga as respostas deste produto e pergunta de novo, no formato atual."
                  className="mt-1 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] hover:border-accent-500 disabled:opacity-50 dark:border-zinc-700"
                >
                  Refazer
                </button>
              </Td>
              <Td className="whitespace-nowrap text-xs">
                {a.fields.map((f) => {
                  const v = f.value === undefined ? '' : String(f.value).replace(/,(?=\S)/g, ', ');
                  return (
                    <div key={f.field} title={v.length > FIELD_MAX ? v : undefined}>
                      {fieldLabels(a.category, [f.field])}:{' '}
                      {f.value === undefined ? <span className="text-amber-600 dark:text-amber-400">vazio</span> : v.length > FIELD_MAX ? `${v.slice(0, FIELD_MAX).trimEnd()}…` : v}
                    </div>
                  );
                })}
              </Td>
              <Td className="max-w-md text-xs text-zinc-500">
                <div>{!a.answer ? '(a página não trouxe o JSON da resposta)' : a.confidence ? `confiança: ${CONFIDENCE_LABEL[a.confidence]}` : 'sem confiança informada'}</div>
                {a.answer && (
                  <div className="mt-0.5 line-clamp-3 font-mono text-[10px]" title={a.answer}>
                    {a.answer}
                  </div>
                )}
                <a
                  href={aiModeUrl(a.question)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex items-start gap-1 text-[11px] text-accent-600 hover:underline dark:text-accent-400"
                >
                  <span className="line-clamp-2" title={a.question}>
                    Pergunta feita: {a.question}
                  </span>{' '}
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                </a>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => set({ page })} />}
    </Box>
  );
}
