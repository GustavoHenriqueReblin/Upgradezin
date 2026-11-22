import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextNightlyAt, nightlySchedule, startNightlySweep, stopNightlySweep } from './nightly.ts';

afterEach(() => {
  stopNightlySweep();
  vi.useRealTimers();
});

describe('varredura da madrugada', () => {
  it('próxima vez: hoje se a hora ainda não passou; senão, amanhã (horário do servidor)', () => {
    expect(nextNightlyAt(1, new Date(2026, 10, 22, 0, 30))).toEqual(new Date(2026, 10, 22, 1, 0));
    expect(nextNightlyAt(1, new Date(2026, 10, 22, 1, 0))).toEqual(new Date(2026, 10, 23, 1, 0));
    expect(nextNightlyAt(1, new Date(2026, 10, 22, 19, 45))).toEqual(new Date(2026, 10, 23, 1, 0));
    expect(nextNightlyAt(0, new Date(2026, 11, 31, 23, 0))).toEqual(new Date(2027, 0, 1, 0, 0));
  });

  it('dispara na hora, guarda quando foi e agenda o dia seguinte; -1 desliga', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 22, 23, 0));
    const runs: Date[] = [];
    let started = 0;
    startNightlySweep(1, () => started++, (at) => runs.push(at));
    expect(nightlySchedule()).toEqual({ hour: 1, nextAt: new Date(2026, 10, 23, 1, 0).toISOString() });
    vi.advanceTimersByTime(119 * 60_000);
    expect(started).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(started).toBe(1);
    expect(runs[0]).toEqual(new Date(2026, 10, 23, 1, 0));
    expect(nightlySchedule().nextAt).toBe(new Date(2026, 10, 24, 1, 0).toISOString());
    startNightlySweep(-1, () => started++);
    expect(nightlySchedule()).toEqual({ hour: null, nextAt: null });
    vi.advanceTimersByTime(2 * 86_400_000);
    expect(started).toBe(1);
  });
});
