import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitChange, onChange } from './changes.ts';
import { BlockedError, queuedAt, registerBlock, registerSuccess, useIntervalStorage, withStore } from './pace.ts';

/** Pausa por bloqueio. */
describe('pausa da loja', () => {
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
});

describe('fila da loja com prioridade', () => {
  const signal = () => new AbortController().signal;

  it('busca do site passa na frente da rotina que está esperando (a consulta em andamento termina antes)', async () => {
    const order: string[] = [];
    let finishFirst!: () => void;
    const first = withStore('s1', signal(), () => {
      order.push('rotina 1 (em andamento)');
      return new Promise<void>((r) => (finishFirst = r));
    });
    await new Promise((r) => setTimeout(r, 5)); // a 1ª já pegou a loja
    const r2 = withStore('s1', signal(), async () => void order.push('rotina 2'));
    const r3 = withStore('s1', signal(), async () => void order.push('rotina 3'));
    const u1 = withStore('s1', signal(), async () => void order.push('usuário 1'), { priority: true });
    const u2 = withStore('s1', signal(), async () => void order.push('usuário 2'), { priority: true });
    finishFirst();
    await Promise.all([first, r2, r3, u1, u2]);
    expect(order).toEqual(['rotina 1 (em andamento)', 'usuário 1', 'usuário 2', 'rotina 2', 'rotina 3']);
  });

  it('fila visível: em andamento e quantas esperam, prioritárias e da rotina', async () => {
    expect(queuedAt('s1')).toEqual({ running: false, priority: 0, routine: 0 });
    let finishFirst!: () => void;
    const first = withStore('s1', signal(), () => new Promise<void>((r) => (finishFirst = r)));
    await new Promise((r) => setTimeout(r, 5));
    const r1 = withStore('s1', signal(), async () => {});
    const u1 = withStore('s1', signal(), async () => {}, { priority: true });
    const u2 = withStore('s1', signal(), async () => {}, { priority: true });
    expect(queuedAt('s1')).toEqual({ running: true, priority: 2, routine: 1 });
    finishFirst();
    await Promise.all([first, r1, u1, u2]);
    expect(queuedAt('s1')).toEqual({ running: false, priority: 0, routine: 0 });
  });

  it('cancelar quem espera tira da fila sem travar os outros', async () => {
    let finishFirst!: () => void;
    const first = withStore('s1', signal(), () => new Promise<void>((r) => (finishFirst = r)));
    await new Promise((r) => setTimeout(r, 5));
    const ac = new AbortController();
    const cancelled = withStore('s1', ac.signal, async () => 'não devia rodar', { priority: true }).catch(() => 'cancelada');
    const next = withStore('s1', signal(), async () => 'rodou');
    ac.abort(new Error('saiu da página'));
    finishFirst();
    expect(await cancelled).toBe('cancelada');
    expect(await next).toBe('rodou');
    await first;
  });
});

describe('intervalo entre páginas da loja', () => {
  it('listagem espera o intervalo de listagens desde a última listagem; ficha, o de fichas desde a última consulta; outra loja segue o dela', async () => {
    const signal = new AbortController().signal;
    const waits: number[] = [];
    const realTimeout = globalThis.setTimeout;
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if ((ms ?? 0) >= 1000) waits.push(ms!);
      return realTimeout(fn, ms && ms >= 1000 ? 0 : ms);
    }) as typeof setTimeout);
    try {
      useIntervalStorage({ list: { s2: { minS: 30, maxS: 30 } }, sheet: { s2: { minS: 10, maxS: 10 } } }, () => {});
      await withStore('s2', signal, async () => 1);
      await withStore('s2', signal, async () => 1);
      expect(waits.at(-1)).toBeGreaterThan(29_000); // 30 s desde o fim da listagem anterior
      expect(waits.at(-1)).toBeLessThanOrEqual(30_000);
      await withStore('s2', signal, async () => 1, { kind: 'sheet' });
      expect(waits.at(-1)).toBeGreaterThan(9_000); // ficha: 10 s desde a consulta anterior (a listagem)
      expect(waits.at(-1)).toBeLessThanOrEqual(10_000);
      await withStore('s2', signal, async () => 1);
      expect(waits.at(-1)).toBeGreaterThan(29_000); // listagem: 30 s desde a última listagem, não desde a ficha
      const n = waits.length;
      await withStore('s1', signal, async () => 1); // sem intervalo guardado: o curto dos testes
      await withStore('s1', signal, async () => 1);
      expect(waits.length).toBe(n);
    } finally {
      timers.mockRestore();
      useIntervalStorage({}, () => {});
    }
  });
});

describe('avisos para o admin', () => {
  it('a loja avisa quando começa e quando termina de ler (o admin mostra "lendo agora" na hora)', async () => {
    const seen: string[] = [];
    const off = onChange((k) => seen.push(k));
    let during: string[] = [];
    await withStore('s3', new AbortController().signal, async () => {
      during = [...seen];
    });
    off();
    expect(during).toEqual(['store']);
    expect(seen).toEqual(['store', 'store']);
    emitChange('admin'); // sem ninguém ouvindo: nada quebra
  });
});
