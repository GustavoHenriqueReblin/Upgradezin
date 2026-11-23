import { describe, expect, it } from 'vitest';
import amd from '../fixtures/cpuz/amd-am4-rx6600.txt?raw';
import intel from '../fixtures/cpuz/intel-lga1700-rtx4060ti.txt?raw';
import { normalizeListing } from './categorize.ts';
import { parseCpuzReport, type PcProfile } from './cpuz.ts';
import { cpuNeeded, cpuPerf, GPU_PERF, gpuMatching } from './perf.ts';
import { analyzePc } from './upgrade.ts';
import { GPU_POWER } from './hardware.ts';

const part = (category: 'cpu' | 'gpu' | 'motherboard', title: string) => ({ title, specs: normalizeListing(category, title).specs });

/** PC de exemplo: só o que cada teste precisa. */
const pcOf = (p: Partial<PcProfile>): PcProfile => ({ source: 'cpu-z', drives: [], monitors: [{ width: 1920, height: 1080, maxHz: 60 }], ...p });

describe('tabela de desempenho', () => {
  it('toda placa com consumo conhecido tem desempenho, e vice-versa', () => {
    const current = Object.keys(GPU_PERF).filter((m) => !/^(GT |GTX 7)/.test(m));
    for (const m of current) expect(GPU_POWER[m], m).toBeDefined();
  });
  it('referências e modelos fora da curva', () => {
    expect(cpuPerf(normalizeListing('cpu', 'Processador AMD Ryzen 5 5600, AM4').specs)).toBe(100);
    expect(cpuPerf(normalizeListing('cpu', 'Processador AMD Ryzen 7 5800X3D, AM4').specs)).toBe(132);
    expect(cpuPerf(normalizeListing('cpu', 'Processador Intel Core i5-13600K, LGA1700').specs)).toBe(132);
    expect(cpuPerf(normalizeListing('cpu', 'Processador Intel Core i5-13400F, LGA1700').specs)).toBe(110);
  });
  it('pares equilibrados de referência', () => {
    expect(cpuNeeded(100, '1080p')).toBeCloseTo(100);
    expect(cpuNeeded(310, '1080p')).toBeCloseTo(184);
    expect(gpuMatching(100, '1080p')).toBeCloseTo(100);
  });
});

