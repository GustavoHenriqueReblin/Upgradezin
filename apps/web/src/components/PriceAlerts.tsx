import { trackActivity } from '../activity.ts';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellRing, LogIn, X } from 'lucide-react';
import { ALERT_LIMIT, alertText, notificationText, productPath, type AlertKind, type CategoryId, type PriceAlert } from '@upgradezin/shared';
import { accountStatus, guestAccountStatus, subscribeAccount } from '../account.ts';
import {
  AlertError, alertsState, askNotifications, loadAlerts, markNotificationsRead, noAlertsState, POLL_MS, removeAlert, saveAlert, subscribeAlerts, unreadCount,
  type AlertErrorKind, type AlertsState,
} from '../alerts.ts';
import { formatBudget, parseBudget } from '../budget.ts';
import { brl } from '../format.ts';
import { CountBadge, headerAction } from './HeaderActions.tsx';

export const useAlerts = () => useSyncExternalStore(subscribeAlerts, alertsState, noAlertsState);
const useAccount = () => useSyncExternalStore(subscribeAccount, accountStatus, guestAccountStatus);

const DIALOG = 'm-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 backdrop:bg-black/60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100';
const OPTION = 'flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-200 px-3 py-2.5 transition hover:border-accent-500 has-checked:border-accent-500 has-checked:bg-accent-100 has-disabled:cursor-not-allowed has-disabled:opacity-50 dark:border-zinc-700 dark:has-checked:bg-accent-500/15';
const button = 'button-link inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold';
const EMPTY_BOX = 'rounded-xl border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500 dark:border-zinc-700';
const LIST = 'divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800';

/** Abre o <dialog> assim que monta (o modal só existe enquanto está aberto: nada pesa nos cards da busca). */
function useOpenDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);
  return { ref, onClose, onClick: (event: { target: unknown }) => event.target === ref.current && ref.current?.close() };
}

function CloseButton({ dialog }: { dialog: { current: HTMLDialogElement | null } }) {
  return (
    <button type="button" aria-label="Fechar" onClick={() => dialog.current?.close()} className="rounded-lg px-2 text-zinc-500 hover:text-accent-500">
      <X className="h-5 w-5" />
    </button>
  );
}

interface Product { productKey: string; category: CategoryId; title: string; /** Preço à vista de agora (sem valor = sem estoque). */ price?: number }

/**
 * Sino ao lado de Comparar: acompanhar o preço deste produto. Preenchido quando já acompanha; tocando com notificação
 * não lida. Sem login, o modal convida a entrar (o alerta fica na conta); com o login desligado, não aparece.
 */
export function AlertButton({ product, iconOnly = false }: { product: Product; iconOnly?: boolean }) {
  const { enabled, user } = useAccount();
  const { alerts, notifications } = useAlerts();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  const alert = user ? alerts.find((a) => a.key === product.productKey) : undefined;
  const ringing = notifications.some((n) => !n.read && n.key === product.productKey);
  const Icon = ringing ? BellRing : Bell;
  const label = alert ? 'Preço acompanhado' : 'Acompanhar preço';
  return (
    <>
      <button type="button" onClick={() => {
        trackActivity({ screen: 'alerts', action: 'view', category: product.category, product: product.productKey });
        setOpen(true);
      }} aria-pressed={!!alert} aria-label={label} title={alert ? alertText(alert) : label} aria-haspopup="dialog"
        className="button-link inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-accent-500 aria-pressed:border-accent-500 aria-pressed:bg-accent-500/10 aria-pressed:text-accent-600 dark:border-zinc-700">
        <Icon aria-hidden="true" className="h-4 w-4" fill={alert ? 'currentColor' : 'none'} /> {!iconOnly && label}
      </button>
      {open && (user ? <AlertDialog product={product} alert={alert} onClose={() => setOpen(false)} /> : <LoginDialog onClose={() => setOpen(false)} />)}
    </>
  );
}

export function LoginDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const dialog = useOpenDialog(onClose);
  return (
    <dialog ref={dialog.ref} onClose={onClose} onClick={dialog.onClick} aria-labelledby={`${id}-title`} className={`${DIALOG} max-w-sm`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id={`${id}-title`} className="text-lg font-semibold">Acompanhar preço</h2>
        <CloseButton dialog={dialog.ref} />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Entre com sua conta para acompanhar o preço. O app confere os preços mesmo com o site fechado e deixa o aviso no sino para quando você voltar.
      </p>
      <div className="mt-4 flex justify-end">
        <a href="/api/account/google" className={`${button} accent-control`}><LogIn aria-hidden="true" className="h-4 w-4" /> Entrar com Google</a>
      </div>
    </dialog>
  );
}

