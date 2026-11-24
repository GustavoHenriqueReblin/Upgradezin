import { describe, expect, it } from 'vitest';
import { checkBuild } from '../compat.ts';
import { sheetSpecs, withSheetSpecs } from './specs.ts';

describe('ficha → specs (busca, filtros, montagem)', () => {
  it('placa-mãe: soquete, chipset, formato, memória, slots, Wi-Fi (com Bluetooth)', () => {
    expect(sheetSpecs('motherboard', { socket: 'AM5', chipset: 'B650', formFactor: 'Micro-ATX', ramType: 'DDR5', ramSlots: 2, wifi: 'Wi-Fi 6E' })).toEqual({
      socket: 'AM5',
      chipset: 'B650',
      formFactor: 'matx',
      memory: 'ddr5',
      memorySlots: 2,
      wifi: true,
      bluetooth: true,
    });
    expect(sheetSpecs('motherboard', { formFactor: 'E-ATX' }).formFactor).toBe('eatx');
    expect(sheetSpecs('motherboard', { formFactor: 'Mini-ITX', socket: 'AM3+' })).toEqual({ formFactor: 'mini-itx' }); // soquete fora da lista: sem valor
  });

  it('processador, placa de vídeo, memória e SSD', () => {
    expect(sheetSpecs('cpu', { socket: 'LGA1700', cores: 14, threads: 20, tdpW: 125, igpu: 'Não' })).toEqual({ socket: 'LGA1700', cores: 14, threads: 20, tdp: 125, igpu: false });
    expect(sheetSpecs('cpu', { igpu: 'Radeon Graphics' }).igpu).toBe(true);
    expect(sheetSpecs('gpu', { chip: 'RTX 5060 Ti', vramGb: 16, memType: 'GDDR7', lengthMm: 245, power16Pin: 0 })).toEqual({
      gpuModel: 'RTX 5060 Ti',
      vram: 16,
      vramType: 'GDDR7',
      gpuLength: 245,
      gpu16Pin: false,
    });
    expect(sheetSpecs('ram', { type: 'DDR4', capacityGb: 16, modules: 2, mhz: 3200, cl: 16 })).toEqual({ memory: 'ddr4', ramCapacity: 16, ramModules: 2, ramSpeed: 3200, ramLatency: 16 });
    expect(sheetSpecs('ssd', { interface: 'NVMe PCIe 4.0', formFactor: 'M.2 2280', capacityGb: 1000, readMbs: 7000 })).toEqual({
      ssdInterface: 'nvme',
      ssdForm: 'm2',
      ssdCapacity: 1000,
      ssdPcie: 4,
      ssdRead: 7000,
    });
    expect(sheetSpecs('ssd', { interface: 'SATA', formFactor: '2,5"' })).toEqual({ ssdInterface: 'sata', ssdForm: '2.5' });
  });

  it('fonte: selo (80 Plus ou Cybenetics), modular, ATX 3.x, SFX, 16 pinos', () => {
    expect(sheetSpecs('psu', { watts: 750, efficiency: '80 Plus Gold', modular: 'Total', standard: 'ATX 3.1', pcie16: 1 })).toEqual({
      watts: 750,
      efficiency: 'gold',
      efficiencyCert: '80plus',
      modular: 'full',
      atx: '3.1',
      pcie5: true,
    });
    expect(sheetSpecs('psu', { efficiency: 'Cybenetics Platinum', modular: 'Não', standard: 'SFX' })).toEqual({ efficiency: 'platinum', efficiencyCert: 'cybenetics', modular: 'none', sfx: true });
    expect(sheetSpecs('psu', { efficiency: 'Sem certificação', modular: 'Semi' })).toEqual({ modular: 'semi' });
  });

  it('gabinete: a maior placa que cabe, torre, medidas e radiadores; cooler: tipo, soquetes (115x juntos), altura', () => {
    expect(sheetSpecs('case', { formFactor: 'Mid Tower', mbFormats: 'Micro-ATX,ATX,Mini-ITX', maxGpuMm: 380, maxCoolerMm: 165, fansIncluded: 0, radiators: '120,240,360' })).toEqual({
      caseFormFactor: 'atx',
      caseTower: 'mid',
      caseMaxGpu: 380,
      caseMaxCooler: 165,
      caseFans: 0,
      caseRadiators: [120, 240, 360],
    });
    expect(sheetSpecs('cooler', { type: 'ar', heightMm: 155, sockets: 'LGA1700,LGA1151,LGA1150,AM5', tdpW: 220 })).toEqual({
      coolerType: 'air',
      coolerSockets: ['LGA1700', 'LGA115X', 'AM5'],
      coolerBrands: ['intel', 'amd'],
      coolerTdp: 220,
      coolerHeight: 155,
    });
    expect(sheetSpecs('cooler', { type: 'water', radiatorMm: 360 })).toEqual({ coolerType: 'water', radiator: 360 });
  });

  it('com o título: o que a ficha cobre vem só dela; o resto fica o do título', () => {
    // Título dizia 650 W e Bronze; a ficha diz 750 W e não tem selo: vale a ficha (sem selo). Cor e RGB ficam.
    expect(withSheetSpecs('psu', { watts: 650, efficiency: 'bronze', white: true, rgb: true }, { watts: 750 })).toEqual({ watts: 750, white: true, rgb: true });
    // Linha e modelo do processador não estão na ficha: continuam os do título.
    expect(withSheetSpecs('cpu', { cpuLine: 'Ryzen 5', cpuModel: '5600', socket: 'AM5', cores: 8 }, { socket: 'AM4', cores: 6 })).toEqual({ cpuLine: 'Ryzen 5', cpuModel: '5600', socket: 'AM4', cores: 6 });
    // B650E: a ficha diz o chip (B650), o título a versão (B650E).
    expect(withSheetSpecs('motherboard', { chipset: 'B650E' }, { chipset: 'B650' }).chipset).toBe('B650E');
    expect(withSheetSpecs('motherboard', { chipset: 'H510' }, { chipset: 'H470' }).chipset).toBe('H470');
  });

  it('a montagem volta a conferir as medidas com a ficha: placa de vídeo maior que o gabinete', () => {
    const gpu = withSheetSpecs('gpu', { gpuModel: 'RTX 5070' }, { chip: 'RTX 5070', lengthMm: 340 });
    const pcase = withSheetSpecs('case', {}, { mbFormats: 'ATX,Micro-ATX', maxGpuMm: 320 });
    expect(checkBuild({ gpu: { specs: gpu }, case: { specs: pcase } }).issues.map((i) => i.code)).toContain('case-gpu-length');
  });
});
