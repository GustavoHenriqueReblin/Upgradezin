import type { ReactNode } from 'react';
import { HardDrive, Monitor } from 'lucide-react';
import { CATEGORY_DEFS, type PcDrive, type PcPart, type PcProfile } from '@upgradezin/shared';
import { EFF_LABEL, MEMORY_LABEL, SOCKET_LABEL } from '../format.ts';
import { PC_SLOTS } from '../pc.ts';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';

/**
 * As peças do PC importado, uma por linha com os detalhes lidos do CPU-Z: processador, placa-mãe,
 * memória, placa de vídeo, fonte (informada pela pessoa), discos e monitores. Usado na prévia da
 * importação e no upgrade pelo orçamento.
 */
export function PcSpecs({ pc, psu, showPsu = false }: { pc: PcProfile; /** Fonte de fora do relatório (a "Já Tenho" da montagem). */ psu?: PcPart; showPsu?: boolean }) {
  const PsuIcon = CATEGORY_ICONS.psu;
  const power = pc.psu ?? psu;
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {PC_SLOTS.map((slot) => {
        const Icon = CATEGORY_ICONS[slot];
        const part = pc[slot];
        return (
          <Row key={slot} icon={<Icon className="h-4 w-4" strokeWidth={1.75} />} label={CATEGORY_DEFS[slot].name}>
            {part ? (
              <>
                <div className="font-medium">{part.title}</div>
                <Detail text={detailOf(pc, slot)} />
              </>
            ) : slot === 'gpu' && pc.cpu?.specs.igpu ? (
              <div className="text-zinc-500">Vídeo integrado do processador.</div>
            ) : (
              <div className="text-zinc-500">Não encontrada no relatório.</div>
            )}
          </Row>
        );
      })}
      {showPsu && (
        <Row icon={<PsuIcon className="h-4 w-4" strokeWidth={1.75} />} label={CATEGORY_DEFS.psu.name}>
          {power ? (
            <>
              <div className="font-medium">{power.title}</div>
              <Detail
                text={[power.specs.watts && `${power.specs.watts} W`, power.specs.efficiency && `80 Plus ${EFF_LABEL[power.specs.efficiency]}`, power.specs.activePfc !== undefined && (power.specs.activePfc ? 'PFC ativo' : 'sem PFC ativo')]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </>
          ) : (
            <div className="text-zinc-500">Não informada (o CPU-Z não lê a fonte).</div>
          )}
        </Row>
      )}
      {pc.drives.length > 0 && (
        <Row icon={<HardDrive className="h-4 w-4" strokeWidth={1.75} />} label="Armazenamento">
          {pc.drives.map((d, i) => (
            <div key={i}>{driveText(d)}</div>
          ))}
        </Row>
      )}
      {pc.monitors.length > 0 && (
        <Row icon={<Monitor className="h-4 w-4" strokeWidth={1.75} />} label="Monitor">
          {pc.monitors.map((m, i) => (
            <div key={i}>{[m.name, m.width && `${m.width} × ${m.height}`, m.inches && `${m.inches}"`, m.maxHz && `até ${m.maxHz} Hz`].filter(Boolean).join(' · ')}</div>
          ))}
        </Row>
      )}
    </ul>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 px-3 py-2.5 text-sm">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-600/10 text-accent-600 dark:text-accent-400">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
        {children}
      </div>
    </li>
  );
}

const Detail = ({ text }: { text: string }) => (text ? <div className="text-xs text-zinc-500">{text}</div> : null);

/** Os detalhes de cada peça, numa linha ("6 núcleos · 12 threads · AM4"). */
export function detailOf(pc: PcProfile, slot: (typeof PC_SLOTS)[number]): string {
  const s = pc[slot]!.specs;
  let parts: (string | number | false | undefined)[] = [];
  if (slot === 'cpu') parts = [s.cores && `${s.cores} núcleos`, s.threads && `${s.threads} threads`, s.socket && SOCKET_LABEL[s.socket], s.tdp && `TDP ${s.tdp} W`, s.igpu === true && 'vídeo integrado'];
  if (slot === 'motherboard')
    parts = [s.socket && SOCKET_LABEL[s.socket], s.chipset && `Chipset ${s.chipset}`, s.memory && MEMORY_LABEL[s.memory], s.memorySlots && `${s.memorySlots} slots de memória`];
  if (slot === 'ram') {
    const r = pc.ram!;
    const sizes = r.modules.map((m) => m.sizeGb);
    const same = sizes.length > 0 && sizes.every((x) => x === sizes[0]);
    parts = [
      s.ramCapacity && `${s.ramCapacity} GB`,
      sizes.length > 0 && (same ? `${sizes.length}x ${sizes[0]} GB` : sizes.map((x) => `${x} GB`).join(' + ')),
      s.memory && MEMORY_LABEL[s.memory],
      r.ratedSpeed && `${r.ratedSpeed} MHz de fábrica${r.profile ? ` (${r.profile.toUpperCase()})` : ''}`,
      r.runningSpeed && `rodando a ${r.runningSpeed} MHz`,
    ];
  }
  if (slot === 'gpu') parts = [s.vram && `${s.vram} GB`, s.vramType, pc.gpu!.pcieWidth && `PCIe x${pc.gpu!.pcieWidth}`];
  return parts.filter(Boolean).join(' · ');
}

/**
 * O PC numa linha, para o cartão recolhido: processador, placa de vídeo (com a memória de vídeo), memória
 * e fonte ("AMD Ryzen 7 5800X3D · RX 6600 8 GB · 32 GB DDR4 · Fonte 650 W").
 */
export function pcSummary(pc: PcProfile, psu?: PcPart): string {
  const gpu = pc.gpu ? [pc.gpu.specs.gpuModel ?? pc.gpu.title, pc.gpu.specs.vram && `${pc.gpu.specs.vram} GB`].filter(Boolean).join(' ') : pc.cpu?.specs.igpu ? 'Vídeo integrado' : undefined;
  const r = pc.ram?.specs;
  const ram = r?.ramCapacity ? [`${r.ramCapacity} GB`, r.memory && MEMORY_LABEL[r.memory]].filter(Boolean).join(' ') : undefined;
  const watts = (pc.psu ?? psu)?.specs.watts;
  return [pc.cpu?.title, gpu, ram, watts && `Fonte ${watts} W`].filter(Boolean).join(' · ');
}

const KIND: Record<PcDrive['kind'], string> = { nvme: 'SSD NVMe', ssd: 'SSD', hdd: 'HD', unknown: 'Disco' };

export function driveText(d: PcDrive): string {
  const size = d.capacityGb >= 1000 ? `${(d.capacityGb / 1024).toFixed(1).replace('.', ',')} TB` : `${d.capacityGb} GB`;
  const extra = [d.system && 'sistema', d.freePercent !== undefined && `${Math.round(d.freePercent)}% livre`].filter(Boolean).join(', ');
  return `${KIND[d.kind]} ${size} · ${d.name}${extra ? ` (${extra})` : ''}`;
}
