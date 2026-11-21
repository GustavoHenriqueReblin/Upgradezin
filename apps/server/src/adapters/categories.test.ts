import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { groupOffers, type CategoryId, type Offer } from '@upgradezin/shared';
import { mapS1Product, parseS1Html } from './s1.ts';
import { mapS2Item, parseS2Rsc, rscFromHtml } from './s2.ts';
import { mapS3Card, readS3Cards, S3_CARD_SELECTOR } from './s3.ts';
import { COLLECTED_AT, fixture } from './fixtures.ts';

const s1 = (category: CategoryId) =>
  parseS1Html(fixture(`s1-${category}.html`))
    .data.map((p) => mapS1Product(p, COLLECTED_AT, category))
    .filter((o): o is Offer => !!o);
const s2 = (category: CategoryId) =>
  parseS2Rsc(rscFromHtml(fixture(`s2-${category}.html`)))
    .items.map((it) => mapS2Item(it, COLLECTED_AT, category))
    .filter((o): o is Offer => !!o);
const s3 = (category: CategoryId) =>
  readS3Cards(Array.from(parseHTML(fixture(`s3-${category}.html`)).document.querySelectorAll(S3_CARD_SELECTOR)))
    .map((c) => mapS3Card(c, COLLECTED_AT, category))
    .filter((o): o is Offer => !!o);
const sku = (list: Offer[], id: string) => list.find((o) => o.storeSku === id)!;

describe('Processador', () => {
  it('S1: descarta plataforma antiga (LGA1155) e lê as specs', () => {
    const offers = s1('cpu');
    expect(offers.map((o) => o.storeSku)).not.toContain('223556');
    expect(sku(offers, '320797').specs).toMatchObject({
      cpuBrand: 'amd',
      cpuLine: 'Ryzen 7',
      cpuModel: '5700X',
      cpuGen: 'Ryzen 5000',
      socket: 'AM4',
      cores: 8,
      threads: 16,
      igpu: false,
      cooler: false, // part number WOF
      unlocked: true,
    });
    expect(sku(offers, '520366').specs).toMatchObject({ cpuModel: '8500G', socket: 'AM5', igpu: true });
  });

  it('S1: part number cortado (mesmo código para i5 e i7) não junta produtos diferentes', () => {
    const offers = s1('cpu');
    const groups = groupOffers(offers);
    const i5 = groups.find((g) => g.key.includes('14600kf'))!;
    const i7 = groups.find((g) => g.key.includes('14700kf'))!;
    expect(i5).toBeDefined();
    expect(i7).toBeDefined();
    expect(i5.key).not.toBe(i7.key);
  });

  it('S2: specs no formato "8-Core, 16-Threads"', () => {
    expect(sku(s2('cpu'), '51791').specs).toMatchObject({ cpuLine: 'Core Ultra 7', cpuModel: '265K', socket: 'LGA1851', cores: 20, unlocked: true });
  });

  it('S3: cooler dito no título; descarta LGA1155 e cooler avulso', () => {
    const offers = s3('cpu');
    expect(offers.map((o) => o.specs.cpuModel).sort()).toEqual(['12400F', '5500', '5700X']);
    expect(offers.find((o) => o.specs.cpuModel === '5500')!.specs.cooler).toBe(true);
    expect(offers.find((o) => o.specs.cpuModel === '5700X')!.specs.cooler).toBe(false);
  });

  it('o mesmo processador nas três lojas vira um produto só', () => {
    const groups = groupOffers([...s1('cpu'), ...s2('cpu'), ...s3('cpu')]);
    const r7 = groups.find((g) => g.key === 'amd ryzen 7 5700x')!;
    expect(r7.offers.map((o) => o.store).sort()).toEqual(['s1', 's2', 's3']);
  });
});

