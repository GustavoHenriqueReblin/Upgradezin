type User = { id: string; name: string; email: string; cep: string | null };
type AccountResponse = { enabled: boolean; user: User | null; data?: Record<string, string> };
type Status = { enabled: boolean; user: User | null; error?: string; reauthenticate?: boolean };
const guest: Status = { enabled: false, user: null };
let status = guest;
const subscribers = new Set<() => void>();
const values = new Map<string, string>();
const pending = new Map<string, string | null>();
let sync: Promise<void> | undefined;
let channel: BroadcastChannel | undefined;

/** Primeiro nome para cumprimentar; contas antigas podem ter o nome completo gravado, e o Google pode não mandar nome nenhum. */
export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || undefined;

export const accountStatus = () => status;
export const guestAccountStatus = () => guest;
export const subscribeAccount = (listener: () => void) => {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
};
function show(next: Status) {
  status = next;
  for (const listener of subscribers) listener();
}

const outbox = (user: User) => `upgradezin.account.pending.${user.id}.`;

/** Só alterações feitas depois do login entram nesta fila. Ela é isolada por conta. */
function persistPending(user: User, key: string, value: string | null) {
  try { localStorage.setItem(outbox(user) + key, JSON.stringify(value)); }
  catch { /* A alteração continua na fila em memória e tenta gravar na base. */ }
}

function flush(): Promise<void> | undefined {
  const user = status.user;
  if (!user || !pending.size || sync) return sync;
  sync = (async () => {
    try {
      while (pending.size) {
        const [key, value] = pending.entries().next().value!;
        const res = await fetch('/api/account/data', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-account': '1', 'x-account-id': user.id },
          body: JSON.stringify({ key, value }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 409) {
          show({ enabled: true, user, reauthenticate: true, error: 'A sessão mudou. Entre novamente para salvar as alterações.' });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        if (pending.get(key) === value) {
          pending.delete(key);
          try {
            const storageKey = outbox(user) + key;
            if (localStorage.getItem(storageKey) === JSON.stringify(value)) localStorage.removeItem(storageKey);
          } catch { /* A base já recebeu a alteração. */ }
        }
      }
      if (status.error) show({ enabled: true, user });
    } catch {
      show({ enabled: true, user, error: 'Sincronização pendente. Tente novamente.' });
    } finally {
      sync = undefined;
    }
  })();
  return sync;
}

function write(key: string, value: string | null) {
  const user = status.user;
  if (!user) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return;
  }
  const previous = values.get(key) ?? null;
  if (previous === value) return;
  if (value === null) values.delete(key);
  else values.set(key, value);
  pending.set(key, value);
  persistPending(user, key, value);
  channel?.postMessage({ id: user.id, key, value });
  void flush();
}

export const accountStorage = {
  getItem(key: string): string | null {
    return status.user ? values.get(key) ?? null : localStorage.getItem(key);
  },
  setItem: (key: string, value: string) => write(key, value),
  removeItem: (key: string) => write(key, null),
};

export async function loadAccount(): Promise<void> {
  const res = await fetch('/api/account', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return; // Pode ser um frontend servido antes da atualização da API.
  if (!res.ok) throw new Error('Não foi possível carregar a conta.');
  const { enabled, user, data } = await res.json() as AccountResponse;
  const url = new URL(location.href);
  const loginFailed = url.searchParams.get('conta') === 'erro';
  if (loginFailed) {
    url.searchParams.delete('conta');
    history.replaceState(history.state, '', url);
  }
  values.clear();
  pending.clear();
  for (const [key, value] of Object.entries(data ?? {})) values.set(key, value);
  if (user) {
    const prefix = outbox(user);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (!storageKey?.startsWith(prefix)) continue;
        const raw = localStorage.getItem(storageKey);
        if (raw === null) continue;
        let value: unknown;
        try { value = JSON.parse(raw); } catch { continue; }
        const key = storageKey.slice(prefix.length);
        if (value !== null && typeof value !== 'string') continue;
        pending.set(key, value);
        if (value === null) values.delete(key);
        else values.set(key, value);
      }
    } catch { /* Armazenamento do navegador indisponível. */ }
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('upgradezin.account');
      channel.onmessage = ({ data: entry }) => {
        if (entry?.id !== user.id || typeof entry.key !== 'string' || (entry.value !== null && typeof entry.value !== 'string')) return;
        const oldValue = values.get(entry.key) ?? null;
        if (oldValue === entry.value) return;
        if (entry.value === null) values.delete(entry.key);
        else values.set(entry.key, entry.value);
        window.dispatchEvent(new StorageEvent('storage', { key: entry.key, oldValue, newValue: entry.value }));
      };
    }
    window.addEventListener('online', () => { void flush(); });
  }
  show({ enabled, user, ...(loginFailed && { error: 'Não foi possível entrar com Google.' }) });
  void flush();
}

export const retryAccountSync = () => { void flush(); };

export async function saveAccountCep(cep: string | null): Promise<void> {
  const user = status.user;
  if (!user) throw new Error('Sessão indisponível.');
  const res = await fetch('/api/account/cep', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-account': '1', 'x-account-id': user.id },
    body: JSON.stringify({ cep }), signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('Não foi possível salvar o CEP.');
  const result = await res.json() as { cep: string | null };
  if (status.user?.id === user.id) show({ ...status, user: { ...status.user, cep: result.cep } });
}

export async function logoutAccount(): Promise<void> {
  await flush();
  const res = await fetch('/api/account/logout', {
    method: 'POST', headers: { 'x-account': '1', 'x-account-id': status.user?.id ?? '' }, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('Não foi possível sair.');
  location.assign('/');
}
