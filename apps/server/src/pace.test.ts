import { afterEach, describe, expect, it } from 'vitest';
import { BlockedError, registerBlock, registerSuccess, slowReadyAt, useSlowStorage, withStore } from './pace.ts';

/** Lojas lentas (S2/S3): aceitam a 1ª página e bloqueiam a seguinte que vem segundos depois. */
describe('lojas lentas e pausa', () => {
  afterEach(() => {
    registerSuccess('s2');
    registerSuccess('s1');
  });

  it('consulta na fila atrás de um bloqueio não vai à loja (nem sobe a pausa)', async () => {
    registerBlock('s1', 'unavailable');
    let ran = false;
    const err = await withStore('s1', new AbortController().signal, async () => {
      ran = true;
    }).catch((e: unknown) => e);
    expect(ran).toBe(false);
    expect(err).toBeInstanceOf(BlockedError);
    expect((err as BlockedError).paused).toBe(true);
  });

  it('intervalo mínimo entre consultas a uma loja lenta vale depois de reiniciar (guardado fora da memória)', () => {
    const saved: Record<string, number> = {};
    const last = Date.now() - 60_000;
    useSlowStorage([['s2', last]], (store, at) => (saved[store] = at));
    expect(slowReadyAt('s2')).toBe(last + 180_000); // SLOW_MIN_GAP_S padrão: 3 min
    expect(slowReadyAt('s1')).toBe(0); // S1 (HTTP) não é lenta
  });
});