describe('Placa de vídeo', () => {
  const offers = s1('gpu');

  it('descarta acessório (suporte) pela categoria da loja e pelo título', () => {
    expect(offers.map((o) => o.storeSku)).not.toContain('507105');
  });

  it('chip, VRAM e tipo de memória', () => {
    expect(sku(offers, '912220').specs).toMatchObject({ gpuMaker: 'nvidia', gpuModel: 'RTX 5060', vram: 8, vramType: 'GDDR7' });
    expect(sku(offers, '907814').specs).toMatchObject({ gpuMaker: 'amd', gpuModel: 'RX 7600', vram: 8, vramType: 'GDDR6' });
    expect(sku(offers, '1020030').specs.gpuModel).toBe('RTX 3060 Ti');
  });

  it('anúncio de marketplace com título "Gpu …" é lido e marcado', () => {
    expect(sku(offers, '954798')).toMatchObject({ marketplace: true, specs: { gpuModel: 'RTX 5070 Ti', vram: 16 } });
  });

  it('S3: descarta placa profissional de IA e lê chip/VRAM; DDR3 fica sem tipo GDDR', () => {
    const s3gpu = s3('gpu');
    expect(s3gpu.map((o) => o.storeSku)).not.toContain('40183');
    expect(sku(s3gpu, '36459').specs).toMatchObject({ gpuMaker: 'amd', gpuModel: 'RX 9060 XT', vram: 16, vramType: 'GDDR6' });
    expect(sku(s3gpu, '42439').specs).toMatchObject({ gpuModel: 'GT 730', vram: 4 });
    expect(sku(s3gpu, '42439').specs.vramType).toBeUndefined();
  });

  it('a mesma placa em lojas diferentes vira um produto só', () => {
    const groups = groupOffers([...s1('gpu'), ...s3('gpu')]);
    const eagle = groups.find((g) => g.key === 'gigabyte rtx 5060 8gb eagle max oc')!;
    expect(eagle.offers.map((o) => o.store).sort()).toEqual(['s1', 's3']);
  });
});

describe('Memória RAM', () => {
  const offers = s1('ram');

  it('descarta memória de notebook e DDR3', () => {
    expect(offers.map((o) => o.storeSku).sort()).toEqual(['448302', '943844']);
  });

  it('kit: capacidade total, pentes, frequência, latência, RGB e cor', () => {
    expect(sku(offers, '448302').specs).toMatchObject({
      memory: 'ddr5',
      ramCapacity: 32,
      ramModules: 2,
      ramSpeed: 5600,
      ramLatency: 36,
      rgb: true,
      white: true,
    });
    expect(sku(offers, '943844').specs).toMatchObject({ memory: 'ddr4', ramCapacity: 8, ramModules: 1, ramSpeed: 3200, rgb: true });
  });
});

describe('SSD', () => {
  const offers = s1('ssd');

  it('descarta acessório (dissipador, case externo) e SSD de servidor', () => {
    expect(offers.map((o) => o.storeSku).sort()).toEqual(['1003584', '538416', '621162', '639880', '85198']);
  });

  it('NVMe com geração e leitura; SATA 2,5"; "HD SSD" é SSD', () => {
    expect(sku(offers, '621162').specs).toMatchObject({ ssdInterface: 'nvme', ssdForm: 'm2', ssdCapacity: 1000, ssdPcie: 4, ssdRead: 6000 });
    expect(sku(offers, '85198').specs).toMatchObject({ ssdInterface: 'sata', ssdForm: '2.5', ssdCapacity: 480 });
    expect(sku(offers, '639880').specs).toMatchObject({ ssdInterface: 'sata', ssdCapacity: 120 });
  });
});

describe('Cooler', () => {
  const offers = s1('cooler');

  it('descarta kit com processador (pela categoria da loja), ventoinha e tela de monitoramento', () => {
    expect(offers.map((o) => o.storeSku).sort()).toEqual(['1046796', '163383', '244585', '679304']);
  });

  it('tipo, radiador, encaixes e TDP', () => {
    expect(sku(offers, '679304').specs).toMatchObject({ coolerType: 'water', radiator: 360, coolerBrands: ['intel', 'amd'] });
    expect(sku(offers, '163383').specs).toMatchObject({ coolerType: 'air', coolerSockets: ['LGA115X'] });
    expect(sku(offers, '244585').specs).toMatchObject({ coolerTdp: 130 });
  });
});

describe('Gabinete', () => {
  const offers = s1('case');

  it('descarta tela de monitoramento da mesma categoria', () => {
    expect(offers.map((o) => o.storeSku)).not.toContain('957195');
    expect(offers).toHaveLength(5);
  });

  it('maior placa que cabe, torre, vidro e fans', () => {
    expect(sku(offers, '1056523').specs).toMatchObject({ caseFormFactor: 'matx', caseTower: 'mini', caseFans: 0 });
    expect(sku(offers, '657435').specs).toMatchObject({ caseFormFactor: 'atx', caseFans: 3, caseGlass: true });
    expect(sku(offers, '427914').specs).toMatchObject({ caseFormFactor: 'eatx', caseTower: 'full' });
    expect(sku(offers, '306269').specs.caseFormFactor).toBeUndefined();
  });
});
