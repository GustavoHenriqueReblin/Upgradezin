import {
  ENABLED_CATEGORIES,
  parseWebReply,
  STORE_INTERVAL_S_MAX,
  STORE_INTERVAL_S_MIN,
  WEB_PARSER_VERSION,
  WEB_PROMPT_VERSION,
  webKeys,
  webPrompt,
  type CategoryId,
  type SheetValue,
  type StoreId,
  type WebAnswer,
  type WebFillInput,
  type WebFillSettings,
  type WebAnswerFilter,
  type WebAnswerPage,
  type WebFillStatus,
  type WebQueuePriority,
  type WebSheetState,
  type SheetProduct,
} from '@upgradezin/shared';
import { pageOf } from '../admin/paging.ts';
import { loadPage, saveDebugHtml } from '../browser.ts';
import { emitChange } from '../changes.ts';
import { config } from '../config.ts';
import { getMeta, setMeta, type Db } from '../db/db.ts';
import { getDb } from '../db/instance.ts';
import { backoffInfo, BlockedError, jitter, withStore } from '../pace.ts';
import { ACTIVE_STORES } from '../stores.ts';
import { withBrowserSession } from './collect.ts';
import { catalogProducts, ready, SHEET_SCOPE_DAYS } from './sheets.ts';

/**
 * Busca na web: completa o que nenhuma página das lojas nem o título trouxe. Para cada produto "só a
 * web completa" (ficha incompleta, com a página de todas as lojas lida), manda à IA do Google (Modo IA)
 * o JSON de resposta da categoria, com os campos em aberto, para ela devolver preenchido
 * (webPrompt), e lê cada chave validando tipo e faixa (parseWebReply). Resposta de confiança baixa, ou
 * sem o JSON, conta como sem resposta. Cada produto é perguntado uma vez: sheet_web guarda cada campo,
 * com ou sem valor, e o JSON da resposta como veio. Página sem resposta nenhuma (sem o JSON) não conta como
 * perguntado: o produto espera EMPTY_RETRY_MS e é perguntado de novo, até EMPTY_TRIES vezes.
 *
 * Usa o Chrome de uma das lojas, na fila dela (uma página por vez, com o intervalo de fichas da loja),
 * sem contar no limite de páginas da loja. O buscador pedindo verificação ("tráfego incomum") pausa a
 * busca na web por BLOCK_PAUSE_H, sem tentar resolver e sem pausar a loja.
 */

/** Pausa depois de o buscador pedir verificação. */
export const BLOCK_PAUSE_H = 6;
const CHECK_MS = 5_000;
const FIRST_MS = 20_000;
const IDLE_MS = 5 * 60_000;
/** Espera a resposta da IA (ela chega aos poucos, depois da página) antes de ler de novo. */
const ANSWER_WAIT_MS = 10_000;
/** Página sem resposta: espera para perguntar de novo, e quantas vezes tenta antes de contar como perguntado. */
export const EMPTY_RETRY_MS = 6 * 3_600_000;
export const EMPTY_TRIES = 3;
const emptyReplies = new Map<string, { tries: number; until: number }>();

const DEFAULTS: WebFillSettings = { enabled: false, interval: { minS: 90, maxS: 150 } };

const validInterval = (i: unknown): i is WebFillSettings['interval'] => {
  const v = i as WebFillSettings['interval'] | undefined;
  return !!v && Number.isInteger(v.minS) && Number.isInteger(v.maxS) && v.minS >= STORE_INTERVAL_S_MIN && v.maxS <= STORE_INTERVAL_S_MAX && v.minS <= v.maxS;
};
const sanitize = (s: WebFillInput, base: WebFillSettings): WebFillSettings => ({
  enabled: typeof s.enabled === 'boolean' ? s.enabled : base.enabled,
  interval: validInterval(s.interval) ? { minS: s.interval.minS, maxS: s.interval.maxS } : { ...base.interval },
});

let settings: WebFillSettings = { ...DEFAULTS, interval: { ...DEFAULTS.interval } };
let persist: ((s: WebFillSettings) => void) | undefined;
let pausedUntil = 0;
let pauseReason: 'verification' | 'confirmation' = 'verification';
let persistPause: ((until: number) => void) | undefined;

