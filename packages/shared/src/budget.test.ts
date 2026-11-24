import { describe, expect, it } from 'vitest';
import { planBudget, preferredBrand } from './budget.ts';
import type { Build, BuildSlot } from './compat.ts';
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

const amd = (cpuLine: string, cpuModel: string, socket: 'AM4' | 'AM5', more: Specs, price: number) => offer({ cpuBrand: 'amd', cpuLine, cpuModel, socket, ...more }, price);
const gpu = (gpuModel: string, price: number, more: Specs = {}) => offer({ gpuMaker: 'nvidia', gpuModel, ...more }, price);

/** Um catálogo pequeno com tudo que a montagem precisa (desempenho pela tabela de perf.ts). */
function catalog(): Record<BuildSlot, Offer[]> {
  return {
    cpu: [
      amd('Ryzen 5', '5600', 'AM4', { tdp: 65, cooler: true, igpu: false }, 700), // 100
      amd('Ryzen 5', '5600G', 'AM4', { tdp: 65, cooler: true, igpu: true }, 650), // 88, com vídeo integrado
      amd('Ryzen 7', '5800X3D', 'AM4', { tdp: 105, cooler: false, igpu: false }, 1500), // 132
      amd('Ryzen 7', '7800X3D', 'AM5', { tdp: 120, cooler: false, igpu: true }, 2200), // 165
    ],
    motherboard: [
      offer({ socket: 'AM4', chipset: 'A520', memory: 'ddr4', formFactor: 'matx' }, 350),
      offer({ socket: 'AM4', chipset: 'B550', memory: 'ddr4', formFactor: 'matx' }, 600),
      offer({ socket: 'AM5', chipset: 'B650', memory: 'ddr5', formFactor: 'matx' }, 900),
      offer({ socket: 'AM5', chipset: 'X670', memory: 'ddr5', formFactor: 'atx' }, 800), // ATX: não cabe no gabinete de quem tem Micro-ATX
    ],
    ram: [
      offer({ memory: 'ddr4', ramCapacity: 32, ramModules: 2, ramSpeed: 3200 }, 500),
      offer({ memory: 'ddr4', ramCapacity: 16, ramModules: 2, ramSpeed: 3200 }, 280),
      offer({ memory: 'ddr4', ramCapacity: 32, ramModules: 2, ramSpeed: 2666 }, 300), // lenta: fica de fora
      offer({ memory: 'ddr5', ramCapacity: 32, ramModules: 2, ramSpeed: 5600 }, 800),
    ],
    gpu: [gpu('RTX 3060', 1800), gpu('RTX 4070', 3500), gpu('RTX 5080', 7000, { gpuLength: 330 })],
    psu: [
      offer({ watts: 650, efficiency: 'white' }, 150), // sem certificação: fica de fora
      offer({ watts: 550, efficiency: 'bronze' }, 250),
      offer({ watts: 850, efficiency: 'gold' }, 600),
      offer({ watts: 1000, efficiency: 'gold' }, 800),
    ],
    ssd: [offer({ ssdInterface: 'nvme', ssdForm: 'm2', ssdCapacity: 1000 }, 350), offer({ ssdInterface: 'nvme', ssdForm: 'm2', ssdCapacity: 500 }, 220)],
    cooler: [
      offer({ coolerType: 'air', coolerSockets: ['AM4', 'AM5'], coolerTdp: 65 }, 30), // fraco: fica de fora
      offer({ coolerType: 'air', coolerSockets: ['AM4', 'AM5'], coolerTdp: 180 }, 100),
    ],
    case: [
      offer({ caseFormFactor: 'atx', caseFans: 0 }, 90), // sem ventoinha: fica de fora
      offer({ caseFormFactor: 'matx', caseFans: 1 }, 150),
      offer({ caseFormFactor: 'atx', caseFans: 3, caseMaxGpu: 300 }, 200),
      offer({ caseFormFactor: 'atx', caseFans: 3, caseMaxGpu: 400 }, 260),
    ],
  };
}

const models = (p: ReturnType<typeof planBudget>) => ({ cpu: p.parts.cpu?.offer.specs.cpuModel, gpu: p.parts.gpu?.offer.specs.gpuModel });

