import { MAX_BUILD_DRIVES, parseCpuzReport, PC_LIMITS, type BuildSlot, type PcPart, type PcProfile } from '@upgradezin/shared';
import { buildDrives, itemFromPc, withDrives, type SavedBuild } from './build.ts';

/**
 * "Meu PC": o relatório do CPU-Z lido no navegador (o arquivo nunca vai para o servidor).
 * O perfil fica guardado aqui para as sugestões de upgrade; as peças vão para a montagem como "Atual".
 */

/** Relatórios reais têm de 100 KB a 1 MB; acima disso não é um relatório do CPU-Z. */
const MAX_BYTES = 5 * 1024 * 1024;

export type ReadResult = { ok: true; pc: PcProfile } | { ok: false; reason: 'too-big' | 'not-cpuz' | 'empty' };

/** Texto do arquivo: o CPU-Z grava em UTF-8/ANSI; versões antigas e outros editores podem salvar em UTF-16. */
function decode(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  // UTF-16 sem marca: metade dos bytes zerados no começo.
  const head = b.subarray(0, 400);
  if (head.length && head.filter((x) => x === 0).length > head.length / 3) return new TextDecoder('utf-16le').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

export async function readReportFile(file: File): Promise<ReadResult> {
  if (file.size > MAX_BYTES) return { ok: false, reason: 'too-big' };
  const pc = parseCpuzReport(decode(await file.arrayBuffer()));
  if (!pc) return { ok: false, reason: 'not-cpuz' };
  if (!pc.cpu && !pc.motherboard && !pc.ram && !pc.gpu) return { ok: false, reason: 'empty' };
  return { ok: true, pc };
}

/** Peças do relatório que entram na montagem (fonte e cooler não aparecem no CPU-Z). */
export const PC_SLOTS = ['motherboard', 'cpu', 'ram', 'gpu'] as const satisfies readonly BuildSlot[];

function importDrives(build: SavedBuild, pc: PcProfile): SavedBuild {
  const selected = buildDrives(build).filter((item) => !item.key.startsWith('pc:ssd:'));
  const imported = pc.drives.map((drive, index) => ({
    ...itemFromPc('ssd', {
      title: drive.name,
      specs: { ssdCapacity: drive.capacityGb, ssdInterface: drive.interface ?? (drive.kind === 'nvme' ? 'nvme' : undefined) },
    }),
    key: `pc:ssd:${index}`,
  }));
  return withDrives(build, [...imported, ...selected].slice(0, MAX_BUILD_DRIVES));
}

/**
 * Coloca as peças atuais na montagem. As peças lidas substituem as que estiverem lá;
 * sem placa de vídeo dedicada no relatório, sai a placa "Atual" de uma importação anterior.
 */
export function applyPc(build: SavedBuild, pc: PcProfile): SavedBuild {
  const next: SavedBuild = { ...build };
  for (const slot of PC_SLOTS) {
    const part = pc[slot];
    if (part) next[slot] = itemFromPc(slot, part);
    else if (next[slot]?.current) delete next[slot];
  }
  // Fonte informada na importação: entra como "Atual" (sem ela, a da montagem fica).
  if (pc.psu) next.psu = itemFromPc('psu', pc.psu);
  return importDrives(next, pc);
}

/** Peças do PC só onde a montagem está vazia (abrir uma sugestão não apaga o que a pessoa escolheu). */
export function fillPc(build: SavedBuild, pc: PcProfile): SavedBuild {
  const next: SavedBuild = { ...build };
  for (const slot of PC_SLOTS) if (!next[slot] && pc[slot]) next[slot] = itemFromPc(slot, pc[slot]!);
  if (!next.psu && pc.psu) next.psu = itemFromPc('psu', pc.psu);
  return importDrives(next, pc);
}

const KEY = 'upgradezin.pc.v1';

const isPart = (p: unknown): boolean => {
  const x = p as PcPart | undefined;
  return x === undefined || (typeof x === 'object' && x !== null && typeof x.title === 'string' && x.title.length <= 200 && typeof x.specs === 'object' && x.specs !== null);
};

/** Perfil guardado: só volta com o formato esperado (dado corrompido ou editado à mão fica de fora). */
export function validPc(v: unknown): PcProfile | null {
  const pc = v as PcProfile | null;
  if (!pc || typeof pc !== 'object' || pc.source !== 'cpu-z') return null;
  if (!Array.isArray(pc.drives) || !Array.isArray(pc.monitors) || pc.drives.length > PC_LIMITS.drives || pc.monitors.length > PC_LIMITS.monitors) return null;
  if (![pc.cpu, pc.motherboard, pc.ram, pc.gpu, pc.psu].every(isPart)) return null;
  if (pc.ram && (!Array.isArray(pc.ram.modules) || pc.ram.modules.length > PC_LIMITS.modules)) return null;
  if (!pc.drives.every((d) => d && typeof d.name === 'string' && typeof d.capacityGb === 'number')) return null;
  return pc;
}

export function loadPc(): PcProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? validPc(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearPc(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada guardado
  }
}

export function savePc(pc: PcProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pc));
  } catch {
    // sem armazenamento: o PC vale só enquanto a página estiver aberta
  }
}
