import { existsSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { join } from 'node:path';
import type { SystemSnapshot } from '@upgradezin/shared';

/**
 * Monitor da máquina para o admin (tipo um btop): CPU por núcleo, memória, disco, rede, temperatura e
 * os processos que mais usam. Lê só arquivos de texto do /proc e /sys (Linux), na hora em que a tela
 * pede: sem nada rodando em segundo plano. As taxas (CPU, rede) são a diferença para a leitura
 * anterior; sem uma recente, lê duas vezes com meio segundo entre elas. Fora do Linux, só CPU e memória.
 */

type Cpu = { idle: number; total: number };
type Proc = { name: string; ticks: number; rssKb: number };
type Sample = {
  at: number;
  cpus: Cpu[];
  procs: Map<string, Proc> | null;
  net: { rx: number; tx: number } | null;
};

/** Ticks por segundo do kernel (USER_HZ): 100 em praticamente todo Linux. */
const HZ = 100;
const PAGE_KB = 4;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** /proc/stat: linha "cpu" (todos) e "cpuN" (cada núcleo), em ticks. Ocioso = idle + iowait. */
export function parseProcStat(text: string): Cpu[] {
  const out: Cpu[] = [];
  for (const line of text.split('\n')) {
    if (!/^cpu\d*\s/.test(line)) continue;
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    // user nice system idle iowait irq softirq steal (guest já está dentro de user)
    const total = n.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
    out.push({ idle: (n[3] || 0) + (n[4] || 0), total });
  }
  return out;
}

/** /proc/meminfo, em MB. Em uso = total - disponível (como o free e o btop); cache = o que o kernel devolve se precisar. */
export function parseMeminfo(text: string) {
  const kb: Record<string, number> = {};
  for (const m of text.matchAll(/^(\w+(?:\(\w+\))?):\s+(\d+)/gm)) kb[m[1]!] = Number(m[2]);
  const mb = (k: number) => Math.round((k || 0) / 1024);
  const total = kb.MemTotal ?? 0;
  const available = kb.MemAvailable ?? kb.MemFree ?? 0;
  return {
    totalMb: mb(total),
    usedMb: mb(total - available),
    availableMb: mb(available),
    cacheMb: mb((kb.Cached ?? 0) + (kb.Buffers ?? 0) + (kb.SReclaimable ?? 0)),
    swapTotalMb: mb(kb.SwapTotal ?? 0),
    swapUsedMb: mb((kb.SwapTotal ?? 0) - (kb.SwapFree ?? 0)),
  };
}

/** /proc/net/dev: bytes recebidos e enviados somando as interfaces (menos a lo). */
export function parseNetDev(text: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m || m[1] === 'lo') continue;
    const n = m[2]!.trim().split(/\s+/).map(Number);
    rx += n[0] || 0;
    tx += n[8] || 0;
  }
  return { rx, tx };
}

/** /proc/<pid>/stat: nome (entre parênteses, pode ter espaço), ticks de CPU (utime + stime) e memória residente. */
/**
 * /proc/<pid>/statm: memória própria do processo em KB (residente menos a compartilhada com outros), para a
 * soma de um grupo (as dezenas de processos do Chrome) não contar várias vezes o que eles dividem.
 */
export function parseStatm(text: string): number | null {
  const [, resident, shared] = text.trim().split(/\s+/).map(Number);
  return Number.isFinite(resident) && Number.isFinite(shared) ? Math.max(0, resident! - shared!) * PAGE_KB : null;
}

export function parseProcPidStat(text: string): Proc | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const f = text.slice(close + 2).split(' ');
  // f[0] é o campo 3 (estado): utime 14, stime 15, rss 24.
  const ticks = Number(f[11]) + Number(f[12]);
  const rss = Number(f[21]);
  if (!Number.isFinite(ticks) || !Number.isFinite(rss)) return null;
  return { name: text.slice(open + 1, close), ticks, rssKb: rss * PAGE_KB };
}

export class SystemMonitor {
  private prev: Sample | undefined;
  private last: { at: number; snap: SystemSnapshot } | undefined;
  private proc: string;
  private sys: string;

