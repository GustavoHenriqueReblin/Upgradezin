import { describe, expect, it } from 'vitest';
import { normalizeListing } from './categorize.ts';
import { cpuSheetFor, cpuSheetScore } from './cpuScore.ts';
import type { PcProfile } from './cpuz.ts';
import { budgetCpuScore, cpuScore } from './perf.ts';
import { pickUpgrades } from './picks.ts';
import type { Offer, Specs } from './types.ts';
import { analyzePc } from './upgrade.ts';

describe('nota do processador pela ficha técnica', () => {
  it('usa a referência no upgrade e conserva as estimativas para modelos sem calibração', () => {
    const cpu = (model: string) => normalizeListing('cpu', `Processador AMD Ryzen 7 ${model}, AM5`).specs;
    expect(budgetCpuScore(cpu('9800X3D'), undefined, 188)).toBe(175);
    expect(budgetCpuScore(cpu('7800X3D'))).toBe(159);
    const sheet = { architecture: 'Zen 4', boostGhz: 5.4, l3Mb: 32, cores: 8 };
    expect(budgetCpuScore(cpu('7700X'), sheet)).toBe(cpuSheetScore(sheet));
    expect(budgetCpuScore(cpu('7700X'), undefined, 137)).toBe(137);
  });

  it('calibrada no Ryzen 5 5600 (= 100); X3D, geração nova e Intel na escala da tabela', () => {
    expect(cpuSheetScore({ architecture: 'Zen 3', boostGhz: 4.4, l3Mb: 32, cores: 6, threads: 12 })).toBe(100);
    expect(cpuSheetScore({ architecture: 'Zen 3', boostGhz: 4.5, l3Mb: 96, cores: 8, threads: 16 })).toBe(136); // 5800X3D (tabela 132)
    expect(cpuSheetScore({ architecture: 'Zen 4', boostGhz: 5.1, l3Mb: 32, cores: 6, threads: 12 })).toBe(131); // 7600 (tabela 125)
    expect(cpuSheetScore({ architecture: 'Alder Lake', boostGhz: 4.4, l3Mb: 18, cores: 6, threads: 12 })).toBe(105); // 12400F (tabela 105)
    expect(cpuSheetScore({ architecture: 'Comet Lake', boostGhz: 4.3, l3Mb: 12, cores: 6, threads: 12 })).toBe(76); // 10400 (tabela 80)
    // Codinome do CPU-Z vale como arquitetura; APU com cache pequeno rende menos.
    expect(cpuSheetScore({ architecture: 'Vermeer', boostGhz: 4.4, l3Mb: 32, cores: 6 })).toBe(100);
    expect(cpuSheetScore({ architecture: 'Zen 3', boostGhz: 4.4, l3Mb: 16, cores: 6 })).toBe(90); // 5600G (tabela 88)
    // Quatro núcleos sem threads extras perdem mais que com.
    expect(cpuSheetScore({ architecture: 'Coffee Lake', boostGhz: 4.2, cores: 4, threads: 4 })).toBeLessThan(cpuSheetScore({ architecture: 'Coffee Lake', boostGhz: 4.2, cores: 4, threads: 8 })!);
  });

  it('sem arquitetura conhecida ou sem boost: sem nota pela ficha, e a tabela por linha decide', () => {
    expect(cpuSheetScore({ architecture: 'Zen 3', l3Mb: 32 })).toBeUndefined();
    expect(cpuSheetScore({ architecture: 'Bulldozer', boostGhz: 4 })).toBeUndefined();
    const specs = normalizeListing('cpu', 'Processador AMD Ryzen 5 5600, AM4').specs;
    expect(cpuScore(specs, { architecture: 'Zen 3' })).toBe(100); // tabela
    expect(cpuScore(specs, { architecture: 'Zen 3', boostGhz: 4.6, l3Mb: 32, cores: 6 })).toBe(105); // ficha (5600X)
  });

  it('a ficha do modelo no catálogo: a do anúncio com mais campos da nota', () => {
    const o = (sheet: Offer['sheet']) => ({ specs: { cpuModel: '5800X3D' }, sheet }) as unknown as Offer;
    const offers = [o({ architecture: 'Zen 3' }), o({ architecture: 'Zen 3', boostGhz: 4.5, l3Mb: 96 }), o({ boostGhz: 4.4 }), { specs: { cpuModel: '5600' }, sheet: { boostGhz: 4.4 } } as unknown as Offer];
    expect(cpuSheetFor(offers, '5800x3d')).toEqual({ architecture: 'Zen 3', boostGhz: 4.5, l3Mb: 96 });
    expect(cpuSheetFor(offers, '7600')).toBeUndefined();
  });
});

