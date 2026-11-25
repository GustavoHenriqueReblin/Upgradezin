import { describe, expect, it } from 'vitest';
import amd from '../fixtures/cpuz/amd-am4-rx6600.txt?raw';
import intel from '../fixtures/cpuz/intel-lga1700-rtx4060ti.txt?raw';
import { checkBuild } from './compat.ts';
import { parseCpuzReport } from './cpuz.ts';

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

describe('relatório do CPU-Z: AMD AM4, DDR4, Radeon', () => {
  const pc = parseCpuzReport(crlf(amd))!;

  it('processador com encaixe, núcleos e TDP', () => {
    expect(pc.version).toBe('2.17.0.x64');
    expect(pc.cpu).toMatchObject({
      title: 'AMD Ryzen 7 5800X3D',
      brand: 'AMD',
      specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '5800X3D', socket: 'AM4', cores: 8, threads: 16, tdp: 105, igpu: false },
    });
  });

  it('placa-mãe: modelo, chipset, memória e slots (fabricante "Default string" fica de fora)', () => {
    expect(pc.motherboard).toMatchObject({
      title: 'B450M-DA',
      specs: { socket: 'AM4', chipset: 'B450', memory: 'ddr4', memorySlots: 4, formFactor: 'matx' },
    });
    expect(pc.motherboard!.brand).toBeUndefined();
  });

  it('memória: 2 pentes sem contar a repetição dos registradores, XMP gravado e rodando abaixo dele', () => {
    expect(pc.ram).toMatchObject({
      title: 'Kingston 32 GB (2x 16 GB) DDR4 3200 MHz',
      specs: { memory: 'ddr4', ramCapacity: 32, ramModules: 2, ramSpeed: 3200, ramLatency: 16 },
      ratedSpeed: 3200,
      runningSpeed: 2400,
      profile: 'xmp',
    });
    expect(pc.ram!.modules).toEqual([
      { sizeGb: 16, maker: 'Kingston', part: 'KF3200C16D4/16GX' },
      { sizeGb: 16, maker: 'Kingston', part: 'KF3200C16D4/16GX' },
    ]);
  });

  it('placa de vídeo com fabricante, VRAM e linhas PCIe em uso', () => {
    expect(pc.gpu).toMatchObject({
      title: 'ASRock AMD Radeon RX 6600 8 GB',
      brand: 'ASRock',
      specs: { gpuMaker: 'amd', gpuModel: 'RX 6600', gpuSeries: 'RX 6000', vram: 8, vramType: 'GDDR6' },
      pcieWidth: 8,
    });
  });

  it('discos, monitor e erros WHEA', () => {
    expect(pc.drives).toEqual([
      { name: 'TOSHIBA DT01ACA050', kind: 'hdd', interface: 'sata', capacityGb: 466, system: false, freePercent: 100 },
      { name: 'KINGSTON SA400S37240G', kind: 'ssd', interface: 'sata', capacityGb: 224, system: true, freePercent: 15.7 },
      { name: 'KINGSTON SNV3S1000G', kind: 'nvme', interface: 'nvme', capacityGb: 932, system: false, freePercent: 37.7 },
    ]);
    expect(pc.monitors).toEqual([{ name: 'Monitor Exemplo', width: 1920, height: 1080, maxHz: 144, inches: 23.8 }]);
    expect(pc.wheaErrors).toBe(7);
  });

  it('não guarda números de série nem identificadores', () => {
    expect(JSON.stringify(pc)).not.toMatch(/XXXXXXXX|serial|uuid|removido/i);
  });

  it('as peças entram na checagem de compatibilidade como as das lojas', () => {
    const r = checkBuild({ cpu: pc.cpu, motherboard: pc.motherboard, ram: pc.ram, gpu: pc.gpu });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.power?.estimate).toBeGreaterThan(200);
  });

  it('peças atuais funcionam juntas: o aviso de BIOS some; uma peça nova continua sendo conferida', () => {
    const parts = { cpu: pc.cpu!, motherboard: pc.motherboard!, ram: pc.ram!, gpu: pc.gpu! };
    const asNew = checkBuild(parts);
    expect(asNew.issues.map((i) => i.code)).toContain('chipset-bios');
    const current = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { specs: v.specs, current: true }]));
    expect(checkBuild(current).issues).toEqual([]);
    const newCpu = { specs: { ...pc.cpu!.specs } };
    expect(checkBuild({ ...current, cpu: newCpu }).issues.map((i) => i.code)).toContain('chipset-bios');
    // Fonte que a pessoa já tem, fraca para o PC: continua avisando.
    expect(checkBuild({ ...current, psu: { specs: { watts: 250 }, current: true } }).issues.map((i) => i.code)).toContain('psu-too-weak');
  });
});

