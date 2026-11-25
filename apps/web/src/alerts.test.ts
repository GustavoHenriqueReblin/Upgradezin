import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { notificationText, type AlertNotification, type PriceAlert } from '@upgradezin/shared';
import { brl } from './format.ts';

const status = vi.hoisted(() => ({ value: { enabled: true, user: { id: 'u1', name: 'Ana' } as { id: string; name: string } | null } }));
vi.mock('./account.ts', async (original) => ({
  ...(await original<typeof import('./account.ts')>()),
  accountStatus: () => status.value,
  guestAccountStatus: () => status.value,
}));

let values: Map<string, string>;
const shown: { title: string; body?: string }[] = [];
class FakeNotification {
  static permission = 'granted';
  constructor(title: string, options?: { body?: string }) { shown.push({ title, body: options?.body }); }
}

beforeEach(() => {
  vi.resetModules();
  status.value = { enabled: true, user: { id: 'u1', name: 'Ana' } };
  values = new Map();
  shown.length = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('Notification', FakeNotification);
});
afterEach(() => vi.unstubAllGlobals());

const alert: PriceAlert = { key: 'gpu:1', category: 'gpu', title: 'Placa RTX 5060', kind: 'target', target: 1800, price: 2000, armed: true, createdAt: 1 };
const note = (id: number, read = false): AlertNotification => ({ id, key: 'gpu:1', category: 'gpu', title: 'Placa RTX 5060', kind: 'target', price: 1790, reference: 1800, at: 5, read });
const json = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('o site só lê as notificações do servidor', () => {
  it('lê a conta; notifica pelo navegador só as novas desde a última vez neste navegador', async () => {
    const fetch = vi.fn(async () => json({ alerts: [alert], notifications: [note(1)] }));
    vi.stubGlobal('fetch', fetch);
    const { alertsState, loadAlerts, unreadCount } = await import('./alerts.ts');
    await loadAlerts();
    expect(fetch).toHaveBeenCalledWith('/api/account/alerts', expect.objectContaining({ cache: 'no-store' }));
    expect(alertsState()).toMatchObject({ alerts: [alert], loaded: true });
    expect(unreadCount(alertsState().notifications)).toBe(1);
    expect(shown).toEqual([]); // primeira vez neste navegador: só marca onde parou
    expect(values.get('upgradezin.alerts.notified.u1')).toBe('1');

    fetch.mockImplementation(async () => json({ alerts: [alert], notifications: [note(3), note(2, true), note(1)] }));
    await loadAlerts();
    expect(shown).toEqual([{ title: 'Placa RTX 5060', body: notificationText(note(3)) }]);
    await loadAlerts();
    expect(shown).toHaveLength(1); // não repete
  });

  it('sem login fica vazio e não chama o servidor', async () => {
    status.value = { enabled: true, user: null };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { alertsState, loadAlerts } = await import('./alerts.ts');
    await loadAlerts();
    expect(fetch).not.toHaveBeenCalled();
    expect(alertsState().loaded).toBe(false);
  });

  it('gravar manda os cabeçalhos da conta e traduz os erros; marcar como lidas avisa o servidor', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return json({ error: 'limit' }, 409);
      if (init?.method === 'POST') return json(undefined, 204);
      return json({ alerts: [], notifications: [note(1)] });
    });
    vi.stubGlobal('fetch', fetch);
    const { AlertError, alertsState, loadAlerts, markNotificationsRead, saveAlert } = await import('./alerts.ts');
    await expect(saveAlert('gpu:1', 'target', 1800)).rejects.toEqual(new AlertError('limit'));
    expect(fetch).toHaveBeenCalledWith('/api/account/alerts', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ key: 'gpu:1', kind: 'target', target: 1800 }), headers: expect.objectContaining({ 'x-account': '1', 'x-account-id': 'u1' }),
    }));
    await loadAlerts();
    await markNotificationsRead();
    expect(alertsState().notifications[0]!.read).toBe(true);
    expect(fetch).toHaveBeenLastCalledWith('/api/account/notifications/read', expect.objectContaining({ method: 'POST' }));
  });
});

describe('tela', () => {
  it('o sino do produto: some com o login desligado; sem login convida a entrar; com login abre o modal', async () => {
    const { AlertButton, AlertDialog, LoginDialog, suggestedTarget } = await import('./components/PriceAlerts.tsx');
    const product = { productKey: 'gpu:1', category: 'gpu' as const, title: 'Placa RTX 5060', price: 2000 };
    expect(renderToStaticMarkup(createElement(AlertButton, { product, iconOnly: true }))).toContain('aria-label="Acompanhar preço"');
    status.value = { enabled: false, user: null };
    expect(renderToStaticMarkup(createElement(AlertButton, { product, iconOnly: true }))).toBe('');
    expect(renderToStaticMarkup(createElement(LoginDialog, { onClose: () => {} }))).toContain('href="/api/account/google"');

    expect(suggestedTarget(2000)).toBe(1900);
    expect(suggestedTarget(1234)).toBe(1170);
    const html = renderToStaticMarkup(createElement(AlertDialog, { product, onClose: () => {} }));
    expect(html).toContain(`Agora: ${brl(2000)} à vista`);
    expect(html).toContain('value="1.900,00"');
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*\/>[\s\S]*?Quando chegar a um preço/);
    expect(html).toContain('mesmo com o site fechado');
    const out = renderToStaticMarkup(createElement(AlertDialog, { product: { ...product, price: undefined }, onClose: () => {} }));
    expect(out).toContain('Sem estoque agora');
    expect(out).toMatch(/type="radio"[^>]*checked=""[^>]*\/>[\s\S]*?Quando voltar ao estoque/);
    expect(out.match(/disabled=""/g)).toHaveLength(1);
    // Alvo acima do preço de agora: avisa que só vem depois de subir e voltar.
    expect(renderToStaticMarkup(createElement(AlertDialog, { product, alert: { ...alert, target: 2100 }, onClose: () => {} }))).toContain('já está nesse valor');
  });

  it('a lista do sino: notificações (novas em destaque) e os produtos acompanhados', async () => {
    const { AlertList, AlertsShortcut } = await import('./components/PriceAlerts.tsx');
    const html = renderToStaticMarkup(createElement(AlertList, { state: { alerts: [alert], notifications: [note(2), note(1, true)], loaded: true }, onClose: () => {} }));
    expect(html).toContain(notificationText(note(2)));
    expect(html.match(/bg-accent-500\/10/g)).toHaveLength(1);
    expect(html).toContain('Acompanhando (1 de 30)');
    expect(html).toContain(`Avisa quando chegar a ${brl(1800)}.`);
    expect(html).toContain(`Agora: ${brl(2000)} à vista`);
    expect(renderToStaticMarkup(createElement(AlertsShortcut))).toContain('aria-label="Notificações"');
    status.value = { enabled: true, user: null };
    expect(renderToStaticMarkup(createElement(AlertsShortcut))).toBe('');
  });
});
