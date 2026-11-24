import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMeminfo, parseNetDev, parseProcPidStat, parseProcStat, parseStatm, SystemMonitor } from './system.ts';

const MEMINFO = `MemTotal:        8000000 kB
MemFree:          500000 kB
MemAvailable:    5120000 kB
Buffers:          100000 kB
Cached:          2000000 kB
SwapCached:            0 kB
SReclaimable:     148000 kB
SwapTotal:       2048000 kB
SwapFree:        1024000 kB
`;

const NETDEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999999     10    0    0    0     0          0         0   999999      10    0    0    0     0       0          0
  eth0: 1000       5    0    0    0     0          0         0     2000       5    0    0    0     0       0          0
`;

/** Linha do /proc/<pid>/stat com nome, utime, stime e rss (páginas) nos lugares certos. */
const pidStat = (pid: number, name: string, utime: number, stime: number, rssPages: number) =>
  `${pid} (${name}) S 1 1 1 0 -1 4194560 100 0 0 0 ${utime} ${stime} 0 0 20 0 1 0 100 1000000 ${rssPages} 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0`;

describe('monitor da máquina: leitura do /proc', () => {
  it('stat: total e por núcleo; ocioso conta o iowait', () => {
    expect(parseProcStat('cpu  10 0 10 70 10 0 0 0 0 0\ncpu0 5 0 5 35 5 0 0 0 0 0\ncpu1 5 0 5 35 5 0 0 0 0 0\nintr 1 2 3\n')).toEqual([
      { idle: 80, total: 100 },
      { idle: 40, total: 50 },
      { idle: 40, total: 50 },
    ]);
  });

  it('meminfo: em uso = total - disponível; cache com buffers e reclamável', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      totalMb: 7813,
      usedMb: 2813,
      availableMb: 5000,
      cacheMb: 2195,
      swapTotalMb: 2000,
      swapUsedMb: 1000,
    });
  });

  it('net/dev: soma as interfaces menos a lo', () => {
    expect(parseNetDev(NETDEV)).toEqual({ rx: 1000, tx: 2000 });
  });

  it('pid/stat: nome com espaço e parênteses, ticks e memória', () => {
    expect(parseProcPidStat(pidStat(7, 'Web Content (x)', 30, 20, 256))).toEqual({ name: 'Web Content (x)', ticks: 50, rssKb: 1024 });
    expect(parseProcPidStat('lixo')).toBeNull();
    // statm: residente menos compartilhada (páginas de 4 KB).
    expect(parseStatm('5000 768 512 10 0 300 0\n')).toBe(1024);
    expect(parseStatm('')).toBeNull();
  });
});

describe('monitor da máquina: amostras', () => {
  function fakeRoot() {
    const root = mkdtempSync(join(tmpdir(), 'uz-sys-'));
    mkdirSync(join(root, 'proc', 'net'), { recursive: true });
    mkdirSync(join(root, 'sys', 'class', 'thermal', 'thermal_zone0'), {
      recursive: true,
    });
    writeFileSync(join(root, 'proc', 'meminfo'), MEMINFO);
    writeFileSync(join(root, 'sys', 'class', 'thermal', 'thermal_zone0', 'temp'), '54321\n');
    const set = (cpu: string, procs: [number, string, number, number][], rx: number) => {
      writeFileSync(join(root, 'proc', 'stat'), cpu);
      for (const [pid, name, ticks, pages] of procs) {
        mkdirSync(join(root, 'proc', String(pid)), { recursive: true });
        writeFileSync(join(root, 'proc', String(pid), 'stat'), pidStat(pid, name, ticks, 0, pages));
        // Metade da residente é compartilhada: conta só a outra metade.
        writeFileSync(join(root, 'proc', String(pid), 'statm'), `9999 ${pages} ${pages / 2} 1 0 1 0`);
      }
      writeFileSync(join(root, 'proc', 'net', 'dev'), NETDEV.replace('1000 ', `${rx} `));
    };
    return { root, set };
  }

  it('taxas pela diferença entre leituras; processos agrupados pelo nome; repete a mesma em menos de 1 s', async () => {
    const { root, set } = fakeRoot();
    set(
      'cpu  0 0 0 100 0 0 0 0\ncpu0 0 0 0 50 0 0 0 0\ncpu1 0 0 0 50 0 0 0 0\n',
      [
        [1, 'chrome', 0, 256],
        [2, 'chrome', 0, 256],
        [3, 'node', 0, 512],
      ],
      1000,
    );
    let waited = 0;
    const m = new SystemMonitor(root, async (ms) => {
      waited += ms;
      // Meio segundo depois: núcleo 0 a 100%, núcleo 1 parado; chrome usou 25 ticks (50% de um núcleo), rede +512 KB.
      set(
        'cpu  50 0 0 150 0 0 0 0\ncpu0 50 0 0 50 0 0 0 0\ncpu1 0 0 0 100 0 0 0 0\n',
        [
          [1, 'chrome', 20, 256],
          [2, 'chrome', 5, 256],
          [3, 'node', 0, 512],
        ],
        1000 + 512 * 1024,
      );
    });
    const s = await m.snapshot(10_000);
    expect(waited).toBe(500); // sem leitura anterior: leu duas vezes
    expect(s.cpu).toMatchObject({
      totalPct: 50,
      coresPct: [100, 0],
      tempC: 54.3,
    });
    expect(s.memory.usedMb).toBe(2813);
    expect(s.net).toEqual({ rxKbps: 1024, txKbps: 0 });
    expect(s.processes).toEqual([
      { name: 'chrome', count: 2, cpuPct: 50, memMb: 1 },
      { name: 'node', count: 1, cpuPct: 0, memMb: 1 },
    ]);
    expect(await m.snapshot(10_900)).toBe(s); // duas abas: a mesma leitura
    // Leitura seguinte: usa a anterior, sem esperar.
    await m.snapshot(12_500);
    expect(waited).toBe(500);
  });
});
