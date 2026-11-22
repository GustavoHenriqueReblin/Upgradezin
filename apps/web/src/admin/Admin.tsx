import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Activity, Database, Gauge, History, ListTree, LogOut, Lock, Package, PieChart, Store, Users } from 'lucide-react';
import { AdminError, adminApi } from './api.ts';
import { loginError } from './format.ts';
import { CollectPanel } from './CollectPanel.tsx';
import { AttemptsPanel, CoveragePanel, PerfGapsPanel, TermsPanel } from './DataPanels.tsx';
import { ActivityPanel, BackupsPanel } from './OpsPanels.tsx';
import { ProductsPanel } from './ProductsPanel.tsx';
import { StatusPanel } from './StatusPanel.tsx';
import { StoresPanel } from './StoresPanel.tsx';

type Session = { state: 'loading' } | { state: 'disabled' } | { state: 'login' } | { state: 'in'; user: string };

/** Abas do admin; cada etapa acrescenta as suas. */
const TABS = [
  { id: 'status', label: 'Servidor', icon: Activity },
  { id: 'collect', label: 'Coleta', icon: Gauge },
  { id: 'attempts', label: 'Consultas', icon: History },
  { id: 'coverage', label: 'Cobertura', icon: PieChart },
  { id: 'products', label: 'Produtos', icon: Package },
  { id: 'terms', label: 'Termos', icon: ListTree },
  { id: 'activity', label: 'Atividade', icon: Users },
  { id: 'stores', label: 'Lojas', icon: Store },
  { id: 'backups', label: 'Backups', icon: Database },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** /admin: login fixo do .env e as ferramentas de quem opera o servidor. */
export function Admin() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const [tab, setTab] = useState<TabId>('status');

  const check = useCallback(async () => {
    try {
      const me = await adminApi<{ user: string }>('/me');
      setSession({ state: 'in', user: me.user });
    } catch (err) {
      // 404: admin desligado no servidor (sem ADMIN_USER/ADMIN_PASSWORD).
      setSession(err instanceof AdminError && err.status === 404 ? { state: 'disabled' } : { state: 'login' });
    }
  }, []);

  useEffect(() => {
    document.title = 'Admin · Upgradezin';
    void check();
  }, [check]);

  const toLogin = useCallback(() => setSession({ state: 'login' }), []);

  const logout = async () => {
    await adminApi('/logout', { method: 'POST' }).catch(() => {});
    setSession({ state: 'login' });
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <a href="/" className="shrink-0 whitespace-nowrap text-lg font-bold tracking-tight">
            Upgradezin<span className="text-accent-500">.</span> <span className="font-medium text-zinc-500">admin</span>
          </a>
          {session.state === 'in' && (
            <>
              <nav className="flex flex-wrap gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ${
                      tab === t.id ? 'bg-accent-500 text-accent-950' : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <t.icon className="h-4 w-4" />
                    {t.label}
                  </button>
                ))}
              </nav>
              <button onClick={logout} className="ml-auto flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                <LogOut className="h-4 w-4" />
                Sair ({session.user})
              </button>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {session.state === 'loading' && <p className="text-zinc-500">Carregando…</p>}
        {session.state === 'disabled' && (
          <p className="text-zinc-500">
            Admin desligado neste servidor. Para ligar, defina <code>ADMIN_USER</code> e <code>ADMIN_PASSWORD</code> (10+ caracteres) no <code>.env</code> e reinicie.
          </p>
        )}
        {session.state === 'login' && <LoginForm onDone={(user) => setSession({ state: 'in', user })} />}
        {session.state === 'in' && tab === 'status' && <StatusPanel onUnauthorized={toLogin} />}
        {session.state === 'in' && tab === 'collect' && <CollectPanel onUnauthorized={toLogin} />}
        {session.state === 'in' && tab === 'attempts' && <AttemptsPanel onUnauthorized={toLogin} />}
        {session.state === 'in' && tab === 'coverage' && (
          <div className="space-y-4">
            <CoveragePanel onUnauthorized={toLogin} />
            <PerfGapsPanel onUnauthorized={toLogin} />
          </div>
        )}
        {session.state === 'in' && tab === 'products' && <ProductsPanel onUnauthorized={toLogin} />}
        {session.state === 'in' && tab === 'terms' && <TermsPanel onUnauthorized={toLogin} />}
        {session.state === 'in' && tab === 'activity' && <ActivityPanel onUnauthorized={toLogin} />}
        {session.state === 'in' && tab === 'backups' && <BackupsPanel onUnauthorized={toLogin} />}
        {session.state === 'in' && tab === 'stores' && <StoresPanel onUnauthorized={toLogin} />}
      </main>
    </div>
  );
}

function LoginForm({ onDone }: { onDone: (user: string) => void }) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi<{ user: string }>('/login', { method: 'POST', body: { user, password } });
      onDone(r.user);
    } catch (err) {
      const status = err instanceof AdminError ? err.status : 0;
      setError(loginError(status, err instanceof AdminError ? (err.data.retryAt as string | undefined) : undefined));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  const input = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900';
  return (
    <form onSubmit={submit} className="mx-auto mt-10 max-w-sm space-y-3 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <Lock className="h-5 w-5 text-accent-500" /> Entrar
      </h1>
      <input className={input} placeholder="Usuário" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} required />
      <input className={input} placeholder="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-accent-500 px-4 py-2 font-semibold text-accent-950 hover:bg-accent-400 disabled:opacity-60">
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
