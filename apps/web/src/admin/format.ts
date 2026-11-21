import { CATEGORY_DEFS, type MergeReport, type RoutineMode, type SheetStatus, type SpecSheet, type Specs, type StoreAttempt } from '@upgradezin/shared';

/** "3 d 4 h", "2 h 15 min", "40 s". */
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** Hora local curta ("21:05"), ou data e hora quando não é hoje ("19/11 21:05"). */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

/** Mensagem do login recusado. */
export function loginError(status: number, retryAt?: string): string {
  if (status === 429) return `Muitas tentativas. Tente de novo ${retryAt ? `às ${formatWhen(retryAt)}` : 'mais tarde'}.`;
  if (status === 401) return 'Usuário ou senha incorretos.';
  return 'Não foi possível entrar agora.';
}

/** Fundo da bolinha a partir das cores digitadas ("#a,#b"): degradê com 2–3, lisa com 1, null se inválido. */
export function previewBackground(text: string): string | null {
  const list = text.split(',').map((v) => v.trim().replace(/^#/, '')).filter(Boolean).slice(0, 3);
  if (!list.length || !list.every((h) => /^(?:[0-9a-f]{3}){1,2}$/i.test(h))) return null;
  const colors = list.map((h) => `#${h.toLowerCase()}`);
  return colors.length > 1 ? `linear-gradient(135deg, ${colors.join(', ')})` : colors[0]!;
}

const STATUS_TEXT: Record<StoreAttempt['status'], string> = { ok: 'ok', partial: 'parcial', blocked: 'bloqueio', limit: 'limite da hora', error: 'erro' };
const ORIGIN_TEXT: Record<StoreAttempt['origin'], string> = { search: 'busca', routine: 'rotina', admin: 'admin' };

/** O que foi consultado: 'Fonte "750W"', 'varredura de Cooler, pág. 13', 'ficha 12345'. */
export function attemptWhat(a: StoreAttempt): string {
  const cat = a.category ? CATEGORY_DEFS[a.category].name : '';
  if (a.kind === 'sweep') return `varredura de ${cat}, pág. ${a.page ?? '?'}`;
  if (a.kind === 'sheet') return `ficha ${a.term ?? ''}`.trim();
  return `${cat} "${a.term ?? ''}"`.trim();
}

/** Resultado curto: "36 ofertas", "bloqueio", "parcial (12 ofertas)". */
export function attemptResult(a: StoreAttempt): string {
  if (a.status === 'ok') return a.kind === 'sheet' ? (a.count ? 'ficha lida' : 'sem ficha') : `${a.count} ofertas`;
  return a.count ? `${STATUS_TEXT[a.status]} (${a.count} ofertas)` : STATUS_TEXT[a.status];
}

export const attemptLabel = (a: StoreAttempt) => `${attemptWhat(a)}: ${attemptResult(a)} (${ORIGIN_TEXT[a.origin]})`;
export const statusText = (s: StoreAttempt['status']) => STATUS_TEXT[s];
export const originText = (o: StoreAttempt['origin']) => ORIGIN_TEXT[o];

/** "pausada até 21:30" (manual) ou "bloqueada até 21:30, 2º degrau" (bloqueio). */
export function pauseLabel(p: { until: string; step: number; reason: string }): string {
  if (p.reason === 'paused') return `pausada até ${formatWhen(p.until)}`;
  return `bloqueada até ${formatWhen(p.until)}${p.step > 0 ? `, ${p.step + 1}º degrau` : ''}`;
}

/** Linhas do relatório de merge ("297 anúncios novos"…); nada a trazer vira uma linha só. */
export function mergeLines(r: MergeReport): string[] {
  const lines = [
    [r.newListings, 'anúncio(s) novo(s)'],
    [r.newerListings, 'anúncio(s) com oferta mais recente'],
    [r.newPricePoints, 'ponto(s) de histórico de preço'],
    [r.newTerms, 'termo(s) novo(s)'],
    [r.newerRuns, 'coleta(s) por termo mais recente(s)'],
    [r.newerSheets, 'ficha(s) técnica(s)'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, t]) => `${n} ${t}`);
  return lines.length ? lines : ['nada: este servidor já tem tudo o que o banco enviado tem'];
}

/** Lojas em que a rotina roda de fato: as marcadas, se ela estiver ligada; senão, nenhuma. */
export const routineStores = <T extends string>(r: { enabled: boolean; stores: T[] }): T[] => (r.enabled ? r.stores : []);

/** Lojas em que o termo nunca teve coleta boa (entre as lojas passadas). */
export const neverCollectedIn = (t: { runs: { store: string; lastOkAt: string | null }[] }, stores: string[]): string[] =>
  stores.filter((s) => !t.runs.some((r) => r.store === s && r.lastOkAt));

/** Filtro de coleta da aba Termos: nunca coletado em nenhuma loja, ou em alguma delas. */
export type NeverFilter = '' | 'none' | 'some';
export function matchesNever(t: { runs: { store: string; lastOkAt: string | null }[] }, stores: string[], f: NeverFilter): boolean {
  if (!f) return true;
  const missing = neverCollectedIn(t, stores).length;
  return f === 'none' ? missing === stores.length : missing > 0;
}

/** Contagem até `target`: "00:08:22 (22:32)"; passou da hora, "00:00:00". Hora entre parênteses no fuso local. */
export function countdown(target: string | number, now = Date.now()): string {
  const at = typeof target === 'number' ? target : Date.parse(target);
  const s = Math.max(0, Math.ceil((at - now) / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const clock = new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)} (${clock})`;
}

export const MODE_LABEL: Record<RoutineMode, string> = { normal: 'Normal', reduced: 'Reduzido', slow: 'Lento' };

/** Segundos em texto curto: "15 s", "1 min", "1 min 30 s", "2 h", "1 h 30 min". */
export function shortDuration(s: number): string {
  if (s < 60) return `${s} s`;
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** Fila da loja em texto: "2 buscas do site e 1 da rotina esperando", "vazia". */
export function queueLabel(q: { priority: number; routine: number }): string {
  const parts = [
    q.priority ? `${q.priority} ${q.priority === 1 ? 'busca' : 'buscas'} do site` : '',
    q.routine ? `${q.routine} da rotina` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' e ')} esperando` : 'vazia';
}

/** O que o modo faz, com os segundos que o servidor usa. */
export function modeHint(mode: RoutineMode, seconds: Record<RoutineMode, number>): string {
  return `rotina: 1 termo a cada ${shortDuration(seconds[mode])}`;
}

/** Unidades do intervalo da rotina de fichas no admin. */
export const SHEET_UNITS = [
  { label: 'segundos', s: 1 },
  { label: 'minutos', s: 60 },
  { label: 'horas', s: 3600 },
] as const;

/** Segundos na maior unidade exata: 180 → 3 minutos; 90 → 90 segundos. */
export function splitSeconds(s: number): { value: number; unit: number } {
  const u = [...SHEET_UNITS].reverse().find((x) => s % x.s === 0)!;
  return { value: s / u.s, unit: u.s };
}

/** Quanto falta para ler `missing` fichas, uma a cada `seconds` (+ 10% em média): "cerca de 5 h", "cerca de 3 dias". */
export function sheetEta(missing: number, seconds: number): string {
  const h = (missing * seconds * 1.1) / 3600;
  if (h < 1) return 'menos de 1 h';
  return h < 48 ? `cerca de ${Math.ceil(h)} h` : `cerca de ${Math.round(h / 24)} dias`;
}

export const SHEET_STATUS_LABEL: Record<SheetStatus, string> = { ok: 'lida', empty: 'página sem ficha', missing: 'não lida', na: 'sem ficha física' };

/** O que a ficha trouxe, em texto curto: "placa 228 mm · sem 12V-2x6 · part number DUAL-RTX5060". */
export function sheetSummary(sheet: SpecSheet | undefined): string {
  if (!sheet) return '';
  const s = sheet.specs;
  const parts = [
    s.gpuLength && `placa ${s.gpuLength} mm`,
    s.gpu16Pin !== undefined && (s.gpu16Pin ? 'com 12V-2x6' : 'sem 12V-2x6'),
    s.coolerHeight && `altura ${s.coolerHeight} mm`,
    s.caseMaxGpu && `placa até ${s.caseMaxGpu} mm`,
    s.caseMaxCooler && `cooler até ${s.caseMaxCooler} mm`,
    s.caseRadiators?.length && `radiadores ${s.caseRadiators.join('/')} mm`,
    sheet.mpn && `part number ${sheet.mpn}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'sem medidas';
}

/** Specs lidas do título, como "campo: valor" (listas separadas por vírgula; vazias de fora). */
export function specPairs(specs: Specs): [string, string][] {
  return Object.entries(specs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v)]);
}
