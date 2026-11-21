import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchLive } from './live.ts';

/** EventSource de mentira: guarda as conexões e deixa o teste mandar eventos. */
class FakeSource {
  static all: FakeSource[] = [];
  handlers = new Map<string, ((e: { data: string }) => void)[]>();
  closed = false;
  constructor(public url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown = {}) {
    for (const fn of this.handlers.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
}

const doc = { visibilityState: 'visible', listeners: [] as (() => void)[], addEventListener: (_: string, fn: () => void) => doc.listeners.push(fn), removeEventListener: (_: string, fn: () => void) => (doc.listeners = doc.listeners.filter((x) => x !== fn)) };

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.all = [];
  doc.visibilityState = 'visible';
  doc.listeners = [];
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('canal ao vivo do admin (telas recarregam sozinhas)', () => {
  it('uma conexão para todas as telas; cada uma recarrega só com os avisos que a interessam, juntando os seguidos', () => {
    const attempts = vi.fn();
    const stores = vi.fn();
    const stopA = watchLive(['attempt'], attempts, { delayMs: 500, fallbackMs: 0 });
    const stopB = watchLive(['store', 'admin'], stores, { delayMs: 300, fallbackMs: 0 });
    expect(FakeSource.all).toHaveLength(1);
    const es = FakeSource.all[0]!;
    expect(es.url).toBe('/api/admin/live');

    // Ao conectar, o servidor manda as últimas consultas de uma vez: um recarregamento só.
    for (let i = 0; i < 5; i++) es.emit('attempt');
    vi.advanceTimersByTime(499);
    expect(attempts).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(stores).not.toHaveBeenCalled();

    es.emit('change', { kind: 'store' });
    es.emit('change', { kind: 'activity' }); // não interessa a nenhuma
    vi.advanceTimersByTime(300);
    expect(stores).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveBeenCalledTimes(1);

    // Fechou a última tela: fecha a conexão; a próxima abre outra.
    stopA();
    expect(es.closed).toBe(false);
    stopB();
    expect(es.closed).toBe(true);
    es.emit('attempt');
    vi.advanceTimersByTime(1000);
    expect(attempts).toHaveBeenCalledTimes(1); // parada: não recarrega mais
    watchLive(['attempt'], vi.fn())();
    expect(FakeSource.all).toHaveLength(2);
  });

  it('aba volta a ficar visível: recarrega; por garantia, a cada fallbackMs só com a aba visível', () => {
    const reload = vi.fn();
    const stop = watchLive(['admin'], reload, { delayMs: 100, fallbackMs: 10_000 });
    vi.advanceTimersByTime(10_000);
    expect(reload).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'hidden';
    vi.advanceTimersByTime(30_000);
    expect(reload).toHaveBeenCalledTimes(1); // escondida: não gasta
    doc.visibilityState = 'visible';
    doc.listeners.forEach((fn) => fn());
    vi.advanceTimersByTime(100);
    expect(reload).toHaveBeenCalledTimes(2);
    stop();
    expect(doc.listeners).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('sem avisos nem garantia: não conecta', () => {
    watchLive([], vi.fn(), { fallbackMs: 0 })();
    expect(FakeSource.all).toHaveLength(0);
  });
});
