import { describe, expect, it } from 'vitest';
import { parseCpuzReport } from '@upgradezin/shared';
import amd from '../../../packages/shared/fixtures/cpuz/amd-am4-rx6600.txt?raw';
import { detailOf, driveText, pcSummary } from './components/PcSpecs.tsx';

const pc = parseCpuzReport(amd)!;

describe('dados do PC importado', () => {
  it('cada peça com os detalhes lidos do CPU-Z', () => {
    expect(detailOf(pc, 'cpu')).toMatch(/^8 núcleos · 16 threads · AMD AM4 · TDP \d+ W$/);
    expect(detailOf(pc, 'motherboard')).toContain('Chipset');
    // Memória: total, pentes, tipo, frequência de fábrica e a de agora.
    expect(detailOf(pc, 'ram')).toMatch(/GB · \dx \d+ GB · DDR4 · \d+ MHz de fábrica.* · rodando a \d+ MHz/);
    expect(detailOf(pc, 'gpu')).toMatch(/^8 GB/);
  });

  it('resumo numa linha para o cartão recolhido: processador, placa de vídeo, memória e fonte', () => {
    expect(pcSummary(pc)).toMatch(/^AMD Ryzen 7 5800X3D · RX 6600 8 GB · \d+ GB DDR4$/);
    expect(pcSummary(pc, { title: 'Fonte 650W', specs: { watts: 650 } })).toMatch(/ · Fonte 650 W$/);
    expect(pcSummary({ ...pc, gpu: undefined, cpu: { ...pc.cpu!, specs: { ...pc.cpu!.specs, igpu: true } } })).toContain(' · Vídeo integrado · ');
  });

  it('disco: tipo, tamanho, nome, sistema e espaço livre', () => {
    expect(driveText({ name: 'Samsung 980', kind: 'nvme', capacityGb: 1907, system: true, freePercent: 31.6 })).toBe('SSD NVMe 1,9 TB · Samsung 980 (sistema, 32% livre)');
    expect(driveText({ name: 'WD Blue', kind: 'hdd', capacityGb: 931, system: false })).toBe('HD 931 GB · WD Blue');
  });
});
