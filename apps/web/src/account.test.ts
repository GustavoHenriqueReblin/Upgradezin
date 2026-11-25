import { expect, it, vi } from 'vitest';
import { firstName } from './account.ts';

it('usa só o primeiro nome da conta e nada quando o Google não manda nome', () => {
  expect(firstName('Maria')).toBe('Maria');
  expect(firstName('  Ana Paula  Souza ')).toBe('Ana');
  expect(firstName('')).toBeUndefined();
  expect(firstName('   ')).toBeUndefined();
  expect(firstName(undefined)).toBeUndefined();
});

it('abre a conta pela base e salva apenas mudanças feitas após o login', async () => {
  vi.resetModules();
  const values = new Map([['upgradezin.build.v1', 'local-antigo'], ['upgradezin.pc.v1', 'pc-de-teste']]);
  vi.stubGlobal('localStorage', {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('location', { href: 'https://app.example/' });
  vi.stubGlobal('BroadcastChannel', undefined);
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT'
    ? new Response(null, { status: 204 })
    : Response.json({ enabled: true, user: { id: 'abc', name: 'Teste', email: 'teste@example.com' }, data: { 'upgradezin.build.v1': 'da-base' } }));
  vi.stubGlobal('fetch', fetch);
  try {
    const { accountStorage, loadAccount } = await import('./account.ts');
    await loadAccount();
    expect(accountStorage.getItem('upgradezin.build.v1')).toBe('da-base');
    expect(accountStorage.getItem('upgradezin.pc.v1')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    accountStorage.setItem('upgradezin.build.v1', 'nova');
    expect(accountStorage.getItem('upgradezin.build.v1')).toBe('nova');
    const [, update] = fetch.mock.calls[1]!;
    expect(update?.headers).toMatchObject({ 'x-account-id': 'abc' });
    expect(JSON.parse(String(update?.body))).toEqual({ key: 'upgradezin.build.v1', value: 'nova' });
    expect(values.get('upgradezin.build.v1')).toBe('local-antigo');
    await vi.waitFor(() => expect(values.has('upgradezin.account.pending.abc.upgradezin.build.v1')).toBe(false));
  } finally {
    vi.unstubAllGlobals();
  }
});