  /** `root`: raiz onde ficam proc/ e sys/ (os testes usam uma pasta com arquivos de mentira). */
  constructor(
    root = '/',
    private wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {
    this.proc = join(root, 'proc');
    this.sys = join(root, 'sys');
  }

  private linux() {
    return existsSync(join(this.proc, 'stat'));
  }

  private read(path: string): string | null {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }

  private sample(now: number): Sample {
    if (!this.linux()) {
      // Sem /proc: os tempos de cada núcleo vêm do Node (em ms; a proporção é o que importa).
      const cores = cpus().map((c) => ({
        idle: c.times.idle,
        total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
      }));
      const all = cores.reduce((a, c) => ({ idle: a.idle + c.idle, total: a.total + c.total }), { idle: 0, total: 0 });
      return { at: now, cpus: [all, ...cores], procs: null, net: null };
    }
    const procs = new Map<string, Proc>();
    let pids: string[] = [];
    try {
      pids = readdirSync(this.proc).filter((n) => /^\d+$/.test(n));
    } catch {
      /* sem lista de processos */
    }
    for (const pid of pids) {
      const text = this.read(join(this.proc, pid, 'stat')); // processo pode ter acabado no meio
      const p = text && parseProcPidStat(text);
      if (!p) continue;
      const own = parseStatm(this.read(join(this.proc, pid, 'statm')) ?? '');
      procs.set(pid, own === null ? p : { ...p, rssKb: own });
    }
    const net = this.read(join(this.proc, 'net', 'dev'));
    return {
      at: now,
      cpus: parseProcStat(this.read(join(this.proc, 'stat')) ?? ''),
      procs,
      net: net ? parseNetDev(net) : null,
    };
  }

  /** Maior temperatura dos sensores térmicos (°C), ou null sem sensor. */
  private temperature(): number | null {
    const dir = join(this.sys, 'class', 'thermal');
    let max: number | null = null;
    try {
      for (const z of readdirSync(dir).filter((n) => n.startsWith('thermal_zone'))) {
        const t = Number(this.read(join(dir, z, 'temp'))?.trim());
        if (Number.isFinite(t) && t > 0) max = Math.max(max ?? 0, t / 1000);
      }
    } catch {
      return null;
    }
    return max === null ? null : round1(max);
  }

  private disk(): SystemSnapshot['disk'] {
    try {
      const s = statfsSync('/');
      const gb = (blocks: number) => round1((blocks * s.bsize) / 1024 ** 3);
      return { totalGb: gb(s.blocks), usedGb: gb(s.blocks - s.bfree) };
    } catch {
      return null;
    }
  }

  /**
   * Leitura agora. Quem pedir de novo em menos de 1 s recebe a mesma (duas abas abertas não dobram o
   * trabalho). Sem leitura anterior recente (até 30 s), lê de novo depois de meio segundo para ter as taxas.
   */
  async snapshot(now = Date.now()): Promise<SystemSnapshot> {
    if (this.last && now - this.last.at < 1000) return this.last.snap;
    let prev = this.prev && now - this.prev.at <= 30_000 ? this.prev : undefined;
    let cur = this.sample(now);
    if (!prev) {
      prev = cur;
      await this.wait(500);
      now += 500;
      cur = this.sample(now);
    }
    this.prev = cur;
    const snap = this.build(prev, cur);
    this.last = { at: now, snap };
    return snap;
  }

  private build(prev: Sample, cur: Sample): SystemSnapshot {
    const dt = Math.max(0.001, (cur.at - prev.at) / 1000);
    const usage = cur.cpus.map((c, i) => {
      const p = prev.cpus[i];
      const total = p ? c.total - p.total : 0;
      return total > 0 ? pct(((total - (c.idle - p!.idle)) / total) * 100) : 0;
    });
    const memText = this.linux() ? this.read(join(this.proc, 'meminfo')) : null;
    const memory = memText
      ? parseMeminfo(memText)
      : (() => {
          const total = Math.round(totalmem() / 1_048_576);
          const free = Math.round(freemem() / 1_048_576);
          return {
            totalMb: total,
            usedMb: total - free,
            availableMb: free,
            cacheMb: 0,
            swapTotalMb: 0,
            swapUsedMb: 0,
          };
        })();

    let processes: SystemSnapshot['processes'] = [];
    if (cur.procs) {
      // Agrupados pelo nome (o Chrome abre dezenas de processos "chrome"); CPU em % de um núcleo, como no top.
      const groups = new Map<string, { count: number; ticks: number; rssKb: number }>();
      for (const [pid, p] of cur.procs) {
        const before = prev.procs?.get(pid);
        const ticks = before && before.name === p.name ? Math.max(0, p.ticks - before.ticks) : 0;
        const g = groups.get(p.name) ?? { count: 0, ticks: 0, rssKb: 0 };
        g.count++;
        g.ticks += ticks;
        g.rssKb += p.rssKb;
        groups.set(p.name, g);
      }
      processes = [...groups]
        .map(([name, g]) => ({
          name,
          count: g.count,
          cpuPct: round1((g.ticks / HZ / dt) * 100),
          memMb: Math.round(g.rssKb / 1024),
        }))
        .filter((p) => p.memMb > 0 || p.cpuPct > 0)
        .sort((a, b) => b.cpuPct - a.cpuPct || b.memMb - a.memMb)
        .slice(0, 12);
    }

    const net =
      cur.net && prev.net
        ? {
            rxKbps: round1(Math.max(0, cur.net.rx - prev.net.rx) / 1024 / dt),
            txKbps: round1(Math.max(0, cur.net.tx - prev.net.tx) / 1024 / dt),
          }
        : null;
    const model = cpus()[0]?.model.trim() ?? '';
    return {
      at: new Date(cur.at).toISOString(),
      uptimeS: Math.round(uptime()),
      cpu: {
        totalPct: usage[0] ?? 0,
        coresPct: usage.slice(1),
        load: loadavg().map(round1) as [number, number, number],
        tempC: this.temperature(),
        model,
      },
      memory,
      disk: this.disk(),
      net,
      processes,
    };
  }
}
