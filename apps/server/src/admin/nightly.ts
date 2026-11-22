/**
 * Varredura completa automática de madrugada (todas as lojas, todas as categorias, esgotados também),
 * todo dia na hora NIGHTLY_SWEEP_HOUR (horário do servidor), antes do backup do cron (04:30). Pausa
 * as rotinas como o botão do admin e volta ao estado anterior quando a última loja termina.
 */

/** Próxima vez na hora `hour` (0-23, minuto 0), depois de `from`. */
export function nextNightlyAt(hour: number, from: Date): Date {
  const at = new Date(from);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

let timer: NodeJS.Timeout | undefined;
let state: { hour: number | null; nextAt: number | null } = { hour: null, nextAt: null };

/**
 * Agenda a varredura da madrugada. `hour` fora de 0-23 (ex.: -1) desliga. `run` dispara a varredura
 * (responde na hora; as lojas seguem em segundo plano) e `onRun` guarda quando foi.
 */
export function startNightlySweep(hour: number, run: () => void, onRun?: (at: Date) => void): void {
  stopNightlySweep();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
  const schedule = () => {
    const at = nextNightlyAt(hour, new Date());
    state = { hour, nextAt: at.getTime() };
    timer = setTimeout(() => {
      try {
        onRun?.(new Date());
        run();
      } finally {
        schedule();
      }
    }, at.getTime() - Date.now());
    timer.unref?.();
  };
  schedule();
}

export function stopNightlySweep(): void {
  clearTimeout(timer);
  timer = undefined;
  state = { hour: null, nextAt: null };
}

/** Para o admin: a hora (null = desligada) e a próxima vez. */
export const nightlySchedule = () => ({ hour: state.hour, nextAt: state.nextAt ? new Date(state.nextAt).toISOString() : null });
