import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { LogIn, LogOut, MapPin, UserRound, X } from 'lucide-react';
import { accountStatus, guestAccountStatus, logoutAccount, retryAccountSync, saveAccountCep, subscribeAccount } from '../account.ts';

const button = 'button-link inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-accent-500 dark:border-zinc-700';
const formatCep = (value: string) => value.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

export function AccountControl({ showLabel = false }: { showLabel?: boolean }) {
  const { enabled, user, error, reauthenticate } = useSyncExternalStore(subscribeAccount, accountStatus, guestAccountStatus);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cep, setCep] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();
  const details = useRef<HTMLDialogElement>(null);
  const id = useId();
  if (!enabled) return null;
  const leave = async () => {
    setBusy(true);
    setFailed(false);
    try { await logoutAccount(); }
    catch { setFailed(true); setBusy(false); }
  };
  const storeCep = async (value: string | null) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await saveAccountCep(value);
      setCep(formatCep(value ?? ''));
      setFeedback({ text: value === null ? 'CEP removido.' : 'CEP salvo.', error: false });
    } catch {
      setFeedback({ text: 'Não foi possível salvar o CEP. Tente novamente.', error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative flex items-center gap-2">
      {user ? (
        <>
          <button type="button" onClick={() => {
            setCep(formatCep(user.cep ?? ''));
            setFeedback(undefined);
            setFailed(false);
            details.current?.showModal();
          }} className={button} title="Minha Conta" aria-label="Minha Conta" aria-haspopup="dialog">
            <UserRound aria-hidden="true" className="h-4 w-4" /> {showLabel && <span className="hidden sm:inline">Minha Conta</span>}
          </button>
          <dialog ref={details} aria-labelledby={`${id}-title`}
            className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 backdrop:bg-black/60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={`${id}-title`} className="text-lg font-semibold">Minha Conta</h2>
                <p className="truncate text-sm text-zinc-500" title={user.email}>{user.email}</p>
              </div>
              <button type="button" aria-label="Fechar" onClick={() => details.current?.close()}
                className="rounded-lg px-2 text-zinc-500 hover:text-accent-500"><X className="h-5 w-5" /></button>
            </div>
            <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); void storeCep(cep); }}>
              <label htmlFor={`${id}-cep`} className="flex items-center gap-2 text-sm font-semibold">
                <MapPin aria-hidden="true" className="h-4 w-4 text-accent-500" /> CEP de Entrega
              </label>
              <p id={`${id}-help`} className="text-sm text-zinc-500">Salve o CEP para usar nas consultas de frete.</p>
              <input id={`${id}-cep`} aria-describedby={`${id}-help`} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000"
                value={cep} onChange={(event) => setCep(formatCep(event.target.value))}
                className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || cep.length !== 9} className={`${button} accent-control disabled:opacity-50`}>Salvar CEP</button>
                {user.cep && <button type="button" disabled={busy} onClick={() => void storeCep(null)} className={button}>Remover CEP</button>}
              </div>
              {feedback && <p role="status" className={`text-sm ${feedback.error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{feedback.text}</p>}
            </form>
            <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <button type="button" onClick={() => void leave()} disabled={busy} className={button}>
                <LogOut aria-hidden="true" className="h-4 w-4" /> Sair da Conta
              </button>
              {failed && <p role="status" className="mt-2 text-sm text-red-600 dark:text-red-400">Não foi possível sair.</p>}
            </div>
          </dialog>
        </>
      ) : (
        <a href="/api/account/google" className={button} title="Entrar com Google" aria-label="Entrar com Google">
          <LogIn aria-hidden="true" className="h-4 w-4" /> {showLabel && <span className="hidden sm:inline">Entrar com Google</span>}
        </a>
      )}
      {error && (
        <div role="status" className="absolute right-0 top-full z-30 mt-2 w-52 rounded-lg border border-amber-500/50 bg-white p-2 text-xs text-amber-900 dark:bg-zinc-900 dark:text-amber-200">
          {error}
          {reauthenticate
            ? <a href="/api/account/google" className="ml-1 underline">Entrar Novamente</a>
            : user && error && <button type="button" onClick={retryAccountSync} className="ml-1 underline">Tentar Novamente</button>}
        </div>
      )}
    </div>
  );
}