const ERROR_TEXT: Record<AlertErrorKind, string> = {
  limit: `Você já acompanha ${ALERT_LIMIT} produtos. Pare de acompanhar algum para incluir este.`,
  'no-stock': 'O produto ficou sem estoque. Escolha avisar quando voltar ao estoque.',
  'not-found': 'Este produto não está mais disponível.',
  session: 'A sessão mudou. Entre novamente para salvar.',
  failed: 'Não deu para salvar agora. Tente de novo em instantes.',
};

/** Sugestão de alvo: 5% abaixo do preço de agora, arredondado para baixo em R$ 10. */
export const suggestedTarget = (price: number) => Math.max(10, Math.floor((price * 0.95) / 10) * 10);

export function AlertDialog({ product, alert, onClose }: { product: Product; alert?: PriceAlert; onClose: () => void }) {
  const id = useId();
  const dialog = useOpenDialog(onClose);
  const inStock = product.price !== undefined;
  const [kind, setKind] = useState<AlertKind>(alert?.kind ?? (inStock ? 'target' : 'stock'));
  const [text, setText] = useState(formatBudget(alert?.target ?? (inStock ? suggestedTarget(product.price!) : 0)));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const target = parseBudget(text);
  const options: { id: AlertKind; label: string; help: string; disabled?: boolean }[] = [
    { id: 'target', label: 'Quando chegar a um preço', help: 'Você define o valor e o app avisa quando o preço à vista chegar nele.' },
    { id: 'drop', label: 'Em qualquer queda', help: inStock ? `Avisa quando ficar abaixo de ${brl(product.price!)}, o preço de agora.` : 'Precisa estar em estoque para ter um preço de partida.', disabled: !inStock },
    { id: 'stock', label: 'Quando voltar ao estoque', help: inStock ? 'O produto já está em estoque.' : 'Avisa quando alguma loja voltar a ter.', disabled: inStock },
  ];
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      dialog.ref.current?.close();
    } catch (err) {
      setError(ERROR_TEXT[err instanceof AlertError ? err.kind : 'failed']);
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (kind === 'target' && !target) return setError('Digite o valor que você quer pagar.');
    askNotifications();
    void run(() => saveAlert(product.productKey, kind, target));
  };
  return (
    <dialog ref={dialog.ref} onClose={onClose} onClick={dialog.onClick} aria-labelledby={`${id}-title`} className={`${DIALOG} max-w-md`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-semibold">Acompanhar preço</h2>
          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400" title={product.title}>{product.title}</p>
          <p className="mt-1 text-sm font-semibold">{inStock ? `Agora: ${brl(product.price!)} à vista` : 'Sem estoque agora'}</p>
        </div>
        <CloseButton dialog={dialog.ref} />
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Quando você quer ser avisado?</legend>
        {options.map((o) => (
          <label key={o.id} className={OPTION}>
            <input type="radio" name={`${id}-kind`} checked={kind === o.id} disabled={o.disabled} onChange={() => { setKind(o.id); setError(undefined); }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent-600" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-400">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {kind === 'target' && (
        <label className="mt-3 block text-sm font-semibold" htmlFor={`${id}-target`}>
          Valor que você quer pagar
          <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 font-normal focus-within:border-accent-500 dark:border-zinc-700 dark:bg-zinc-950">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">R$</span>
            <input id={`${id}-target`} inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value); setError(undefined); }}
              onBlur={() => target && setText(formatBudget(target))} className="w-full min-w-0 bg-transparent py-2 text-lg font-semibold tabular-nums outline-none" />
          </span>
        </label>
      )}
      {kind === 'target' && target && inStock && product.price! <= target && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">O preço de agora já está nesse valor. O aviso vem se ele subir e voltar a chegar nele.</p>
      )}
      {error && <p role="status" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-zinc-500">
        O app confere os preços a cada coleta, mesmo com o site fechado. O aviso fica no sino do cabeçalho e, se você permitir, aparece como notificação do navegador com o site aberto.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {alert && (
          <button type="button" disabled={busy} onClick={() => void run(() => removeAlert(product.productKey))}
            className="mr-auto text-sm text-zinc-500 hover:text-red-600 hover:underline">Parar de acompanhar</button>
        )}
        <button type="button" onClick={save} disabled={busy} className={`${button} accent-control disabled:opacity-50`}>
          <Bell aria-hidden="true" className="h-4 w-4" /> {alert ? 'Salvar' : 'Acompanhar'}
        </button>
      </div>
    </dialog>
  );
}

/** Lê as notificações ao abrir, a cada POLL_MS e ao voltar para a aba (a conferência dos preços é do servidor). */
function useAlertPolling(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    const load = () => void loadAlerts().catch(() => {});
    const onVisible = () => document.visibilityState === 'visible' && load();
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);
}