describe('análise do PC importado', () => {
  it('5800X3D + RX 6600 em monitor de 144 Hz: placa de vídeo é o gargalo, e as dicas grátis aparecem', () => {
    const a = analyzePc(parseCpuzReport(amd)!);
    expect(a.balance).toMatchObject({ verdict: 'gpu', cpu: 132, gpu: 95, res: '1080p', hz: 144 });
    expect(a.tips.map((t) => t.id)).toEqual(['gpu-upgrade', 'ram-xmp', 'system-nvme', 'monitor-hz', 'whea', 'motherboard']);
    const gpu = a.tips[0]!;
    expect(gpu.text).toContain('RTX 4070');
    expect(gpu.text).toContain('fonte a partir de 500 W');
    expect(gpu.action?.slot).toBe('gpu');
    expect(gpu.action?.filters.gpuModels).toEqual(expect.arrayContaining(['RX 7700 XT', 'RX 7800 XT', 'RTX 4070']));
    // B450 é PCIe 3.0: placas de 8 linhas ficam de fora, e o texto explica.
    expect(gpu.action?.filters.gpuModels).not.toContain('RTX 5060 Ti');
    expect(gpu.text).toContain('PCIe 3.0');
    expect(gpu.action?.filters.gpuModels).not.toContain('RX 6600');
    expect(gpu.action?.filters.gpuModels).not.toContain('RTX 4090');
  });

  it('placa-mãe de entrada: PCIe 3.0, energia para processador de 105 W, já no topo do encaixe', () => {
    const mb = analyzePc(parseCpuzReport(amd)!).tips.find((t) => t.id === 'motherboard')!;
    expect(mb).toMatchObject({ kind: 'info', title: 'Placa-Mãe de Entrada' });
    expect(mb.text).toMatch(/B450M-DA.*PCIe 3\.0.*VRM.*105 W.*melhor processador para jogos desse encaixe/s);
  });

  it('placa-mãe atual (B760, PCIe 4.0, chipset intermediário): sem observação', () => {
    expect(analyzePc(parseCpuzReport(intel)!).tips.map((t) => t.id)).not.toContain('motherboard');
  });

  it('fonte simples (sem PFC ativo, sem certificação): avisa e pede troca junto com a placa', () => {
    const pc = { ...parseCpuzReport(amd)!, psu: { title: 'Fonte 500W', specs: { watts: 500, activePfc: false } } };
    const a = analyzePc(pc);
    expect(a.tips.map((t) => t.id)).toContain('psu-basic');
    expect(a.tips[0]!.text).toContain('troque-a junto');
    const good = analyzePc({ ...pc, psu: { title: 'Fonte 650W', specs: { watts: 650, activePfc: true, efficiency: 'bronze' as const } } });
    expect(good.tips.map((t) => t.id)).not.toContain('psu-basic');
    expect(good.tips[0]!.text).toContain('cabem na sua fonte de 650 W');
  });

  it('com a fonte informada, só placas que cabem nela; sem nenhuma, avisa que a fonte entra na troca', () => {
    const pc = parseCpuzReport(amd)!;
    const big = analyzePc(pc, { psu: { watts: 750 } }).tips[0]!;
    expect(big.text).toContain('cabem na sua fonte de 750 W');
    const small = analyzePc(pc, { psu: { watts: 300 } });
    expect(small.tips[0]!.text).toContain('não aguenta essas placas');
    expect(small.tips.map((t) => t.id)).toContain('psu-weak');
  });

  it('Intel equilibrado em 1440p: sem troca de peça; XMP, Hz e disco cheio', () => {
    const a = analyzePc(parseCpuzReport(intel)!);
    expect(a.balance).toMatchObject({ verdict: 'balanced', res: '1440p', hz: 165 });
    expect(a.tips.map((t) => t.id)).toEqual(['ram-xmp', 'monitor-hz', 'system-full']);
  });

  it('processador fraco para a placa, com upgrade no mesmo encaixe', () => {
    const a = analyzePc(
      pcOf({
        cpu: part('cpu', 'Processador AMD Ryzen 5 2600, AM4'),
        motherboard: part('motherboard', 'Placa-Mãe ASUS B450M, AM4, DDR4'),
        gpu: part('gpu', 'Placa de Vídeo RTX 4070 12GB'),
      }),
    );
    expect(a.balance.verdict).toBe('cpu');
    expect(a.tips[0]).toMatchObject({ id: 'cpu-upgrade', action: { slot: 'cpu', filters: { sockets: ['AM4'] } } });
    expect(a.tips[0]!.action!.filters.cpuLines).toEqual(expect.arrayContaining(['Ryzen 5', 'Ryzen 7']));
    expect(a.tips[0]!.text).toContain('5800X3D');
  });

  it('já no topo do encaixe: o próximo passo é trocar a plataforma', () => {
    const a = analyzePc(pcOf({ cpu: part('cpu', 'Processador AMD Ryzen 7 5800X3D, AM4'), gpu: part('gpu', 'Placa de Vídeo RTX 4090 24GB') }));
    expect(a.balance.verdict).toBe('cpu');
    expect(a.tips[0]).toMatchObject({ id: 'platform-upgrade', action: { filters: { sockets: ['AM5'] } } });
  });

  it('só com vídeo integrado: sugere colocar uma placa de vídeo', () => {
    const a = analyzePc(pcOf({ cpu: part('cpu', 'Processador AMD Ryzen 5 5600G, AM4') }));
    expect(a.balance.verdict).toBe('gpu');
    expect(a.tips[0]).toMatchObject({ id: 'gpu-upgrade', title: 'Colocar uma Placa de Vídeo' });
  });

  it('memória pouca, num pente só e lenta para Ryzen: um kit de 2 pentes', () => {
    const a = analyzePc(
      pcOf({
        cpu: part('cpu', 'Processador AMD Ryzen 5 5600, AM4'),
        ram: { title: '8 GB', specs: { memory: 'ddr4', ramCapacity: 8, ramModules: 1, ramSpeed: 2400 }, modules: [{ sizeGb: 8 }], ratedSpeed: 2400, runningSpeed: 2400 },
      }),
    );
    const ram = a.tips.find((t) => t.id === 'ram-upgrade')!;
    expect(ram.text).toMatch(/pouco.*single channel.*lento para Ryzen/);
    expect(ram.action!.filters).toEqual({ memory: ['ddr4'], ramModules: [2], ramCapacity: [16, 32], ramSpeed: [3200, 3600] });
    expect(a.tips.map((t) => t.id)).not.toContain('ram-xmp');
  });

  it('Windows num HD, com e sem SSD sobrando', () => {
    const hdd = { name: 'HD', kind: 'hdd' as const, capacityGb: 1000, system: true, freePercent: 50 };
    expect(analyzePc(pcOf({ drives: [hdd] })).tips[0]).toMatchObject({ id: 'system-hdd', kind: 'upgrade', action: { slot: 'ssd', filters: { ssdCapacity: [500, 1000] } } });
    const nvme = { name: 'NVMe', kind: 'nvme' as const, capacityGb: 1000, system: false };
    expect(analyzePc(pcOf({ drives: [hdd, nvme] })).tips[0]).toMatchObject({ id: 'system-hdd', kind: 'free', title: 'Passar o Windows para o SSD' });
  });

  it('modelo fora da tabela: não chuta o gargalo', () => {
    const a = analyzePc(pcOf({ cpu: { title: 'Processador Misterioso', specs: {} }, gpu: part('gpu', 'Placa de Vídeo RTX 4060 8GB') }));
    expect(a.balance).toMatchObject({ verdict: 'unknown', missing: 'o processador Processador Misterioso' });
    expect(a.tips).toEqual([]);
  });
});

