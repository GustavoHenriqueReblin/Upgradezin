import { notificationText, type AlertKind, type AlertNotification, type PriceAlert } from '@upgradezin/shared';
import { accountStatus } from './account.ts';

/**
 * Alertas de preço: ficam na conta, no servidor. A rotina de lá confere os preços depois das coletas e grava as
 * notificações; o site só lê (ao abrir, a cada POLL_MS e ao voltar para a aba) e mostra no sino do cabeçalho. Com
 * permissão, a notificação nova também aparece como notificação do navegador.
 */

export const POLL_MS = 5 * 60_000;

export interface AlertsState { alerts: PriceAlert[]; notifications: AlertNotification[]; loaded: boolean }
const EMPTY: AlertsState = { alerts: [], notifications: [], loaded: false };
let state = EMPTY;
const listeners = new Set<() => void>();

export const alertsState = () => state;
export const noAlertsState = () => EMPTY;
export function subscribeAlerts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function set(next: AlertsState) {
  state = next;
  for (const listener of listeners) listener();
}

export const unreadCount = (list: readonly AlertNotification[]) => list.filter((n) => !n.read).length;

const writeHeaders = (userId: string) => ({ 'content-type': 'application/json', 'x-account': '1', 'x-account-id': userId });

/** Lê os alertas e as notificações da conta (sem login, fica vazio). */
export async function loadAlerts(): Promise<void> {
  const user = accountStatus().user;
  if (!user) {
    if (state !== EMPTY) set(EMPTY);
    return;
  }
  const res = await fetch('/api/account/alerts', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json() as Pick<AlertsState, 'alerts' | 'notifications'>;
  if (accountStatus().user?.id !== user.id) return; // trocou de conta enquanto carregava
  set({ alerts: data.alerts, notifications: data.notifications, loaded: true });
  notifyNew(user.id, data.notifications);
}

export type AlertErrorKind = 'limit' | 'no-stock' | 'not-found' | 'session' | 'failed';
export class AlertError extends Error {
  constructor(readonly kind: AlertErrorKind) { super(kind); }
}

async function send(method: 'PUT' | 'DELETE' | 'POST', url: string, body?: unknown): Promise<void> {
  const user = accountStatus().user;
  if (!user) throw new AlertError('session');
  let res: Response;
  try {
    res = await fetch(url, { method, headers: writeHeaders(user.id), ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new AlertError('failed');
  }
  if (res.ok) return;
  if (res.status === 401 || res.status === 403 || res.status === 409) {
    const error = res.status === 409 ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
    throw new AlertError(error === 'limit' ? 'limit' : 'session');
  }
  if (res.status === 404) throw new AlertError('not-found');
  if (res.status === 400 && ((await res.json().catch(() => ({}))) as { error?: string }).error === 'no-stock') throw new AlertError('no-stock');
  throw new AlertError('failed');
}

/** Cria ou troca o alerta do produto; o servidor pega título, categoria e preço do banco. */
export async function saveAlert(key: string, kind: AlertKind, target?: number): Promise<void> {
  await send('PUT', '/api/account/alerts', { key, kind, ...(kind === 'target' && { target }) });
  await loadAlerts().catch(() => {});
}

export async function removeAlert(key: string): Promise<void> {
  set({ ...state, alerts: state.alerts.filter((a) => a.key !== key) });
  await send('DELETE', `/api/account/alerts/${encodeURIComponent(key)}`).finally(() => loadAlerts().catch(() => {}));
}

/** A pessoa viu as notificações (abriu o sino). */
export async function markNotificationsRead(): Promise<void> {
  if (!unreadCount(state.notifications)) return;
  set({ ...state, notifications: state.notifications.map((n) => (n.read ? n : { ...n, read: true })) });
  await send('POST', '/api/account/notifications/read').catch(() => {});
}

/** Pede permissão para notificar (só a partir de um clique da pessoa). */
export function askNotifications(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {});
}

const notifiedKey = (userId: string) => `upgradezin.alerts.notified.${userId}`;

/**
 * Notificação do navegador para as notificações novas desde a última vista neste navegador. Na primeira vez, só marca
 * onde parou (o que já estava lá aparece no sino, sem estourar várias notificações de uma vez).
 */
function notifyNew(userId: string, notifications: readonly AlertNotification[]) {
  const newest = Math.max(0, ...notifications.map((n) => n.id));
  let last: number | undefined;
  try {
    const raw = localStorage.getItem(notifiedKey(userId));
    last = raw === null ? undefined : Number(raw) || 0;
    if (newest > (last ?? -1)) localStorage.setItem(notifiedKey(userId), String(newest));
  } catch {
    return; // sem armazenamento, não dá para saber o que já foi notificado: fica só o sino
  }
  if (last === undefined || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const n of notifications) {
    if (n.read || n.id <= last) continue;
    try {
      // A tag evita a mesma notificação duas vezes quando o site está aberto em mais de uma aba.
      new Notification(n.title, { body: notificationText(n), tag: `upgradezin-notificacao-${n.id}` });
    } catch { /* Navegador sem notificação fora de um service worker: fica o sino. */ }
  }
}
