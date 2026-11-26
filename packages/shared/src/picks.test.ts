import { describe, expect, it } from 'vitest';
import { prepareBudget } from './budget.ts';
import type { Build } from './compat.ts';
import { pickSlots, pickUpgrades } from './picks.ts';
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
  productKey: `p${n}`,
  collectedAt: '2026-11-24T10:00:00.000Z',
  ...extra,
});
const gpu = (gpuModel: string, price: number, extra: Partial<Offer> = {}, more: Specs = {}) => offer({ gpuMaker: gpuModel.startsWith('RX') ? 'amd' : 'nvidia', gpuModel, vram: 8, ...more }, price, extra);
const amd = (cpuLine: string, cpuModel: string, socket: 'AM4' | 'AM5', more: Specs, price: number) => offer({ cpuBrand: 'amd', cpuLine, cpuModel, socket, ...more }, price);
const NOW = Date.parse('2026-11-24T12:00:00.000Z');

/** PC com processador de sobra para a placa: 5800X3D numa B550, RX 6600 de 8 GB e fonte de 650 W gold. */
const gpuBound: Build = {
  cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '5800X3D', socket: 'AM4', tdp: 105 } },
  motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
  ram: { specs: { memory: 'ddr4', ramCapacity: 32, ramModules: 2, ramSpeed: 3200 } },
  gpu: { specs: { gpuMaker: 'amd', gpuModel: 'RX 6600', vram: 8 } },
  psu: { specs: { watts: 650, efficiency: 'gold' } },
};
const psus = [offer({ watts: 650, efficiency: 'bronze' }, 300), offer({ watts: 850, efficiency: 'gold' }, 600), offer({ watts: 1000, efficiency: 'gold' }, 800)];