describe('relatório do CPU-Z: Intel LGA1700, DDR5, GeForce', () => {
  const pc = parseCpuzReport(intel)!;

  it('processador Intel sem vídeo integrado', () => {
    expect(pc.cpu).toMatchObject({
      brand: 'Intel',
      specs: { cpuBrand: 'intel', cpuLine: 'Core i5', cpuModel: '13400F', socket: 'LGA1700', cores: 10, threads: 16, tdp: 65, igpu: false },
    });
  });

  it('placa-mãe com fabricante abreviado e sem o código interno do modelo', () => {
    expect(pc.motherboard).toMatchObject({
      title: 'MSI PRO B760M-A WIFI',
      brand: 'MSI',
      specs: { socket: 'LGA1700', chipset: 'B760', memory: 'ddr5', memorySlots: 4, wifi: true },
    });
  });

  it('DDR5 com XMP de 6000 rodando a 4800', () => {
    expect(pc.ram).toMatchObject({
      title: 'Kingston 32 GB (2x 16 GB) DDR5 6000 MHz',
      specs: { memory: 'ddr5', ramCapacity: 32, ramModules: 2, ramSpeed: 6000, ramLatency: 36 },
      ratedSpeed: 6000,
      runningSpeed: 4800,
      profile: 'xmp',
    });
  });

  it('GeForce com VRAM em GB e pendrive fora da lista de discos', () => {
    expect(pc.gpu).toMatchObject({ title: 'Gigabyte NVIDIA GeForce RTX 4060 Ti 8 GB', specs: { gpuModel: 'RTX 4060 Ti', vram: 8 }, pcieWidth: 8 });
    expect(pc.drives.map((d) => [d.kind, d.capacityGb, d.system])).toEqual([
      ['nvme', 466, true],
      ['hdd', 1864, false],
    ]);
    expect(pc.drives[0]!.freePercent).toBe(6.2);
    expect(pc.monitors[0]).toMatchObject({ width: 2560, height: 1440, maxHz: 165 });
    expect(pc.wheaErrors).toBe(0);
  });
});

describe('relatórios incompletos ou de outro programa', () => {
  it('texto que não é do CPU-Z', () => {
    expect(parseCpuzReport('DxDiag\nSystem Information\n------------------\n')).toBeNull();
    expect(parseCpuzReport('')).toBeNull();
  });

  it('só com vídeo integrado: sem placa de vídeo dedicada', () => {
    const text = intel
      .replace('NVIDIA GeForce RTX 4060 Ti', 'Intel(R) UHD Graphics 770')
      .replace('Intel Core i5 13400F', 'Intel Core i5 13400')
      .replace('i5-13400F', 'i5-13400');
    const pc = parseCpuzReport(text)!;
    expect(pc.gpu).toBeUndefined();
    expect(pc.cpu!.specs.igpu).toBe(true);
  });

  it('sem leitura do SPD: pentes pelo DMI, frequência pelo chipset', () => {
    const text = amd.replace(/Memory SPD\r?\n-+[\s\S]*?(?=\r?\nDMI\r?\n)/, '');
    const pc = parseCpuzReport(text)!;
    expect(pc.ram).toMatchObject({ specs: { memory: 'ddr4', ramCapacity: 32, ramModules: 2, ramSpeed: 2400 }, runningSpeed: 2400 });
    expect(pc.ram!.profile).toBeUndefined();
  });
});

describe('arquivo forjado', () => {
  it('nome gigante, caracteres de controle e invisíveis: limpos e cortados', () => {
    const huge = 'A'.repeat(50_000);
    const text = amd
      .replace('AMD Ryzen 7 5800X3D', `AMD Ryzen 7 5800X3D\u202e\u0007<img src=x onerror=alert(1)>${huge}`)
      .replace('KINGSTON SNV3S1000G', `KINGSTON\u0000\u200bSNV${huge}`);
    const pc = parseCpuzReport(text)!;
    expect(pc.cpu!.title.length).toBeLessThanOrEqual(160);
    expect(pc.cpu!.title).not.toMatch(/[\u0000-\u001f\u202e\u200b]/);
    // HTML fica como texto (quem mostra é o React, que escapa); o modelo continua reconhecido.
    expect(pc.cpu!.specs.cpuModel).toBe('5800X3D');
    expect(pc.drives[2]!.name.length).toBeLessThanOrEqual(200);
    expect(pc.drives[2]!.name.startsWith('KINGSTONSNV')).toBe(true);
  });

  it('milhares de discos e monitores: lista com teto', () => {
    const drive = '\r\nDrive\t\t9\r\n\tName\t\tDisco\r\n\tCapacity\t\t100 GB\r\n\tType\t\tFixed, SSD\r\n\tBus Type\t\tSATA (11)\r\n';
    const monitor = '\r\nMonitor 9\t\t\r\n\tMax Resolution\t\t1920 x 1080 @ 60 Hz\r\n';
    const text = amd.replace(/(\r?\nStorage\r?\n-+\r?\n)/, `$1${drive.repeat(3000)}`).replace(/(\r?\nDisplay Adapters\r?\n-+\r?\n)/, `$1${monitor.repeat(3000)}`);
    const pc = parseCpuzReport(text)!;
    expect(pc.drives.length).toBe(16);
    expect(pc.monitors.length).toBe(8);
  });
});
