import { describe, expect, it } from 'vitest';
import { extractSsdSpecs, isSsd, ssdCapacityLabel, ssdModelKey, ssdTier } from './ssd.ts';

describe('SSD', () => {
  it('reconhece SSD interno e descarta acessório, externo e de servidor', () => {
    expect(isSsd('SSD Kingston NV3, 1TB, M.2 2280, PCIe 4.0 x4, NVMe, Leitura: 6000 MB/s - SNV3S/1000G')).toBe(true);
    expect(isSsd('HD SSD Interno Kingston 120GB A400 Sata 3 Cor Preto')).toBe(true);
    expect(isSsd('Samsung SSD Sata 870 Evo 500 Gb 2,5 "')).toBe(true);
    expect(isSsd('Disco Sólido Interno Netac SSD 512GB 3d Nand Sata3 6gbs 560mbs')).toBe(true);
    expect(isSsd('SSD SanDisk Optimus GX PRO 850X com Dissipador, 1TB, M.2 2280, PCIe 4.0 x4, NVMe')).toBe(true);
    expect(isSsd('Dissipador SSD M.2 2280 Nvme/ngff 3mm Black + Thermal Pad')).toBe(false);
    expect(isSsd('Case SSD Externo M.2 Nvme Tipo C Usb 3.1')).toBe(false);
    expect(isSsd('SSD Kingston DC600M Para Servidor, 1.92TB, SATA III 6GB/s, 2.5"')).toBe(false);
    expect(isSsd('HD Seagate BarraCuda 1TB 7200 RPM')).toBe(false);
  });

  it('interface, formato, capacidade, geração e leitura', () => {
    expect(extractSsdSpecs('SSD Kingston NV3, 1TB, M.2 2280, PCIe 4.0 x4, NVMe, Leitura: 6000 MB/s, Gravação: 4000 MB/s, Azul - SNV3S/1000G')).toEqual({
      ssdInterface: 'nvme',
      ssdForm: 'm2',
      ssdCapacity: 1000,
      ssdPcie: 4,
      ssdRead: 6000,
    });
    expect(extractSsdSpecs('SSD Kingston A400, 480GB, 2.5", SATA III, Leitura: 500 MB/s, Gravação: 450 MB/s, Preto - SA400S37/480G')).toEqual({
      ssdInterface: 'sata',
      ssdForm: '2.5',
      ssdCapacity: 480,
      ssdRead: 500,
    });
    expect(extractSsdSpecs('SSD M.2 PCie 3.0 Sandisk Plus 500gb, Nvme, Leitura 2400mb/s')).toMatchObject({ ssdInterface: 'nvme', ssdPcie: 3, ssdCapacity: 500, ssdRead: 2400 });
    expect(extractSsdSpecs('SSD Kingston FURY Renegade G5, 1TB, M.2 2280, PCIe 5.0 x4, NVMe')).toMatchObject({ ssdPcie: 5 });
  });

  it('formas curtas e M.2 sem interface no título (pela leitura)', () => {
    expect(extractSsdSpecs('SSD Hiksemi Wave (P) 512G, M.2 2280, Leitura 2500MBs e Gravação 1025MBs')).toMatchObject({ ssdCapacity: 512, ssdInterface: 'nvme', ssdForm: 'm2' });
    expect(extractSsdSpecs('SSD Hiksemi Wave 1T, M.2 2280, Leitura 560MBs e Gravação 510MBs')).toMatchObject({ ssdCapacity: 1000, ssdInterface: 'sata' });
    expect(extractSsdSpecs('SSD Kingston DC600M, 1,92 TB, SATA')).toMatchObject({ ssdCapacity: 1920 });
    expect(extractSsdSpecs('SSD WD Green M.2 SATA 240GB')).toMatchObject({ ssdInterface: 'sata', ssdForm: 'm2' });
  });

  it('faixas de capacidade e rótulo', () => {
    expect([120, 256, 480, 512, 960, 1000, 2000, 4000].map(ssdTier)).toEqual([128, 250, 500, 500, 1000, 1000, 2000, 4000]);
    expect(ssdTier(8000)).toBeUndefined();
    expect(ssdCapacityLabel(480)).toBe('480 GB');
    expect(ssdCapacityLabel(2000)).toBe('2 TB');
  });

  it('o mesmo SSD em títulos diferentes vira a mesma chave', () => {
    const a = ssdModelKey('SSD Kingston NV3, 1TB, M.2 2280, PCIe 4.0 x4, NVMe, Leitura: 6000 MB/s - SNV3S/1000G', 'Kingston');
    const b = ssdModelKey('SSD Kingston Nv3 1TB M.2 2280 Nvme Gen4, Desempenho E Eficiência Para Upgrade De PC – Snv3s/1000g', 'Kingston');
    expect(b).toBe(a);
    expect(a).toBe('kingston nv3 1000gb nvme');
    expect(ssdModelKey('SSD Kingston NV3, 500GB, M.2 2280, NVMe', 'Kingston')).not.toBe(a);
  });
});