/** Guarda a configuração (meta "web-fill") e a pausa (meta "web-fill-pause"). */
export function useWebFillStorage(db: Db): void {
  const saved = getMeta(db, 'web-fill');
  settings = saved ? sanitize(JSON.parse(saved) as WebFillInput, DEFAULTS) : { ...DEFAULTS, interval: { ...DEFAULTS.interval } };
  persist = (s) => setMeta(db, 'web-fill', JSON.stringify(s));
  pausedUntil = Number(getMeta(db, 'web-fill-pause') ?? 0) || 0;
  pauseReason = getMeta(db, 'web-fill-pause-reason') === 'confirmation' ? 'confirmation' : 'verification';
  persistPause = (until) => (setMeta(db, 'web-fill-pause', String(until)), setMeta(db, 'web-fill-pause-reason', pauseReason));
}

export const webFillSettings = (): WebFillSettings => ({ ...settings, interval: { ...settings.interval } });

let timer: NodeJS.Timeout | undefined;
let ac = new AbortController();
let nextAt = 0;
let busy = false;

export function setWebFill(next: WebFillInput): WebFillSettings {
  const was = settings.enabled;
  settings = sanitize(next, settings);
  persist?.(settings);
  if (was !== settings.enabled) {
    stopWebFill();
    startWebFill();
  }
  return webFillSettings();
}

export function startWebFill(): void {
  if (timer || !settings.enabled) return;
  if (ac.signal.aborted) ac = new AbortController();
  nextAt = Date.now() + FIRST_MS;
  timer = setInterval(() => void webFillTick(), CHECK_MS);
}

export function stopWebFill(): void {
  clearInterval(timer);
  timer = undefined;
  nextAt = 0;
  ac.abort();
}

// ---------- fila ----------

const webSince = (now: number) => new Date(now - SHEET_SCOPE_DAYS * 86_400_000).toISOString();
const sheetState = (p: SheetProduct): WebSheetState => p.needsHuman ? 'manual' : p.state;

/** Uma pergunta a fazer: o JSON da categoria para um produto só a web completa (fields: as chaves dele). */
export interface WebQuestion {
  key: string;
  category: CategoryId;
  fields: string[];
  title: string;
  question: string;
}

/**
 * Perguntas na fila: um produto com as páginas todas lidas por pergunta, se algum campo vazio (principal
 * ou opcional, o "não sei") ainda não foi perguntado. O produto completo com opcional vazio também vai:
 * já aparece na busca do site, e a web completa a ficha. A melhor oferta do produto define a prioridade.
 * Dentro de cada prioridade, campo principal primeiro, depois estoque e descoberta mais recente.
 */
export function webQueue(db: Db, now = Date.now(), retryKey?: string): (WebQuestion & { priority: WebQueuePriority })[] {
  const since = webSince(now);
  const out: (WebQuestion & { priority: WebQueuePriority; main: boolean; inStock: boolean; first: string })[] = [];
  const asked = new Set((ready(db).prepare("SELECT product_key || '|' || field AS k FROM sheet_web").all() as { k: string }[]).map((r) => r.k));
  for (const category of ENABLED_CATEGORIES) {
    for (const p of catalogProducts(db, category, since)) {
      if (p.completedManually || p.state === 'unread' || !p.listings.every((l) => l.read)) continue;
      if (retryKey && p.key !== retryKey) continue;
      if (!retryKey && (emptyReplies.get(p.key)?.until ?? 0) > now) continue;
      const gaps = new Set([...p.missing, ...p.gaps]);
      const fields = webKeys(category).map((k) => k.field).filter((field) => retryKey
        ? gaps.has(field) || p.origin[field]?.from === 'estimate'
        : gaps.has(field) && !asked.has(`${p.key}|${field}`));
      if (!fields.length) continue;
      const ownRetail = p.listings.filter((listing) => listing.ownRetail);
      const priority = ownRetail.some((listing) => listing.inStock) ? 1 : ownRetail.length ? 2 : 3;
      out.push({
        priority,
        key: p.key,
        category,
        fields,
        title: p.title,
        question: webPrompt(category, p.title, fields, p.values),
        main: p.missing.length > 0,
        inStock: p.listings.some((l) => l.inStock),
        first: p.listings.map((l) => l.firstSeenAt).sort().pop() ?? '',
      });
    }
  }
  out.sort((a, b) => a.priority - b.priority || Number(b.main) - Number(a.main) || Number(b.inStock) - Number(a.inStock) || b.first.localeCompare(a.first));
  return out.map(({ main: _m, inStock: _i, first: _f, ...q }) => q);
}