describe('montar pelo orçamento: PC inteiro', () => {
  it('não compra placa de vídeo que o processador não alimenta: com R$ 5 mil, Ryzen 5 5600 + RTX 3060', () => {
    const p = planBudget({ budget: 5000, res: '1080p' }, catalog());
    expect(p.status).toBe('ok');
    expect(models(p)).toEqual({ cpu: '5600', gpu: 'RTX 3060' });
    // Plataforma mais barata que aceita o processador, 32 GB em 2 pentes, SSD de 1 TB, fonte certificada; cooler da caixa.
    expect(p.parts.motherboard?.offer.specs.chipset).toBe('A520');
    expect(p.parts.ram?.price).toBe(500);
    expect(p.parts.ssd?.offer.specs.ssdCapacity).toBe(1000);
    expect(p.parts.psu?.offer.specs.efficiency).toBe('bronze');
    expect(p.parts.cooler).toBeUndefined();
    expect(p.parts.case?.price).toBe(150);
    expect(p.total).toBe(Object.values(p.parts).reduce((s, x) => s + x!.price, 0));
    expect(p.total).toBeLessThanOrEqual(5000);
    expect(p.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('com orçamento alto, o par mais forte: X3D (placa sem chipset de entrada, cooler à parte) e gabinete com ventilação onde a placa de vídeo cabe', () => {
    const p = planBudget({ budget: 20000, res: '1080p' }, catalog());
    expect(models(p)).toEqual({ cpu: '7800X3D', gpu: 'RTX 5080' });
    expect(p.parts.cooler?.offer.specs.coolerTdp).toBe(180);
    expect(p.parts.ram?.offer.specs.memory).toBe('ddr5');
    // RTX 5080 + X3D: uns 600 W no pico; com a folga da montagem pelo orçamento (1,5), a de 1000 W.
    expect(p.parts.psu?.offer.specs.watts).toBe(1000);
    // O gabinete de R$ 200 aceita placa de até 300 mm; a RTX 5080 tem 330: vai o seguinte.
    expect(p.parts.case?.price).toBe(260);
    expect(p.ratio).toBeGreaterThan(0.8);
  });

  it('até 3 opções: a melhor e mais duas, cada uma com outra placa de vídeo, mais barata ou mais forte que as anteriores', () => {
    const p = planBudget({ budget: 20000, res: '1080p' }, catalog());
    const options = [p, ...p.alternatives];
    expect(options.map((o) => o.parts.gpu?.offer.specs.gpuModel)).toEqual(['RTX 5080', 'RTX 4070', 'RTX 3060']);
    for (const o of options) {
      expect(o.total).toBeLessThanOrEqual(20000);
      expect(o.issues.filter((i) => i.level === 'error')).toEqual([]);
    }
    expect(p.alternatives[0]!.total).toBeLessThan(p.total);
    expect(p.alternatives[1]!.total).toBeLessThan(p.alternatives[0]!.total);
  });

  it('a última opção pode passar até 25% do orçamento quando rende pelo menos 10% a mais que a 1ª; as outras ficam dentro', () => {
    let seen = 0;
    for (let budget = 3000; budget <= 20000; budget += 250) {
      const p = planBudget({ budget, res: '1080p' }, catalog());
      const options = [p, ...p.alternatives];
      options.slice(0, -1).forEach((o) => expect(o.total).toBeLessThanOrEqual(budget));
      const last = options.at(-1)!;
      if (!last.stretch) continue;
      seen++;
      expect(options.length).toBeGreaterThan(1);
      expect(last.total).toBeGreaterThan(budget);
      expect(last.total).toBeLessThanOrEqual(budget * 1.25);
      expect(last.fps).toBeGreaterThanOrEqual(p.fps * 1.1);
    }
    expect(seen).toBeGreaterThan(0);
    // Com R$ 20 mil já sai o par mais forte do catálogo: nada acima do valor rende mais.
    expect(planBudget({ budget: 20000, res: '1080p' }, catalog()).alternatives.some((o) => o.stretch)).toBe(false);
  });

  it('opção que custa o mesmo ou mais e não rende mais nem tem placa mais forte não aparece', () => {
    // Só RTX 3060 de duas marcas: a mais cara não é alternativa (mesma placa, mesmo rendimento, mais dinheiro).
    const base = catalog();
    const p = planBudget({ budget: 5000, res: '1080p' }, { ...base, gpu: [gpu('RTX 3060', 1800), gpu('RTX 3060', 1900)] });
    expect([p, ...p.alternatives].every((o) => o.parts.gpu?.price !== 1900)).toBe(true);
  });

  it('placa de vídeo abaixo de uma GTX 1050 Ti (GT 710, GT 730) não é opção: rende menos que o vídeo integrado', () => {
    const base = catalog();
    const p = planBudget({ budget: 3000, res: '1080p' }, { ...base, gpu: [...base.gpu, gpu('GT 730', 300), gpu('GT 710', 250)] });
    expect([p, ...p.alternatives].map((o) => o.parts.gpu?.offer.specs.gpuModel).filter(Boolean)).toEqual([]);
  });

  it('memória: 2 pentes avulsos iguais quando saem bem mais baratos que o kit; o kit ganha se a diferença for pequena', () => {
    const base = catalog();
    const single = (price: number) => offer({ memory: 'ddr4', ramCapacity: 16, ramModules: 1, ramSpeed: 3200 }, price);
    const pick = (price: number) => planBudget({ budget: 5000, res: '1080p' }, { ...base, ram: [...base.ram, single(150)].map((o) => (o.specs.ramModules === 1 ? single(price) : o)) });
    // Kit de 32 GB a 500; 2 pentes de 16 a 2 x 150 = 300: vão os 2 avulsos, com a quantidade e o preço dos dois.
    const p = pick(150);
    expect(p.parts.ram).toMatchObject({ qty: 2, price: 300, offer: { specs: { ramCapacity: 16 } } });
    expect(p.notes).toContain('ram-pair');
    expect(p.total).toBe(Object.values(p.parts).reduce((sum, x) => sum + x!.price, 0));
    // 2 x 245 = 490 contra 500 do kit: menos de 5% de diferença, fica o kit.
    expect(pick(245).parts.ram).toMatchObject({ price: 500 });
    expect(pick(245).parts.ram?.qty).toBeUndefined();
  });

  it('fonte: com folga para picos e, no PC que puxa 400 W ou mais, Gold antes de Bronze um pouco mais barata', () => {
    const base = catalog();
    const psus = [offer({ watts: 1000, efficiency: 'bronze' }, 750), offer({ watts: 1000, efficiency: 'gold' }, 800)];
    const p = planBudget({ budget: 20000, res: '1080p' }, { ...base, psu: psus });
    expect(p.parts.psu?.offer.specs).toMatchObject({ watts: 1000, efficiency: 'gold' });
  });

  it('orçamento que não fecha com placa de vídeo: processador com vídeo integrado', () => {
    const p = planBudget({ budget: 3000, res: '1080p' }, catalog());
    expect(p.status).toBe('ok');
    expect(models(p)).toEqual({ cpu: '5600G', gpu: undefined });
    expect(p.notes).toContain('igpu');
  });

  it('orçamento que não fecha nada: diz o mínimo', () => {
    const p = planBudget({ budget: 1000, res: '1080p' }, catalog());
    expect(p.status).toBe('too-low');
    expect(p.parts).toEqual({});
    expect(p.minTotal).toBeGreaterThan(1000);
    expect(planBudget({ budget: p.minTotal!, res: '1080p' }, catalog()).status).toBe('ok');
  });

  it('sem ofertas: no-data', () => {
    expect(planBudget({ budget: 5000, res: '1080p' }, {}).status).toBe('no-data');
  });
});

describe('montar pelo orçamento: marcas com prioridade', () => {
  it('marca da lista pela marca do anúncio ou, sem ela, pelo título', () => {
    expect(preferredBrand('psu', { brand: 'Cooler Master', title: 'Fonte MWE 650' })).toBe(true);
    expect(preferredBrand('psu', { brand: 'GameMax', title: 'Fonte GP650' })).toBe(true);
    expect(preferredBrand('psu', { brand: 'BRX', title: 'Fonte BRX Rainbow 650W' })).toBe(false);
    expect(preferredBrand('psu', { title: 'Fonte Cooler Master MWE Bronze V3, 650W' })).toBe(true);
    expect(preferredBrand('ram', { brand: 'Team Group', title: 'Memória T-Force Delta' })).toBe(true);
    expect(preferredBrand('ram', { title: 'Memória G.Skill Ripjaws V, 32GB' })).toBe(true);
    // Sem lista (processador, SSD, cooler, gabinete): qualquer marca.
    expect(preferredBrand('ssd', { brand: 'Lexar', title: 'SSD Lexar' })).toBe(true);
  });

  it('a fonte de marca da lista ganha da desconhecida um pouco mais barata; a desconhecida só entra bem mais barata', () => {
    const base = catalog();
    const psus = (other: number) => [offer({ watts: 650, efficiency: 'bronze' }, other, { brand: 'Genérica' }), offer({ watts: 650, efficiency: 'bronze' }, 400, { brand: 'Corsair' })];
    const pick = (other: number) => planBudget({ budget: 6000, res: '1080p' }, { ...base, psu: psus(other) }).parts.psu;
    // 400 contra 250: a desconhecida conta como 425 na escolha.
    expect(pick(250)?.offer.brand).toBe('Corsair');
    // 400 contra 200: conta como 340, fica a mais barata. O preço mostrado é o real.
    expect(pick(200)).toMatchObject({ price: 200, offer: { brand: 'Genérica' } });
  });
});

describe('montar pelo orçamento: upgrade', () => {
  // Ryzen 5 3600 (83) numa B450 Micro-ATX, 16 GB DDR4, GTX 1660 Super (63), fonte de 550 W bronze.
  const owned: Build = {
    cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '3600', socket: 'AM4', tdp: 65, igpu: false }, current: true },
    motherboard: { specs: { socket: 'AM4', chipset: 'B450', memory: 'ddr4', formFactor: 'matx' }, current: true },
    ram: { specs: { memory: 'ddr4', ramCapacity: 16, ramModules: 2, ramSpeed: 3200 }, current: true },
    gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super' }, current: true },
    psu: { specs: { watts: 550, efficiency: 'bronze' }, current: true },
  };

  it('troca o par que rende: Ryzen 5 5600 na placa atual (com BIOS) + RTX 3060, mantendo a fonte', () => {
    const p = planBudget({ budget: 2600, res: '1080p', owned }, catalog());
    expect(p.status).toBe('ok');
    expect(models(p)).toEqual({ cpu: '5600', gpu: 'RTX 3060' });
    expect(Object.keys(p.parts).sort()).toEqual(['cpu', 'gpu']);
    expect(p.notes).toContain('bios');
    expect(p.gain).toBeGreaterThan(0.5);
  });

  it('nunca placa de vídeo com menos memória de vídeo que a atual: com a 1660 Super de 12 GB (hipotética), a RTX 3060 de 8 GB não entra', () => {
    const big: Build = { ...owned, gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super', vram: 12 }, current: true } };
    const base = catalog();
    const gpus = [gpu('RTX 3060', 1800, { vram: 8 }), gpu('RTX 3060', 2100, { vram: 12 }), gpu('RTX 4070', 3500)];
    const p = planBudget({ budget: 3200, res: '1080p', owned: big }, { ...base, gpu: gpus });
    expect(p.parts.gpu?.offer.specs).toMatchObject({ gpuModel: 'RTX 3060', vram: 12 });
    // A RTX 4070 sem a memória informada também fica de fora: com R$ 12 mil, ainda a 3060 de 12 GB.
    expect(planBudget({ budget: 12000, res: '1080p', owned: big }, { ...base, gpu: gpus }).parts.gpu?.offer.specs.vram).toBe(12);
  });

  it('sobrando dinheiro, sobe a memória para 32 GB do mesmo tipo', () => {
    const p = planBudget({ budget: 3000, res: '1080p', owned }, catalog());
    expect(p.parts.ram?.offer.specs).toMatchObject({ memory: 'ddr4', ramCapacity: 32 });
    expect(p.notes).toContain('ram-32');
  });

  it('só a placa de vídeo não resolve (o processador segura): abaixo do primeiro upgrade que vale, diz quanto custa', () => {
    const p = planBudget({ budget: 1900, res: '1080p', owned }, catalog());
    expect(p.status).toBe('too-low');
    // O primeiro que rende 10%: Ryzen 5 5600G (R$ 650) + RTX 3060 (R$ 1.800).
    expect(p.minTotal).toBe(2450);
  });

  it('plataforma nova cabe no gabinete atual (placa até Micro-ATX) e compra a memória do tipo dela', () => {
    const p = planBudget({ budget: 12000, res: '1080p', owned }, catalog());
    expect(models(p)).toEqual({ cpu: '7800X3D', gpu: 'RTX 5080' });
    expect(p.parts.motherboard?.offer.specs).toMatchObject({ chipset: 'B650', formFactor: 'matx' });
    expect(p.parts.ram?.offer.specs.memory).toBe('ddr5');
    // A fonte de 550 W não aguenta a RTX 5080: entra uma nova.
    // RTX 5080 + X3D: uns 600 W no pico; com a folga da montagem pelo orçamento (1,5), a de 1000 W.
    expect(p.parts.psu?.offer.specs.watts).toBe(1000);
    expect(p.parts.case).toBeUndefined();
  });

  it('sem a fonte informada: monta e avisa para conferir', () => {
    const { psu: _, ...noPsu } = owned;
    const p = planBudget({ budget: 2600, res: '1080p', owned: noPsu }, catalog());
    expect(p.parts.psu).toBeUndefined();
    expect(p.notes).toContain('psu-unknown');
  });

  it('PC já no topo do que se vende: no-gain', () => {
    const top: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '7800X3D', socket: 'AM5' }, current: true },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 5080' }, current: true },
    };
    expect(planBudget({ budget: 50000, res: '1080p', owned: top }, catalog()).status).toBe('no-gain');
  });
});