describe('gargalo e sugestões pela ficha', () => {
  const part = (category: 'cpu' | 'gpu' | 'motherboard', title: string) => ({ title, specs: normalizeListing(category, title).specs });
  const pc = (extra: Partial<PcProfile>): PcProfile => ({ source: 'cpu-z', drives: [], monitors: [{ width: 1920, height: 1080, maxHz: 60 }], ...extra });

  it('o processador da pessoa pela ficha do catálogo; sem ela, pela tabela (e a tela diz qual)', () => {
    const p = pc({ cpu: part('cpu', 'Processador AMD Ryzen 5 2600, AM4'), motherboard: part('motherboard', 'Placa-Mãe ASUS B450M, AM4, DDR4'), gpu: part('gpu', 'Placa de Vídeo RTX 4070 12GB') });
    expect(analyzePc(p).balance).toMatchObject({ verdict: 'cpu', cpu: 68, cpuFrom: 'table' });
    const withSheet = analyzePc(p, { cpuSheet: { architecture: 'Zen+', boostGhz: 3.9, l3Mb: 16, cores: 6, threads: 12 } });
    expect(withSheet.balance).toMatchObject({ verdict: 'cpu', cpuFrom: 'sheet' });
    expect(withSheet.balance.cpu).toBe(62); // 0,78 × 3,9/4,4 × 0,9 (cache de 16 MB)
  });

  let n = 0;
  const offer = (specs: Specs, price: number, extra: Partial<Offer> = {}): Offer =>
    ({ store: 's1', storeSku: String(++n), title: `Peça ${n}`, url: '', priceCash: price, inStock: true, specs, modelKey: `m${n}`, collectedAt: '', ...extra }) as Offer;

  it('processador: as que resolvem o gargalo primeiro, da mais barata; a nota vem da ficha de cada oferta', () => {
    const cpu = (cpuModel: string, price: number, sheet: Offer['sheet']) => offer({ socket: 'AM4', cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel, cpuGen: 'Ryzen 5000' }, price, { sheet });
    const offers = [
      cpu('5600', 600, { architecture: 'Zen 3', boostGhz: 4.4, l3Mb: 32, cores: 6 }), // 100: não resolve (meta 120)
      cpu('5700X3D', 1300, { architecture: 'Zen 3', boostGhz: 4.1, l3Mb: 96, cores: 8 }), // 124: resolve
      cpu('5800X3D', 1700, { architecture: 'Zen 3', boostGhz: 4.5, l3Mb: 96, cores: 8 }), // 136: resolve
      cpu('5500X3D', 1100, { architecture: 'Zen 3', boostGhz: 4.0, l3Mb: 96, cores: 6 }), // 116: resolve (90% da meta)
    ];
    const picks = pickUpgrades({ slot: 'cpu', filters: { sockets: ['AM4'] }, context: { current: 68, target: 120, chipset: 'B550' } }, offers);
    expect(picks.map((p) => [p.offer.specs.cpuModel, p.resolves ?? false])).toEqual([
      ['5500X3D', true],
      ['5700X3D', true],
      ['5800X3D', true],
      // O 5600 (não resolve) seria o 4º: as dicas mostram 3.
    ]);
    expect(picks[0]!.perf).toBe(116);
  });

  it('placa de vídeo: ofertas x8 concorrem com x16 e o limite elétrico continua valendo', () => {
    const gpu = (gpuModel: string, price: number, sheet?: Offer['sheet']) => offer({ gpuMaker: 'nvidia', gpuModel }, price, { ...(sheet && { sheet }) });
    const offers = [gpu('RTX 5060', 1800, { pcie: '5.0 x8' }), gpu('RTX 4070', 3500, { pcie: '4.0 x16' }), gpu('RTX 5060 Ti', 2400, { pcie: '5.0 x8' })];
    const picks = pickUpgrades({ slot: 'gpu', filters: {}, context: { current: 100, target: 150 } }, offers);
    expect(picks).toHaveLength(3);
    expect(picks[0]?.offer.specs.gpuModel).toMatch(/^RTX 5060/);
    // Fonte aguenta até 200 W: a 4070 (200 W) entra, a 5060 Ti (180) também; uma placa fora da tabela de consumo usa a ficha.
    const odd = [gpu('RTX 4070', 3500, { tdpW: 250 })];
    expect(pickUpgrades({ slot: 'gpu', filters: {}, context: { current: 100, maxGpuPower: 220 } }, odd)).toHaveLength(1); // a tabela (200 W) vale primeiro
  });
});