/** Sino do cabeçalho, ao lado da conta: só o ícone (todo mundo reconhece) e o selo das notificações não lidas. Só com login. */
export function AlertsShortcut() {
  const { user } = useAccount();
  const state = useAlerts();
  const [open, setOpen] = useState(false);
  useAlertPolling(user?.id);
  if (!user) return null;
  const unread = unreadCount(state.notifications);
  const label = unread ? `Notificações (${unread} ${unread === 1 ? 'nova' : 'novas'})` : 'Notificações';
  const Icon = unread ? BellRing : Bell;
  return (
    <>
      <button type="button" onClick={() => {
        trackActivity({ screen: 'alerts', action: 'view' });
        setOpen(true);
      }} className={headerAction} aria-label={label} title={label} aria-haspopup="dialog">
        <Icon aria-hidden="true" className="h-4 w-4" />
        <CountBadge count={unread} />
      </button>
      {open && <AlertList state={state} onClose={() => setOpen(false)} />}
    </>
  );
}

const WHEN = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** As notificações (novas em destaque) e os produtos acompanhados. Ao fechar, as notificações ficam lidas. */
export function AlertList({ state, onClose }: { state: AlertsState; onClose: () => void }) {
  const id = useId();
  const dialog = useOpenDialog(onClose);
  const [fresh] = useState(() => new Set(state.notifications.filter((n) => !n.read).map((n) => n.id)));
  const close = () => {
    void markNotificationsRead();
    onClose();
  };
  const { alerts, notifications } = state;
  return (
    <dialog ref={dialog.ref} onClose={close} onClick={dialog.onClick} aria-labelledby={`${id}-title`} className={`${DIALOG} max-w-xl`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id={`${id}-title`} className="text-lg font-semibold">Notificações</h2>
        <CloseButton dialog={dialog.ref} />
      </div>
      {notifications.length ? (
        <ul className={LIST}>
          {notifications.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 px-3 py-3 text-sm ${fresh.has(n.id) ? 'bg-accent-500/10' : ''}`}>
              <BellRing aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${fresh.has(n.id) ? 'text-accent-500' : 'text-zinc-400'}`} />
              <div className="min-w-0 flex-1">
                <a href={productPath(n.key)} className="line-clamp-2 font-medium hover:underline">{n.title}</a>
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">{notificationText(n)}</p>
                <p className="text-xs text-zinc-500">{WHEN.format(n.at).replace(', ', ' às ')}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={EMPTY_BOX}>Nenhuma notificação ainda.</p>
      )}

      <h3 className="mt-5 mb-2 text-sm font-semibold">Acompanhando{alerts.length ? ` (${alerts.length} de ${ALERT_LIMIT})` : ''}</h3>
      {alerts.length ? (
        <ul className={LIST}>
          {alerts.map((a) => (
            <li key={a.key} className="flex items-start gap-3 px-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <a href={productPath(a.key)} className="line-clamp-2 font-medium hover:underline">{a.title}</a>
                <p className="text-zinc-600 dark:text-zinc-400">{alertText(a)}</p>
                <p className="text-xs text-zinc-500">{a.price !== undefined ? `Agora: ${brl(a.price)} à vista` : 'Sem estoque agora'}</p>
              </div>
              <button type="button" onClick={() => void removeAlert(a.key).catch(() => {})} aria-label={`Parar de acompanhar ${a.title}`} title="Parar de acompanhar"
                data-button-layout="compact" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={EMPTY_BOX}>Toque no sino de um produto, na busca ou na página dele, para acompanhar o preço.</p>
      )}
    </dialog>
  );
}
