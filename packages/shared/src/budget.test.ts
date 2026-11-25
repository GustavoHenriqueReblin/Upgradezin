import { describe, expect, it } from 'vitest';
import { planBudget, prepareBudget, preferredBrand } from './budget.ts';
import type { Build, BuildSlot } from './compat.ts';
import { budgetGamingScore, budgetGpuScore, budgetIgpuScore } from './perf.ts';
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

it('considera uma RTX 5060 Ti no upgrade em B450 e mantém o aviso de PCIe', () => {
  const owned: Build = {
    cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '5800X3D', socket: 'AM4' } },
    motherboard: { specs: { chipset: 'B450', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
    gpu: { specs: { gpuModel: 'RX 6600', vram: 8 }, current: true },
    psu: { specs: { watts: 650, efficiency: 'gold' } },
  };
  const result = planBudget({ owned, budget: 2500, res: '1080p', hz: 144 }, {
    gpu: [gpu('RTX 5060 Ti', 2400, { vram: 16, gpuPcieLanes: 8 }), gpu('RTX 4070', 3500, { vram: 12, gpuPcieLanes: 16 })],
  });
  expect(result.status).toBe('ok');
  expect(result.parts.gpu?.offer.specs.gpuModel).toBe('RTX 5060 Ti');
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'gpu-pcie-lanes', level: 'info' }));
});

const models = (p: ReturnType<typeof planBudget>) => ({ cpu: p.parts.cpu?.offer.specs.cpuModel, gpu: p.parts.gpu?.offer.specs.gpuModel });

