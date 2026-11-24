import { describe, expect, it } from 'vitest';
import { pickUpgrades } from './picks.ts';
import type { Offer, Specs } from './types.ts';

let n = 0;
const offer = (specs: Specs, priceCash: number, extra: Partial<Offer> = {}): Offer => ({
  store: 's1',
  storeSku: String(++n),
  title: `Peça ${n}`,
  url: `https://www.s1.example/produto/${n}`,
  priceCash,
  inStock: true,
  seller: 'S1',
  marketplace: false,
  openbox: false,
  specs,
  modelKey: `m${n}`,
  collectedAt: '2026-11-21T10:00:00.000Z',
  ...extra,
});
const gpu = (gpuModel: string, price: number, extra: Partial<Offer> = {}) => offer({ gpuMaker: gpuModel.startsWith('RX') ? 'amd' : 'nvidia', gpuModel }, price, extra);

describe('ranking de upgrade: placa de vídeo', () => {
  // Atual: RTX 3060 (100). RTX 4060 = 110 (só +10%: fica de fora), RTX 5060 = 128, RX 9060 XT = 145, RTX 5070 = 195.
  const offers = [
    gpu('RTX 4060', 1500),
    gpu('RTX 5060', 1900),
    gpu('RTX 5060', 1750, { store: 's2' }), // mesma placa mais barata em outra loja
    gpu('RX 9060 XT', 2100),
    gpu('RTX 5070', 3900),
    gpu('RTX 5070', 3000, { inStock: false }), // sem estoque não conta
    gpu('RX 9060 XT', 1200, { marketplace: true }), // marketplace não conta
  ];
  const req = { slot: 'gpu' as const, filters: { gpuModels: ['RTX 4060', 'RTX 5060', 'RX 9060 XT', 'RTX 5070'] }, context: { current: 100 } };

  it('uma por modelo, a mais barata que dá para comprar, ordenadas por desempenho ganho por real', () => {
    const picks = pickUpgrades(req, offers);
    expect(picks.map((p) => [p.offer.specs.gpuModel, p.price])).toEqual([
      ['RTX 5070', 3900], // 95 pontos / 3900 = 0,0244
      ['RX 9060 XT', 2100], // 45 / 2100 = 0,0214
      ['RTX 5060', 1750], // 28 / 1750 = 0,0160
    ]);
    expect(picks[1]!.gain).toBeCloseTo(0.45);
  });

  it('fonte atual: só as placas que cabem nela', () => {
    const picks = pickUpgrades({ ...req, context: { current: 100, maxGpuPower: 200 } }, offers);
    expect(picks.map((p) => p.offer.specs.gpuModel)).toEqual(['RX 9060 XT', 'RTX 5060']); // RTX 5070 pede 250 W
  });

  it('nunca menos memória de vídeo que a placa atual (seria downgrade): a variante de 16 GB entra, a de 8 GB e a sem informação não', () => {
    const list = [gpu('RTX 5060 Ti', 2500, { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 5060 Ti', vram: 8 } }), gpu('RTX 5060 Ti', 3000, { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 5060 Ti', vram: 16 } }), gpu('RTX 5070', 3900)];
    const picks = pickUpgrades({ slot: 'gpu', filters: {}, context: { current: 100, minVram: 12 } }, list);
    expect(picks.map((p) => [p.offer.specs.gpuModel, p.offer.specs.vram])).toEqual([['RTX 5060 Ti', 16]]);
  });

  it('no máximo 3', () => {
    const many = ['RTX 5060', 'RTX 5060 Ti', 'RTX 5070', 'RTX 5070 Ti', 'RTX 5080', 'RX 9060 XT', 'RX 9070'].map((m, i) => gpu(m, 2000 + i * 500));
    expect(pickUpgrades({ slot: 'gpu', filters: {}, context: { current: 100 } }, many)).toHaveLength(3);
  });
});

describe('ranking de upgrade: processador', () => {
  it('só os que o chipset aceita e que sobem pelo menos 15%', () => {
    const am4 = (cpuModel: string, cpuLine: string, price: number) => offer({ cpuBrand: 'amd', cpuLine, cpuModel, socket: 'AM4' }, price);
    const offers = [am4('5700X3D', 'Ryzen 7', 1100), am4('5600', 'Ryzen 5', 600), am4('3600', 'Ryzen 5', 400)];
    // Atual: Ryzen 5 3600 (zen2, 83). Ryzen 5 5600 = 100 (+20%), 5700X3D = 125 (+51%).
    const picks = pickUpgrades({ slot: 'cpu', filters: { sockets: ['AM4'] }, context: { current: 83, chipset: 'B450' } }, offers);
    expect(picks.map((p) => p.offer.specs.cpuModel)).toEqual(['5700X3D', '5600']); // 42 pontos / 1100 = 0,038 > 17 / 600 = 0,028
    // B450 aceita Ryzen 5000 depois de atualizar a BIOS: continua, com o aviso.
    expect(picks.every((p) => p.needsBios)).toBe(true);
    expect(pickUpgrades({ slot: 'cpu', filters: { sockets: ['AM4'] }, context: { current: 83, chipset: 'B550' } }, offers).some((p) => p.needsBios)).toBe(false);
  });

  it('chipset que não aceita a geração: fica de fora', () => {
    // Atual: Core i5-10400 (80). Core i7-11700 = 94 (+17%), mas H410 não aceita a 11ª geração.
    const offers = [offer({ cpuBrand: 'intel', cpuLine: 'Core i7', cpuModel: '11700', cpuGen: '11ª', socket: 'LGA1200' }, 1500)];
    const req = (chipset: string) => ({ slot: 'cpu' as const, filters: { sockets: ['LGA1200' as const] }, context: { current: 80, chipset } });
    expect(pickUpgrades(req('H410'), offers)).toEqual([]);
    expect(pickUpgrades(req('B560'), offers)).toHaveLength(1);
  });
});

describe('melhores preços: memória e fonte', () => {
  it('memória: as mais baratas que batem com o filtro, uma por produto', () => {
    const ram = (ramCapacity: number, ramModules: number, price: number, modelKey?: string) => offer({ memory: 'ddr4', ramCapacity, ramModules }, price, modelKey ? { modelKey } : {});
    const offers = [ram(16, 2, 350, 'kit-a'), ram(16, 2, 320, 'kit-a'), ram(16, 1, 250), ram(32, 2, 600), ram(16, 2, 400)];
    const picks = pickUpgrades({ slot: 'ram', filters: { memory: ['ddr4'], ramModules: [2], ramCapacity: [16, 32] } }, offers);
    expect(picks.map((p) => p.price)).toEqual([320, 400, 600]);
    expect(picks[0]!.gain).toBeUndefined();
  });

  it('fonte: potência mínima e só certificada', () => {
    const psu = (watts: number, efficiency: Specs['efficiency'], price: number) => offer({ watts, efficiency }, price);
    const offers = [psu(500, 'white', 180), psu(650, 'bronze', 330), psu(750, 'gold', 520), psu(550, 'bronze', 260)];
    const picks = pickUpgrades({ slot: 'psu', filters: {}, context: { minWatts: 600, certified: true } }, offers);
    expect(picks.map((p) => p.offer.specs.watts)).toEqual([650, 750]);
  });
});