// ---------- página de resultados ----------

/** Pedido de verificação: o endereço /sorry/ ou o aviso na página (no texto visível, não nos scripts). */
const BLOCKED_URL = /\/sorry\//;
const BLOCKED = /tr[aá]fego incomum|unusual traffic|n[aã]o sou um rob[oô]|not a robot/i;
/**
 * Confirmação do Modo IA para pedido que chega pelo endereço ("Continuar com esta pesquisa? Consultas
 * maliciosas podem resultar em ações não seguras"): é uma proteção que pede uma pessoa. Não é clicada:
 * a busca na web pausa e o admin avisa.
 */
const CONFIRM = /continuar com esta pesquisa|consultas maliciosas|continue with this search|malicious queries/i;

/** Texto visível da página em linhas, sem scripts, estilos, título nem a caixa de busca (que repetem o pedido). */
export function pageLines(html: string): string[] {
  const text = html
    .replace(/<(script|style|noscript|svg|title|textarea)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|ul|ol|section|article|tr|pre)>/gi, '$&\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** O que a página de resultados trouxe: o texto visível (para achar o JSON da resposta), o pedido de verificação ou a confirmação do Modo IA. */
export function googlePage(html: string, url = ''): { blocked: false | 'verification' | 'confirmation'; text: string } {
  const lines = pageLines(html);
  const text = lines.join(' ');
  const answered = /\{\s*"produto"\s*:[^}]*"confianca"\s*:\s*"/.test(text);
  if (BLOCKED_URL.test(url) || (lines.some((l) => BLOCKED.test(l)) && !answered)) return { blocked: 'verification', text: '' };
  if (lines.some((l) => CONFIRM.test(l)) && !answered) return { blocked: 'confirmation', text: '' };
  return { blocked: false, text };
}

/** Endereço do pedido no Modo IA do Google (udm=50): responde ao pedido inteiro, no formato pedido. */
export const googleUrl = (question: string) => `https://www.google.com/search?udm=50&hl=pt-BR&q=${encodeURIComponent(question)}`;

// ---------- perguntas ----------

/** Loja cujo Chrome faz a pergunta: a primeira ativa que não está em pausa. */
const browserStore = (): StoreId | undefined => ACTIVE_STORES.find((s) => !backoffInfo(s));

/** Faz o pedido de um produto e guarda a resposta de cada campo. Pedido de verificação: pausa a busca na web (não guarda: volta depois). */
export async function askWeb(db: Db, q: WebQuestion, signal: AbortSignal, now = () => Date.now()): Promise<WebAnswer | null> {
  const store = browserStore();
  if (!store) return null;
  const page = await withStore(
    store,
    signal,
    () =>
      loadPage(store, googleUrl(q.question), {
        signal,
        recheck: (p) => !BLOCKED_URL.test(p.url) && !CONFIRM.test(p.html) && !parseWebReply(q.category, pageLines(p.html).join(' ')),
        recheckMs: ANSWER_WAIT_MS,
      }),
    { kind: 'sheet' },
  );
  const at = new Date(now()).toISOString();
  const base = { key: q.key, category: q.category, title: q.title, question: q.question, store, at };
  const { blocked, text } = googlePage(page.html, page.url);
  if (blocked) {
    pauseReason = blocked;
    pausedUntil = now() + BLOCK_PAUSE_H * 3_600_000;
    persistPause?.(pausedUntil);
    if (config.DEBUG_DUMPS) await saveDebugHtml(store, page.html, blocked === 'confirmation' ? 'web-confirmacao' : 'web-bloqueio');
    emitChange('admin');
    return { ...base, answer: '', fields: q.fields.map((field) => ({ field })), status: 'blocked' };
  }
  const reply = parseWebReply(q.category, text, q.question);
  if (!reply && config.DEBUG_DUMPS) await saveDebugHtml(store, page.html, `web-sem-json-${q.category}`);
  // Sem resposta nenhuma: não grava (não conta como perguntado); tenta de novo mais tarde, até EMPTY_TRIES vezes.
  if (reply) emptyReplies.delete(q.key);
  else {
    const tries = (emptyReplies.get(q.key)?.tries ?? 0) + 1;
    if (tries < EMPTY_TRIES) {
      emptyReplies.set(q.key, { tries, until: now() + EMPTY_RETRY_MS });
      return { ...base, answer: '', fields: q.fields.map((field) => ({ field })), status: 'none' };
    }
    emptyReplies.delete(q.key);
  }
  const fields = q.fields.map((field) => {
    const value = reply?.values[field];
    return { field, ...(value !== undefined && { value }) };
  });
  const answer = reply ? JSON.stringify(reply.raw).slice(0, 3000) : '';
  const insert = ready(db).prepare(
    `INSERT OR REPLACE INTO sheet_web (product_key, field, category, title, question, answer, value, status, store, asked_at, confidence, sources)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const since = webSince(Date.parse(at));
  const currentState = () => catalogProducts(db, q.category, since, [q.key]).map(sheetState)[0];
  let sheetBefore: WebSheetState | undefined;
  let sheetAfter: WebSheetState | undefined;
  db.exec('BEGIN');
  try {
    sheetBefore = currentState();
    for (const f of fields) insert.run(
        q.key,
        f.field,
        q.category,
        q.title,
        q.question,
        answer,
        f.value === undefined ? null : JSON.stringify(f.value),
        f.value === undefined ? 'none' : 'ok',
        store,
        at,
        reply?.confidence ?? null,
        null,
      );
    sheetAfter = currentState();
    if (sheetBefore && sheetAfter) {
      db.prepare('INSERT OR REPLACE INTO sheet_web_transition VALUES (?, ?, ?, ?)').run(q.key, at, sheetBefore, sheetAfter);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  emitChange('admin');
  return {
    ...base,
    answer,
    fields,
    ...(sheetBefore && sheetAfter && { sheetBefore, sheetAfter }),
    ...(reply?.confidence && { confidence: reply.confidence }),
    status: fields.some((f) => f.value !== undefined) ? 'ok' : 'none',
  };
}

/**
 * Relê as respostas guardadas quando o leitor da resposta muda (WEB_PARSER_VERSION): recupera o que o leitor antigo
 * perdia, sem perguntar de novo. As de página sem resposta nenhuma saem (voltam à fila para perguntar de novo).
 */
export function rereadWebAnswers(db: Db, force = false): { changed: number; requeued: number } {
  const stamp = String(WEB_PARSER_VERSION);
  if (!force && getMeta(ready(db), 'web-parser') === stamp) return { changed: 0, requeued: 0 };
  const rows = db.prepare("SELECT product_key, field, category, question, answer, value FROM sheet_web WHERE answer <> ''").all() as {
    product_key: string; field: string; category: CategoryId; question: string; answer: string; value: string | null;
  }[];
  const update = db.prepare("UPDATE sheet_web SET value = ?, status = ? WHERE product_key = ? AND field = ?");
  const remove = db.prepare('DELETE FROM sheet_web WHERE product_key = ? AND field = ?');
  const noneKeys = new Map<string, string>();
  const parsed = new Map<string, ReturnType<typeof parseWebReply>>();
  let changed = 0;
  let requeuedLists = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const k = `${r.category}|${r.answer}|${r.question}`;
      if (!parsed.has(k)) parsed.set(k, parseWebReply(r.category, r.answer, r.question));
      const reply = parsed.get(k);
      // Lista vazia num pedido antigo (o modelo trazia []): não dá para saber se é "não tem"; volta à fila para perguntar com o modelo novo.
      const key = noneKeys.get(`${r.category}|${r.field}`) ?? (() => {
        const w = webKeys(r.category).find((x) => x.field === r.field);
        const name = w && w.type === 'list' && w.none !== undefined ? w.key : '';
        noneKeys.set(`${r.category}|${r.field}`, name);
        return name;
      })();
      const rv = key ? reply?.raw[key] : undefined;
      if (r.value === null && Array.isArray(rv) && !rv.length && r.question.includes(`"${key}":[]`)) {
        remove.run(r.product_key, r.field);
        requeuedLists++;
        continue;
      }
      const v = reply?.values[r.field];
      const value = v === undefined ? null : JSON.stringify(v);
      if (value === r.value) continue;
      update.run(value, value === null ? 'none' : 'ok', r.product_key, r.field);
      changed++;
    }
    const requeued = Number(db.prepare("DELETE FROM sheet_web WHERE answer = ''").run().changes) + requeuedLists;
    setMeta(db, 'web-parser', stamp);
    db.exec('COMMIT');
    return { changed, requeued };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * A pergunta mudou (WEB_PROMPT_VERSION): os campos que a web deixou sem valor voltam a ela uma vez, com a pergunta nova. Vale para
 * todo produto, não só para o que já está em "precisa de você": o que ainda tinha um campo novo a perguntar (código do chip) não
 * estava lá na hora, e o campo antigo sem resposta ficava para uma pessoa depois. Os que a web respondeu ficam; a ficha completada à
 * mão fica como está. Devolve quantos produtos voltaram.
 */
export function requeueHumanReview(db: Db, now = Date.now(), force = false): number {
  const stamp = String(WEB_PROMPT_VERSION);
  if (!force && getMeta(ready(db), 'web-prompt') === stamp) return 0;
  const since = webSince(now);
  const unanswered = db.prepare('DELETE FROM sheet_web WHERE product_key = ? AND value IS NULL');
  let products = 0;
  db.exec('BEGIN');
  try {
    for (const category of ENABLED_CATEGORIES) {
      for (const p of catalogProducts(db, category, since)) if (!p.completedManually && Number(unanswered.run(p.key).changes) > 0) products++;
    }
    setMeta(db, 'web-prompt', stamp);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return products;
}

const valueText = (r: WebAnswer) =>
  r.fields
    .filter((f) => f.value !== undefined)
    .map((f) => `${f.field}=${String(f.value)}`)
    .join(' ') || 'sem valores';

/** Confere a agenda: na hora, sem pausa e sem pergunta em andamento, faz a próxima. */
export async function webFillTick(now = Date.now()): Promise<void> {
  if (busy || !settings.enabled || now < nextAt || now < pausedUntil) return;
  busy = true;
  try {
    const [q] = webQueue(getDb(), now);
    if (!q) {
      nextAt = Date.now() + IDLE_MS;
      return;
    }
    const r = await withBrowserSession(() => askWeb(getDb(), q, ac.signal));
    if (r) console.info(`[web] ${q.category} ${q.key}: ${r.status === 'blocked' ? `${pauseReason === 'confirmation' ? 'confirmação do Modo IA pedida' : 'verificação pedida'}, pausa de ${BLOCK_PAUSE_H} h` : valueText(r)}`);
    nextAt = Date.now() + (r ? jitter(settings.interval.minS * 1000, settings.interval.maxS * 1000) : IDLE_MS);
  } catch (err) {
    if (!ac.signal.aborted && !(err instanceof BlockedError)) console.error('[web] pergunta falhou:', err);
    nextAt = Date.now() + IDLE_MS;
  } finally {
    busy = false;
  }
}

/**
 * Pergunta agora (botão do admin), fora da agenda; respeita a pausa. Com `key`, refaz os campos faltantes ou estimados do produto, preservando os valores encontrados.
 */
export async function askNextNow(db: Db, key?: string): Promise<WebAnswer | null> {
  if (busy || Date.now() < pausedUntil) return null;
  const [q] = webQueue(db, Date.now(), key);
  if (!q) return null;
  busy = true;
  try {
    return await withBrowserSession(() => askWeb(db, q, ac.signal.aborted ? new AbortController().signal : ac.signal));
  } finally {
    busy = false;
  }
}

/** Tira a pausa (admin). */
export function clearWebPause(): void {
  pausedUntil = 0;
  persistPause?.(0);
}

type WebRow = {
  product_key: string;
  category: CategoryId;
  field: string;
  title: string;
  question: string;
  answer: string;
  value: string | null;
  store: StoreId;
  asked_at: string;
  confidence: string | null;
  before_state: WebSheetState | null;
  after_state: WebSheetState | null;
};

/** Situação para o admin: configuração, fila, totais e pausa. */
export function webFillStatus(db: Db): WebFillStatus {
  const totals = ready(db).prepare("SELECT sum(status = 'ok') AS ok, sum(status = 'none') AS none FROM sheet_web").get() as { ok: number | null; none: number | null };
  const queue = webQueue(db);
  const queueByPriority = { 1: 0, 2: 0, 3: 0 };
  for (const { priority } of queue) queueByPriority[priority]++;
  return {
    ...webFillSettings(),
    queue: queue.length,
    queueByPriority,
    answered: totals.ok ?? 0,
    empty: totals.none ?? 0,
    pausedUntil: pausedUntil > Date.now() ? new Date(pausedUntil).toISOString() : null,
    pauseReason: pausedUntil > Date.now() ? pauseReason : null,
    nextAt: timer && nextAt ? new Date(nextAt).toISOString() : null,
    busy,
  };
}

/** Produtos já perguntados (uma linha por pergunta: produto + hora), do mais recente, filtrados e paginados. */
export function webAnswers(db: Db, f: WebAnswerFilter): WebAnswerPage {
  const { page, pageSize, offset } = pageOf(f);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.category) where.push('category = ?'), args.push(f.category);
  const q = f.q?.trim().toLowerCase();
  if (q) where.push('(lower(title) LIKE ? OR lower(product_key) LIKE ?)'), args.push(`%${q}%`, `%${q}%`);
  const having = f.status === 'ok' ? "HAVING sum(status = 'ok') > 0" : f.status === 'none' ? "HAVING sum(status = 'ok') = 0" : '';
  const groups = `SELECT product_key, asked_at FROM sheet_web ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY product_key, asked_at ${having}`;
  const total = (ready(db).prepare(`SELECT count(*) AS n FROM (${groups})`).get(...args) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT w.product_key, w.category, w.field, w.title, w.question, w.answer, w.value, w.store, w.asked_at, w.confidence, t.before_state, t.after_state FROM sheet_web w
       JOIN (${groups} ORDER BY asked_at DESC LIMIT ? OFFSET ?) r ON r.product_key = w.product_key AND r.asked_at = w.asked_at
       LEFT JOIN sheet_web_transition t ON t.product_key = w.product_key AND t.asked_at = w.asked_at
       ORDER BY w.asked_at DESC`,
    )
    .all(...args, pageSize, offset) as WebRow[];
  const items = new Map<string, WebAnswer>();
  for (const r of rows) {
    const k = `${r.product_key}|${r.asked_at}`;
    let a = items.get(k);
    if (!a) {
      const conf = r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : undefined;
      a = { key: r.product_key, category: r.category, title: r.title, question: r.question, answer: r.answer, fields: [], ...(conf && { confidence: conf }), status: 'none', store: r.store, at: r.asked_at };
      if (r.before_state && r.after_state) Object.assign(a, { sheetBefore: r.before_state, sheetAfter: r.after_state });
      items.set(k, a);
    }
    a.fields.push({ field: r.field, ...(r.value !== null && { value: JSON.parse(r.value) as SheetValue }) });
    if (r.value !== null) a.status = 'ok';
  }
  // Respostas antigas só conseguem mostrar o estado atual, sem inferir o estado da época.
  const historical = [...items.values()].filter((item) => !item.sheetAfter);
  for (const category of new Set(historical.map((item) => item.category))) {
    const subset = historical.filter((item) => item.category === category);
    const current = new Map(catalogProducts(db, category, '', [...new Set(subset.map((item) => item.key))]).map((p) => [p.key, sheetState(p)]));
    for (const item of subset) item.sheetCurrent = current.get(item.key);
  }
  // Os campos na ordem da ficha.
  for (const a of items.values()) {
    const order = webKeys(a.category).map((k) => k.field);
    a.fields.sort((x, y) => order.indexOf(x.field) - order.indexOf(y.field));
  }
  return { items: [...items.values()], total, page, pageSize };
}