describe('placas novas na tabela (nov/2026)', () => {
  it('RX 9050 e RX 7650 GRE têm índice, entre as vizinhas da TechPowerUp, e consumo', async () => {
    const { GPU_POWER } = await import('./hardware.ts');
    const { GPU_PCIE_X8 } = await import('./perf.ts');
    expect(GPU_PERF['RX 9050']).toBeGreaterThan(GPU_PERF['RX 6600']!);
    // Polaris antigas e as RX da Mancer: em volta das referências que a TechPowerUp e os testes públicos dão.
    expect(GPU_PERF['RX 480']).toBeLessThan(GPU_PERF['RX 580']!);
    expect(GPU_PERF['RX 470']).toBeLessThan(GPU_PERF['RX 570']!);
    expect(GPU_PERF['RX 460']).toBeLessThan(GPU_PERF['RX 560']!);
    expect(GPU_PERF['RX 5500']).toBeLessThanOrEqual(GPU_PERF['RX 5500 XT']!);
    expect(GPU_PERF['RX 5500']).toBeGreaterThanOrEqual(GPU_PERF['GTX 1650 Super']!);
    expect(GPU_PERF['RX 560 XT']).toBe(GPU_PERF['GTX 1650']);
    expect(GPU_PERF['GTX 950']).toBeGreaterThan(GPU_PERF['GTX 750 Ti']!);
    expect(GPU_PERF['RX 7650 GRE']).toBeGreaterThan(GPU_PERF['RX 7600']!);
    expect(GPU_PERF['RX 7650 GRE']).toBeLessThan(GPU_PERF['RX 7600 XT']!);
    expect([GPU_POWER['RX 9050'], GPU_POWER['RX 7650 GRE']]).toEqual([92, 170]);
    expect(GPU_PCIE_X8.has('RX 7650 GRE')).toBe(true);
    expect(GPU_PCIE_X8.has('RX 9050')).toBe(false); // PCIe 5.0 x16
  });
});