describe('dicas do Identificar gargalo pelo motor do orçamento', () => {
  it('placa de vídeo: as mesmas opções do orçamento no upgrade, uma por modelo; o ganho é o do orçamento', () => {
    const gpus = [
      gpu('RTX 5060', 1900),
      gpu('RTX 5060', 1750, { store: 's2' }), // a mesma placa, mais barata em outra loja
      gpu('RX 9060 XT', 2100, {}, { vram: 16 }),
      gpu('RTX 5070', 3900, {}, { vram: 12 }),
      gpu('RTX 5070', 3000, { inStock: false }, { vram: 12 }), // sem estoque não conta
      gpu('RX 9060 XT', 1200, { marketplace: true }, { vram: 16 }), // marketplace não conta
      gpu('RTX 3050', 1100, {}, { vram: 6 }), // menos memória de vídeo que a atual: downgrade
    ];
    const req = { slot: 'gpu' as const, filters: {}, owned: gpuBound, res: '1080p' as const, hz: 144 };
    const picks = pickUpgrades(req, { gpu: gpus, psu: psus }, NOW);
    const models = picks.map((p) => p.offer.specs.gpuModel);
    expect(new Set(models).size).toBe(models.length);
    expect(models).not.toContain('RTX 3050');
    expect(picks.find((p) => p.offer.specs.gpuModel === 'RTX 5060')?.price).toBe(1750);
    // O mesmo número do Montar pelo orçamento para a mesma troca.
    const options = prepareBudget({ res: '1080p', hz: 144, mode: 'buyable', profile: 'games', owned: gpuBound }, { gpu: gpus, psu: psus }, NOW).options();
    for (const p of picks) {
      const same = options.filter((o) => o.parts.gpu?.offer.specs.gpuModel === p.offer.specs.gpuModel).sort((a, b) => a.total - b.total)[0]!;
      expect(p.gain).toBe(same.gain);
      expect(p.gain!).toBeGreaterThanOrEqual(0.1);
    }
    // As que resolvem o gargalo vêm antes, da mais barata.
    const resolving = picks.filter((p) => p.resolves);
    expect(picks.slice(0, resolving.length)).toEqual(resolving);
    expect(resolving.map((p) => p.total ?? p.price)).toEqual([...resolving.map((p) => p.total ?? p.price)].sort((a, b) => a - b));
  });

  it('placa de vídeo que a fonte atual não aguenta: a troca leva a fonte junto, no total', () => {
    const weak: Build = { ...gpuBound, psu: { specs: { watts: 450, efficiency: 'bronze' } } };
    const [pick] = pickUpgrades({ slot: 'gpu', filters: {}, owned: weak, res: '1440p' }, { gpu: [gpu('RTX 5080', 7000, {}, { vram: 16 })], psu: psus }, NOW);
    expect(pick?.extras?.map((x) => x.slot)).toEqual(['psu']);
    expect(pick!.total).toBe(pick!.price + pick!.extras![0]!.price);
  });

  it('processador do mesmo encaixe: fica a placa-mãe; a que pede BIOS nova vem marcada', () => {
    const cpuBound: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '2600', socket: 'AM4', tdp: 65 } },
      motherboard: { specs: { chipset: 'X470', socket: 'AM4', formFactor: 'atx', memory: 'ddr4' } },
      ram: { specs: { memory: 'ddr4', ramCapacity: 16, ramModules: 2, ramSpeed: 3200 } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 4070', vram: 12 } },
      psu: { specs: { watts: 650, efficiency: 'gold' } },
    };
    const cpus = [
      amd('Ryzen 5', '5600', 'AM4', { tdp: 65, cooler: true }, 700),
      amd('Ryzen 7', '5800X3D', 'AM4', { tdp: 105, cooler: false }, 1500),
      amd('Ryzen 7', '7800X3D', 'AM5', { tdp: 120, cooler: false }, 2200), // outro encaixe: fora desta dica
    ];
    const coolers = [offer({ coolerType: 'air', coolerSockets: ['AM4', 'AM5'], coolerTdp: 180 }, 100)];
    const req = { slot: 'cpu' as const, filters: { sockets: ['AM4' as const] }, owned: cpuBound, res: '1080p' as const };
    expect(pickSlots(req)).toEqual(['cpu', 'cooler', 'psu']);
    const picks = pickUpgrades(req, { cpu: cpus, cooler: coolers, psu: psus }, NOW);
    expect(picks.map((p) => p.offer.specs.cpuModel).sort()).toEqual(['5600', '5800X3D']);
    expect(picks.every((p) => !p.extras?.some((x) => x.slot === 'motherboard'))).toBe(true);
    const x3d = picks.find((p) => p.offer.specs.cpuModel === '5800X3D')!;
    expect(x3d.extras?.map((x) => x.slot)).toContain('cooler'); // sem cooler na caixa
    expect(x3d.needsBios).toBe(true); // X470 aceita Zen 3 depois de atualizar a BIOS
    // Numa placa de entrada (B450), o motor não põe processador de 105 W: a dica também não.
    const entry: Build = { ...cpuBound, motherboard: { specs: { chipset: 'B450', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } } };
    expect(pickUpgrades({ ...req, owned: entry }, { cpu: cpus, cooler: coolers, psu: psus }, NOW).map((p) => p.offer.specs.cpuModel)).toEqual(['5600']);
    // Plataforma nova: outro encaixe arrasta placa-mãe e memória.
    expect(pickSlots({ slot: 'cpu', filters: { sockets: ['AM5'] }, owned: cpuBound })).toEqual(['cpu', 'cooler', 'psu', 'motherboard', 'ram']);
  });

  it('memória, fonte e SSD: os produtos do motor (só da própria loja, preferência de marca), entre os que servem', () => {
    const named = offer({ watts: 650, efficiency: 'bronze' }, 330, { brand: 'Corsair' });
    const unnamed = offer({ watts: 650, efficiency: 'bronze' }, 300, { brand: 'Genérica' }); // mais barata, mas de fora da lista
    const white = offer({ watts: 700, efficiency: 'white' }, 150);
    const picks = pickUpgrades({ slot: 'psu', filters: {}, context: { certified: true, minWatts: 600 } }, { psu: [unnamed, named, white] }, NOW);
    expect(picks.map((p) => p.offer.brand)).toEqual(['Corsair', 'Genérica']);
    // Sem o PC da pessoa, processador e placa de vídeo não têm como comparar: nada.
    expect(pickUpgrades({ slot: 'gpu', filters: {} }, { gpu: [gpu('RTX 5060', 1900)] }, NOW)).toEqual([]);
  });
});