describe('montar pelo orçamento: PC inteiro', () => {
  it('distingue trabalho acelerado de CPU e exigência de marca de preferência', () => {
    const base = catalog();
    const request = { budget: 10000, res: '1440p', profile: 'productivity' } as const;
    const accelerated = planBudget({ ...request, workload: 'gpu' }, base);
    expect(accelerated.status).toBe('ok');
    expect(accelerated.parts.gpu).toBeDefined();
    expect(accelerated.objective).not.toBe(accelerated.work);
    expect(planBudget({ ...request, preferences: { gpu: 'amd' } }, base).status).toBe('ok');
    expect(planBudget({ ...request, requiredBrands: { gpu: 'amd' } }, base).status).toBe('no-data');
  });

  it('aplica a referência do modelo mesmo com a ficha incompleta ou divergente', () => {
    const offers = catalog();
    offers.cpu = offers.cpu.filter((o) => o.specs.cpuModel === '5800X3D');
    const request = { budget: 20000, res: '1080p' } as const;
    const withoutSheet = planBudget(request, offers);
    offers.cpu[0]!.sheet = { architecture: 'Zen 3', boostGhz: 4.5, l3Mb: 96, cores: 8 };
    const withSheet = planBudget(request, offers);
    expect(withoutSheet).toMatchObject({ status: 'ok', cpu: 128 });
    expect(withSheet).toMatchObject({ status: 'ok', cpu: withoutSheet.cpu, fps: withoutSheet.fps, total: withoutSheet.total });
  });

  it('não compra placa de vídeo que o processador não alimenta: com R$ 5 mil, Ryzen 5 5600 + RTX 3060', () => {
    const p = planBudget({ budget: 5000, res: '1080p' }, catalog());
    expect(p.status).toBe('ok');
    expect(models(p)).toEqual({ cpu: '5600', gpu: 'RTX 3060' });
    // A combinação comporta as duas ampliações pelos preços da bancada.
    expect(p.parts.motherboard?.offer.specs.chipset).toBe('A520');
    expect(p.parts.ram?.offer.specs.ramCapacity).toBe(32);
    expect(p.parts.ssd?.offer.specs.ssdCapacity).toBe(1000);
    expect(p.notes).toEqual(expect.arrayContaining(['capacity-value', 'box-cooler']));
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
    expect(p.parts.psu?.offer.specs.watts).toBe(850);
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
    expect([p, ...p.alternatives].every((o) => !['GT 730', 'GT 710'].includes(o.parts.gpu?.offer.specs.gpuModel ?? ''))).toBe(true);
  });

  it('memória: 2 pentes avulsos iguais quando saem bem mais baratos que o kit; o kit ganha se a diferença for pequena', () => {
    const base = catalog();
    const single = (price: number) => offer({ memory: 'ddr4', ramCapacity: 16, ramModules: 1, ramSpeed: 3200 }, price);
    const pick = (price: number) => planBudget({ budget: 5000, res: '1080p' }, { ...base, ram: [...base.ram.filter((o) => o.specs.ramCapacity === 32), single(price)] });
    // Kit de 32 GB a 500; 2 pentes de 16 a 2 x 150 = 300: vão os 2 avulsos, com a quantidade e o preço dos dois.
    const p = pick(150);
    expect(p.parts.ram).toMatchObject({ qty: 2, price: 300, offer: { specs: { ramCapacity: 16 } } });
    expect(p.notes).toContain('ram-pair');
    expect(p.total).toBe(Object.values(p.parts).reduce((sum, x) => sum + x!.price, 0));
    // 2 x 245 = 490 contra 500 do kit: menos de 5% de diferença, fica o kit.
    expect(pick(245).parts.ram).toMatchObject({ price: 500 });
    expect(pick(245).parts.ram?.qty).toBeUndefined();
  });

  it('fonte: prefere evidência de padrão elétrico sem premiar o selo de eficiência', () => {
    const base = catalog();
    const psus = [offer({ watts: 1000, efficiency: 'gold' }, 750), offer({ watts: 1000, efficiency: 'bronze', atx: '3.1' }, 790)];
    const p = planBudget({ budget: 20000, res: '1080p' }, { ...base, psu: psus });
    expect(p.parts.psu?.offer.specs).toMatchObject({ watts: 1000, efficiency: 'bronze', atx: '3.1' });
  });

  it('fontes com conector incompatível saem e a ficha ATX 3 permite dimensionar pela carga', () => {
    const base = catalog();
    const psu = (watts: number, price: number, pcie16: number) => offer({ watts, efficiency: 'gold' }, price, { sheet: { standard: 'ATX 3.1', pcie16 } });
    base.gpu[2]!.specs.gpu16Pin = true;
    const p = planBudget({ budget: 20000, res: '1080p' }, { ...base, psu: [psu(850, 300, 0), { ...psu(1000, 350, 1), sheet: { standard: 'ATX 3.1', pcie16: 1, eps: 0 } }, psu(750, 500, 1), psu(1000, 800, 1)] });
    expect(p.parts.psu?.offer).toMatchObject({ specs: { watts: 750 }, sheet: { pcie16: 1 } });
  });

  it('combina CPU e GPU sem degrau em 120 Hz e sem zerar CPUs lentas', () => {
    expect(budgetGamingScore(50, 100, '1080p')).toBeGreaterThan(0);
    expect(budgetGamingScore(100, 100, '1080p')).toBe(97.5);
    expect(budgetGamingScore(160, 240, '4k')).toBeGreaterThanOrEqual(budgetGamingScore(160, 240, '1080p'));
    expect(budgetGamingScore(100, 130, '1080p', 119) - budgetGamingScore(100, 130, '1080p', 120)).toBeLessThan(1);
    expect(budgetGamingScore(0, 100, '1080p')).toBe(0);
  });

  it('descarta configurações com erro conhecido mesmo quando a combinação cabe no orçamento', () => {
    const base = catalog();
    base.motherboard.forEach((o) => { o.specs.memoryMaxGb = 8; });
    expect(planBudget({ budget: 20000, res: '1080p' }, base).status).toBe('no-data');
  });

  it('orçamento que não fecha com placa de vídeo: processador com vídeo integrado', () => {
    const p = planBudget({ budget: 3000, res: '1080p' }, catalog());
    expect(p.status).toBe('ok');
    expect(models(p)).toEqual({ cpu: '5600G', gpu: undefined });
    expect(p.notes).toContain('igpu');
  });

  it('monta com iGPU sem oferta de placa de vídeo e preserva um índice positivo com CPU de nota baixa', () => {
    const base = catalog();
    const weak = amd('Ryzen 5', '5600G', 'AM4', { igpu: true, cooler: true }, 300);
    weak.sheet = { architecture: 'Zen 3', boostGhz: 2 };
    const p = planBudget({ budget: 3000, res: '1080p' }, { ...base, cpu: [weak], gpu: [] });
    expect(p).toMatchObject({ status: 'ok', fps: 21 });
    const vega = budgetIgpuScore({ igpu: true, cpuBrand: 'amd', cpuModel: '5700G' })!;
    const uhd730 = budgetIgpuScore({ igpu: true, cpuBrand: 'intel', cpuModel: '11400' }, { igpu: 'UHD Graphics 730' })!;
    expect(uhd730 / vega).toBeCloseTo(0.43, 1);
    expect(p.ratio).toBeUndefined();
    expect(budgetIgpuScore({ cpuBrand: 'amd', cpuModel: '8600G', igpu: true })).toBe(36);
    expect(budgetIgpuScore({ igpu: true }, { igpu: 'Radeon 780M' })).toBe(40);
  });

  it('considera 32 GB e SSD de 500 GB juntos quando essa combinação cabe no valor', () => {
    const base = catalog();
    const p = planBudget({ budget: 4100, res: '1080p' }, { ...base, ram: base.ram.filter((ram) => ram.specs.ramCapacity === 32) });
    expect(p.parts.ram?.offer.specs.ramCapacity).toBe(32);
    expect(p.parts.ssd?.offer.specs.ssdCapacity).toBe(500);
    expect(models(p).gpu).toBe('RTX 3060');
  });

  it('favorece mais RAM e SSD no perfil misto quando o preço e o orçamento permitem', () => {
    const base = catalog();
    base.cpu = [base.cpu[0]!];
    base.gpu = [base.gpu[0]!];
    base.ram[0]!.priceCash = 580;
    const request = { budget: 5000, res: '1080p' } as const;
    const games = planBudget(request, base);
    const mixed = planBudget({ ...request, profile: 'mixed' }, base);
    expect(games.parts.ram?.offer.specs.ramCapacity).toBe(16);
    expect(mixed.parts.ram?.offer.specs.ramCapacity).toBe(32);
    expect(mixed.parts.ssd?.offer.specs.ssdCapacity).toBe(1000);
    expect(mixed.fps).toBe(games.fps);
    const tight = planBudget({ ...request, budget: games.total, profile: 'mixed' }, base);
    expect(tight.parts.ram?.offer.specs.ramCapacity).toBe(16);
    expect(tight.total).toBeLessThanOrEqual(games.total);
  });

  it('mantém a CPU mais barata se a economia compensa uma perda pequena com a mesma GPU', () => {
    const base = catalog();
    const faster = amd('Ryzen 5', '5600XT', 'AM4', { tdp: 65, cooler: true }, 1200);
    faster.sheet = { architecture: 'Zen 3', boostGhz: 4.49 };
    base.cpu = [base.cpu[0]!, faster];
    base.gpu = [base.gpu[1]!];
    const req = { budget: 10000, res: '1080p' } as const;
    const fast = planBudget(req, { ...base, cpu: [faster] });
    const picked = planBudget(req, base);
    expect(picked.parts.cpu?.offer.specs.cpuModel).toBe('5600');
    expect(picked.fps / fast.fps).toBeLessThan(0.97);
    expect(picked.fps / fast.fps).toBeGreaterThanOrEqual(0.95);
  });

  it('reaproveita as candidatas sem reduzir o melhor índice quando o orçamento aumenta', () => {
    const offers = catalog();
    const inputs = { res: '1440p', hz: 165, profile: 'mixed' } as const;
    const evaluate = prepareBudget(inputs, offers);
    let best = 0;
    for (let budget = 2000; budget <= 15000; budget += 500) {
      const plan = evaluate(budget);
      if (plan.status !== 'ok') continue;
      expect(plan.bestObjective).toBeGreaterThanOrEqual(best);
      expect(plan.total).toBeLessThanOrEqual(budget);
      best = plan.bestObjective!;
    }
    expect(evaluate(15000)).toEqual(planBudget({ ...inputs, budget: 15000 }, offers));
  });

  it('permite vídeo integrado em produtividade e separa a estimativa de trabalho da de jogos', () => {
    const p = planBudget({ budget: 6000, res: '1440p', profile: 'productivity', graphics: 'integrated' }, catalog());
    expect(p.status).toBe('ok');
    expect(p.parts.gpu).toBeUndefined();
    expect(p.objective).toBe(p.work);
    expect(p.objective).toBeGreaterThan(p.fps);
  });

  it('usa a sobra para armazenamento em uma estação forte com vídeo integrado', () => {
    const offers = catalog();
    offers.cpu = [offer({ cpuBrand: 'intel', cpuLine: 'Core i9', cpuModel: '14900K', cpuGen: '14ª Geração', socket: 'LGA1700',
      tdp: 125, cores: 24, threads: 32, igpu: true }, 2450)];
    offers.motherboard = [offer({ socket: 'LGA1700', chipset: 'B760', memory: 'ddr4', formFactor: 'matx' }, 650, { sheet: { vrmHeatsink: true, vrmPhases: '8+1+1' } })];
    const claimed = offer({ coolerType: 'air', coolerSockets: ['LGA1700'], coolerTdp: 350 }, 10);
    const dimensioned = offer({ coolerType: 'air', coolerSockets: ['LGA1700'], coolerTdp: 300 }, 300, { sheet: { heatpipes: 6, fanMm: 120, fans: 2 } });
    offers.cooler = [claimed, dimensioned];
    offers.ssd = [offer({ ssdInterface: 'nvme', ssdCapacity: 512 }, 500), offer({ ssdInterface: 'nvme', ssdCapacity: 1000 }, 950)];
    const evaluate = prepareBudget({ res: '1080p', graphics: 'integrated', profile: 'productivity' }, offers);
    expect(evaluate(5000).parts.ssd?.offer.specs.ssdCapacity).toBe(512);
    expect(evaluate(15000).parts.ssd?.offer.specs.ssdCapacity).toBe(1000);
    expect(evaluate(15000).parts.cooler?.offer).toBe(dimensioned);
    const unverified = prepareBudget({ res: '1080p', graphics: 'integrated', profile: 'productivity' },
      { ...offers, motherboard: [{ ...offers.motherboard[0]!, sheet: { vrmHeatsink: true } }] })(15000, true);
    expect(unverified.status).toBe('no-data');
    expect(unverified.audit?.rejectedBuilds.noSuitableBoard).toBeGreaterThan(0);
  });

  it('prefere folga para possível radiador frontal quando a diferença de preço é pequena', () => {
    const base = catalog();
    base.cpu = [base.cpu[3]!];
    base.gpu = [base.gpu[2]!];
    base.cooler = [offer({ coolerType: 'water', radiator: 240, coolerSockets: ['AM5'], coolerTdp: 185 }, 200)];
    const cabinet = (caseMaxGpu: number, price: number) => offer({ caseFormFactor: 'atx', caseFans: 3, caseRadiators: [240], caseMaxGpu }, price);
    base.case = [cabinet(365, 200), cabinet(400, 210)];
    const req = { budget: 20000, res: '1080p' } as const;
    expect(planBudget(req, base).parts.case?.offer.specs.caseMaxGpu).toBe(400);
    expect(planBudget({ ...req, graphics: 'dedicated' }, { ...base, case: [base.case[0]!] }).status).toBe('no-data');
  });

  it('usa ensaio do modelo de placa-mãe e reserva no cooler em carga sustentada', () => {
    const base = catalog();
    base.cpu = [base.cpu[3]!];
    const generic = base.motherboard[2]!;
    const tested = { ...generic, title: 'ASRock B650M-HDV/M.2', productKey: 'hdv', priceCash: generic.priceCash * 1.04 };
    base.motherboard = [generic, tested];
    base.cooler[1]!.specs.coolerTdp = 150;
    base.cooler.push(offer({ coolerType: 'air', coolerSockets: ['AM5'], coolerTdp: 200 }, 145));
    const p = planBudget({ budget: 16000, res: '1080p', profile: 'mixed' }, base);
    expect(p.parts.motherboard?.offer.productKey).toBe('hdv');
    expect(p.parts.cooler?.offer.specs.coolerTdp).toBe(200);
    expect(p.notes).not.toContain('vrm-unverified');
  });

  it('calibra placas por resolução e considera as variantes de 8 e 12 GB do mesmo chip', () => {
    const base = catalog();
    const variants = [gpu('RTX 3060', 1600, { vram: 8 }), gpu('RTX 3060', 1800, { vram: 12 })].map((o) => ({ ...o, productKey: 'rtx3060' }));
    const p = planBudget({ budget: 10000, res: '1440p' }, { ...base, gpu: variants });
    expect(p.parts.gpu?.offer.specs.vram).toBe(12);
    expect(p.parts.gpu?.offers.map((o) => o.specs.vram)).toEqual([12]);
    expect(p.alternatives.some((x) => x.parts.gpu?.offer.specs.vram === 8)).toBe(true);
    expect((['1080p', '1440p', '4k'] as const).map((res) => budgetGpuScore({ gpuModel: 'RTX 5070' }, res))).toEqual([191, 198, 203]);
    expect(budgetGpuScore({ gpuModel: 'RTX 5060 Ti', vram: 8 }, '4k')).toBe(105);
    expect(budgetGpuScore({ gpuModel: 'RTX 5060 Ti', vram: 16 }, '4k')).toBe(150);
    expect(budgetGpuScore({ gpuModel: 'RX 9060 XT', vram: 8 }, '4k')).toBe(122);
  });

  it('usa a estimativa de potência e as medidas para escolher placa-mãe e cooler', () => {
    const base = catalog();
    const cpu = amd('Ryzen 7', '5800X3D', 'AM4', { tdp: 105, cooler: true }, 700);
    const board = base.motherboard[1]!;
    const withoutVrm = { ...board, priceCash: 400, modelKey: 'cheap', productKey: 'cheap', sheet: { vrmHeatsink: false } };
    board.sheet = { vrmHeatsink: true };
    const cooler = (coolerTdp: number, coolerHeight: number, price: number) => offer({ coolerType: 'air', coolerSockets: ['AM4'], coolerTdp, coolerHeight }, price);
    const p = planBudget({ budget: 7000, res: '1080p' }, {
      ...base, cpu: [cpu], motherboard: [base.motherboard[0]!, withoutVrm, board],
      cooler: [cooler(130, 140, 50), cooler(180, 170, 90), cooler(180, 145, 120)],
      case: [offer({ caseFormFactor: 'matx', caseFans: 3, caseMaxCooler: 150 }, 150)],
    });
    expect(p.parts.motherboard?.offer).toBe(board);
    expect(p.parts.cooler?.price).toBe(120);
    expect(p.notes).not.toContain('box-cooler');
  });

  it('trata a variante WOF como sem cooler mesmo se o anúncio informar que acompanha', () => {
    const base = catalog();
    const cpu = { ...base.cpu[0]!, mpn: '100-100000927WOF' };
    const p = planBudget({ budget: 5000, res: '1080p' }, { ...base, cpu: [cpu] });
    expect(p.parts.cooler).toBeDefined();
    expect(p.notes).not.toContain('box-cooler');
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

  it('omite o percentual de ganho quando a GPU atual não tem referência', () => {
    const p = planBudget({ budget: 3200, res: '1080p', owned: { ...owned, gpu: { specs: {} } } }, catalog());
    expect(p.status).toBe('ok');
    expect(p.fps).toBeGreaterThan(0);
    expect(p.gain).toBeUndefined();
  });

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

  it('mantém a memória atual quando ela serve e não altera o preço depois de escolher', () => {
    const p = planBudget({ budget: 3000, res: '1080p', owned }, catalog());
    expect(p.parts.ram).toBeUndefined();
    expect(p.total).toBe(Object.values(p.parts).reduce((total, part) => total + part.price, 0));
  });

  it('abaixo do primeiro upgrade que vale, informa o preço', () => {
    const p = planBudget({ budget: 1700, res: '1080p', owned }, catalog());
    expect(p.status).toBe('too-low');
    expect(p.minTotal).toBe(1800);
    expect(planBudget({ budget: 1800, res: '1080p', owned }, catalog()).gain).toBeGreaterThanOrEqual(0.1);
  });

  it('plataforma nova cabe no gabinete atual (placa até Micro-ATX) e compra a memória do tipo dela', () => {
    const p = planBudget({ budget: 12000, res: '1080p', owned }, catalog());
    expect(models(p)).toEqual({ cpu: '7800X3D', gpu: 'RTX 5080' });
    expect(p.parts.motherboard?.offer.specs).toMatchObject({ chipset: 'B650', formFactor: 'matx' });
    expect(p.parts.ram?.offer.specs.memory).toBe('ddr5');
    // A fonte de 550 W não aguenta a RTX 5080: entra uma nova.
    expect(p.parts.psu?.offer.specs.watts).toBe(850);
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
