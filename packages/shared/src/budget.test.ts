import { describe, expect, it } from 'vitest';
import { planBudget, prepareBudget, preferredBrand, type BudgetOption } from './budget.ts';
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
    // Com R$ 4.100 cabe 32 GB com 1 TB (R$ 4.100 exatos), que o motor prefere; R$ 1 a menos, fica 32 GB com 500 GB.
    const p = planBudget({ budget: 4099, res: '1080p' }, { ...base, ram: base.ram.filter((ram) => ram.specs.ramCapacity === 32) });
    expect(planBudget({ budget: 4100, res: '1080p' }, { ...base, ram: base.ram.filter((ram) => ram.specs.ramCapacity === 32) }).parts.ssd?.offer.specs.ssdCapacity).toBe(1000);
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

  it('CPU mais cara entra quando o ganho paga o preço (peso do preço 0,25); a mais barata fica quando a economia é grande', () => {
    // Critério (mudou com a escolha por utilidade): pagar x% a mais vale quando o índice sobe pelo menos 0,25·x%. Antes, a
    // CPU mais barata com a mesma GPU ficava sempre que a economia fosse o dobro da perda.
    const base = catalog();
    const at = (price: number) => {
      const faster = amd('Ryzen 5', '5600XT', 'AM4', { tdp: 65, cooler: true }, price);
      faster.sheet = { architecture: 'Zen 3', boostGhz: 4.49 };
      return { ...base, cpu: [base.cpu[0]!, faster], gpu: [base.gpu[1]!] };
    };
    const req = { budget: 10000, res: '1080p' } as const;
    // +R$ 500 (8,5%) por 3,6% a mais: vale.
    const close = planBudget(req, at(1200));
    expect(close.parts.cpu?.offer.specs.cpuModel).toBe('5600XT');
    // +R$ 1.600 (24%) pelos mesmos 3,6%: não vale; fica a mais barata, e a mais rápida vira a alternativa de mais desempenho.
    const far = planBudget(req, at(2300));
    expect(far.parts.cpu?.offer.specs.cpuModel).toBe('5600');
    expect(far.alternatives.some((alt) => alt.parts.cpu?.offer.specs.cpuModel === '5600XT' && alt.fps > far.fps)).toBe(true);
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
    const p = planBudget({ budget: 6000, res: '1440p', profile: 'productivity', workload: 'cpu', graphics: 'integrated' }, catalog());
    expect(p.status).toBe('ok');
    expect(p.parts.gpu).toBeUndefined();
    expect(p.objective).toBe(p.work);
    expect(p.objective).toBeGreaterThan(p.fps);
    // Só vídeo integrado, sem dizer o tipo de trabalho: conta o processador (a pessoa já disse que não terá placa).
    expect(planBudget({ budget: 6000, res: '1440p', profile: 'productivity', graphics: 'integrated' }, catalog()).objective).toBe(p.objective);
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

describe('motor: escolha por utilidade (cenários direcionados)', () => {
  const capacityOf = (p: BudgetOption) => (p.parts.ram ? (p.parts.ram.offer.specs.ramCapacity ?? 0) * (p.parts.ram.qty ?? 1) : 0) + (p.parts.ssd?.offer.specs.ssdCapacity ?? 0) / 1000;

  it('mais orçamento nunca dá montagem pior: o índice só cai se a capacidade (memória, SSD) subir', () => {
    for (const profile of ['games', 'mixed', 'productivity'] as const) {
      const evaluate = prepareBudget({ res: '1080p', hz: 144, profile }, catalog());
      let prev: ReturnType<typeof planBudget> | undefined;
      for (let budget = 2000; budget <= 16000; budget += 250) {
        const p = evaluate(budget);
        if (p.status !== 'ok') continue;
        if (prev) expect(p.objective! >= prev.objective! - 1e-9 || capacityOf(p) > capacityOf(prev), `${profile} ${budget}`).toBe(true);
        prev = p;
      }
    }
  });

  it('a escolha não depende da sobra: com o valor exato da montagem escolhida, sai a mesma montagem', () => {
    const evaluate = prepareBudget({ res: '1440p', hz: 144 }, catalog());
    for (const budget of [6000, 9000, 12000, 20000]) {
      const big = evaluate(budget);
      const exact = evaluate(big.total);
      expect(Object.fromEntries(Object.entries(exact.parts).map(([s, x]) => [s, x.offer.storeSku]))).toEqual(Object.fromEntries(Object.entries(big.parts).map(([s, x]) => [s, x.offer.storeSku])));
    }
  });

  it('cada alternativa tem motivo: mais desempenho, mais barata, outra peça principal ou mais capacidade; nenhuma é dominada', () => {
    for (const budget of [5000, 8000, 12000]) {
      const p = planBudget({ budget, res: '1440p' }, catalog());
      const first = p;
      for (const alt of p.alternatives) {
        const reason = alt.stretch || alt.objective! >= first.objective! * 1.03 || alt.total <= first.total * 0.95 || capacityOf(alt) > capacityOf(first)
          || models(alt as ReturnType<typeof planBudget>).gpu !== models(first).gpu || models(alt as ReturnType<typeof planBudget>).cpu !== models(first).cpu;
        expect(reason, `${budget}`).toBe(true);
        expect(alt.total >= first.total && alt.objective! <= first.objective! && capacityOf(alt) <= capacityOf(first) && !alt.stretch, `${budget} dominada`).toBe(false);
      }
    }
  });

  it('produtividade sem o tipo de trabalho informado não assume só o processador: com valor, leva placa de vídeo', () => {
    const unknown = planBudget({ budget: 12000, res: '1440p', profile: 'productivity' }, catalog());
    expect(unknown.parts.gpu).toBeDefined();
    expect(unknown.notes).not.toContain('igpu');
    // O índice mistura as duas cargas: fica entre a só de processador e a só acelerada.
    const cpuOnly = planBudget({ budget: 12000, res: '1440p', profile: 'productivity', workload: 'cpu' }, catalog());
    expect(cpuOnly.notes).toContain('igpu');
  });

  it('produtividade com aceleração por placa de vídeo leva placa dedicada; só no processador, o vídeo integrado basta', () => {
    const base = catalog();
    const cpuWork = planBudget({ budget: 12000, res: '1440p', profile: 'productivity', workload: 'cpu' }, base);
    const gpuWork = planBudget({ budget: 12000, res: '1440p', profile: 'productivity', workload: 'gpu' }, base);
    expect(gpuWork.parts.gpu).toBeDefined();
    expect(gpuWork.objective).toBeGreaterThan(0);
    expect(cpuWork.notes).toContain('igpu'); // o trabalho no processador não ganha nada com a placa
    expect(gpuWork.objective).toBeGreaterThan(planBudget({ budget: 12000, res: '1440p', profile: 'productivity', workload: 'gpu', graphics: 'integrated' }, base).objective!);
  });

  it('processador de alto consumo não perde nota de trabalho por placa-mãe sem ensaio (sem penalidade fictícia)', () => {
    const base = catalog();
    const hot = amd('Ryzen 9', '9950X', 'AM5', { tdp: 170, cooler: false, cores: 16, threads: 32, igpu: true }, 3500);
    const board = offer({ socket: 'AM5', chipset: 'X870', memory: 'ddr5', formFactor: 'atx', memorySlots: 4, m2Slots: 2 }, 1500, { sheet: { vrmHeatsink: true, vrmPhases: '16+2+1' } });
    const water = offer({ coolerType: 'water', coolerSockets: ['AM4', 'AM5'], radiator: 360, coolerTdp: 300 }, 700);
    const p = planBudget({ budget: 30000, res: '1080p', profile: 'productivity', graphics: 'integrated' }, { ...base, cpu: [hot], motherboard: [board], cooler: [water] });
    expect(p.status).toBe('ok');
    // A nota de trabalho é a do processador (núcleos e threads), sem corte por consumo acima de 200 W.
    expect(p.work).toBe(Math.round(Math.min(p.cpu!, 150) * Math.sqrt((16 + 0.25 * 16) / 7.5) * 100) / 100);
  });

  it('upgrade: troca combinada (processador e placa juntos) entra quando rende mais pelo que custa; alternativas não dominadas', () => {
    const old: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '2600', socket: 'AM4', tdp: 65 } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      ram: { specs: { memory: 'ddr4', ramCapacity: 16, ramModules: 2, ramSpeed: 3200 } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super' } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    const evaluate = prepareBudget({ res: '1440p', owned: old }, catalog());
    const options = evaluate.options();
    expect(options.some((o) => o.parts.cpu && o.parts.gpu)).toBe(true); // as combinações existem
    let prev: ReturnType<typeof planBudget> | undefined;
    for (const budget of [2500, 4000, 6000, 9000]) {
      const p = evaluate(budget);
      if (p.status !== 'ok') continue;
      expect(p.gain).toBeGreaterThanOrEqual(0.1);
      if (prev) expect(p.objective!).toBeGreaterThanOrEqual(prev.objective! - 1e-9);
      // Mais cara com índice igual ou menor só entra com vantagem na configuração (V5: mais memória ou SSD contam).
      const ramOf = (o: BudgetOption) => (o.parts.ram ? (o.parts.ram.offer.specs.ramCapacity ?? 0) * (o.parts.ram.qty ?? 1) : 16);
      const ssdOf = (o: BudgetOption) => o.parts.ssd?.offer.specs.ssdCapacity ?? 0;
      for (const alt of p.alternatives) expect(alt.total >= p.total && alt.objective! <= p.objective! && !alt.stretch && ramOf(alt) <= ramOf(p) && ssdOf(alt) <= ssdOf(p)).toBe(false);
      prev = p;
    }
    expect(prev?.parts.cpu && prev.parts.gpu).toBeTruthy(); // com valor para as duas, troca as duas
  });
});

describe('motor V4: cenários direcionados', () => {
  const ram = (o: BudgetOption) => (o.parts.ram ? (o.parts.ram.offer.specs.ramCapacity ?? 0) * (o.parts.ram.qty ?? 1) : 0);
  const ids = (o: BudgetOption) => Object.fromEntries(Object.entries(o.parts).map(([s, p]) => [s, p.offer.storeSku]));

  it('o melhor desempenho disponível nunca cai com mais orçamento, e a opção de maior desempenho fica entre as alternativas', () => {
    const evaluate = prepareBudget({ res: '1440p', hz: 144 }, catalog());
    let best = 0;
    for (let budget = 2500; budget <= 15000; budget += 500) {
      const p = evaluate(budget);
      if (p.status !== 'ok') continue;
      expect(p.bestObjective!).toBeGreaterThanOrEqual(best);
      best = p.bestObjective!;
      const strongest = Math.max(...[p, ...p.alternatives].filter((o) => !o.stretch).map((o) => o.objective!));
      if (p.bestObjective! > p.objective! * 1.01) expect(strongest).toBe(p.bestObjective);
    }
  });

  it('dominância: nenhuma configuração completa no valor é mais barata, mais forte e com tanta memória e SSD quanto a recomendada', () => {
    for (const profile of ['games', 'mixed', 'productivity'] as const) {
      const evaluate = prepareBudget({ res: '1440p', profile }, catalog());
      for (const budget of [5000, 9000, 14000]) {
        const p = evaluate(budget);
        if (p.status !== 'ok') continue;
        const better = evaluate.options().find((o) => o.total < p.total && o.objective! > p.objective! && ram(o) >= ram(p)
          && (o.parts.ssd?.offer.specs.ssdCapacity ?? 0) >= (p.parts.ssd?.offer.specs.ssdCapacity ?? 0));
        expect(better, `${profile} ${budget}`).toBeUndefined();
      }
    }
  });

  it('catálogo sintético pequeno: a recomendada está na fronteira (custo × índice) entre todas as combinações válidas', () => {
    const base = catalog();
    const small = { ...base, cpu: base.cpu.slice(0, 3), gpu: base.gpu.slice(0, 2), ram: base.ram.slice(0, 2), ssd: base.ssd.slice(0, 1) };
    const evaluate = prepareBudget({ res: '1080p' }, small);
    const all = evaluate.options();
    for (const budget of [3500, 5000, 8000]) {
      const p = evaluate(budget);
      if (p.status !== 'ok') continue;
      const inBudget = all.filter((o) => o.total <= budget);
      // Ninguém no valor é ao mesmo tempo mais barato e mais forte com a mesma memória (a escolha é ótima de Pareto)...
      expect(inBudget.some((o) => o.total < p.total && o.objective! > p.objective! && ram(o) >= ram(p))).toBe(false);
      // ...e o máximo do valor aparece (recomendada ou alternativa).
      const max = Math.max(...inBudget.map((o) => o.objective!));
      expect([p, ...p.alternatives].some((o) => !o.stretch && o.objective === max)).toBe(true);
    }
  });

  it('promoção na peça escolhida não piora a escolha; sem estoque da escolhida, sai outra válida', () => {
    const base = catalog();
    const req = { budget: 8000, res: '1440p' } as const;
    const before = planBudget(req, base);
    const chosen = before.parts.gpu!.offer.storeSku;
    const promo = planBudget(req, { ...base, gpu: base.gpu.map((o) => (o.storeSku === chosen ? { ...o, priceCash: o.priceCash * 0.8 } : o)) });
    expect(promo.objective!).toBeGreaterThanOrEqual(before.objective!);
    expect(promo.total).toBeLessThanOrEqual(before.total);
    const gone = planBudget(req, { ...base, gpu: base.gpu.map((o) => (o.storeSku === chosen ? { ...o, inStock: false } : o)) });
    expect(gone.status).toBe('ok');
    expect(gone.parts.gpu?.offer.storeSku).not.toBe(chosen);
  });

  it('preferência de fabricante pesa quando as opções são próximas; exigência obriga', () => {
    const base = catalog();
    base.gpu = [gpu('RTX 4060', 2000), offer({ gpuMaker: 'amd', gpuModel: 'RX 7600', vram: 8 }, 1950)];
    const req = { budget: 6000, res: '1080p' } as const;
    const amdPref = planBudget({ ...req, preferences: { gpu: 'amd' } }, base);
    const nvPref = planBudget({ ...req, preferences: { gpu: 'nvidia' } }, base);
    expect(amdPref.parts.gpu?.offer.specs.gpuMaker).toBe('amd');
    expect(nvPref.parts.gpu?.offer.specs.gpuMaker).toBe('nvidia');
    // Exigência: só a marca pedida, mesmo bem mais cara; a preferência não paga 75% a mais.
    const pricey = { ...base, gpu: [gpu('RTX 4060', 2000), offer({ gpuMaker: 'amd', gpuModel: 'RX 7600', vram: 8 }, 3500)] };
    expect(planBudget({ ...req, requiredBrands: { gpu: 'amd' } }, pricey).parts.gpu?.offer.specs.gpuMaker).toBe('amd');
    expect(planBudget({ ...req, preferences: { gpu: 'amd' } }, pricey).parts.gpu?.offer.specs.gpuMaker).toBe('nvidia');
  });

  it('memória proporcional: processador de muitas threads em produtividade pede 32 GB', () => {
    const base = catalog();
    const many = amd('Ryzen 9', '5950X', 'AM4', { tdp: 105, cooler: false, cores: 16, threads: 32, igpu: false }, 1500);
    many.sheet = { architecture: 'Zen 3', boostGhz: 4.9, l3Mb: 64, cores: 16, threads: 32 };
    const work = planBudget({ budget: 12000, res: '1080p', profile: 'productivity', workload: 'cpu' }, { ...base, cpu: [many] });
    expect(work.status).toBe('ok');
    expect(ram(work)).toBeGreaterThanOrEqual(32);
  });

  it('cargas de produtividade diferentes pedem peças diferentes: IA quer memória de vídeo; uso geral não paga placa topo', () => {
    const base = catalog();
    base.gpu = [gpu('RTX 3060', 1800, { vram: 12 }), gpu('RTX 4070', 3500, { vram: 12 }), gpu('RTX 5080', 7000, { vram: 16, gpuLength: 330 }), gpu('RTX 4060', 1700, { vram: 8 })];
    const req = { budget: 16000, res: '1440p', profile: 'productivity' } as const;
    const general = planBudget(req, base);
    const ai = planBudget({ ...req, workload: 'ai' }, base);
    const render = planBudget({ ...req, workload: 'gpu' }, base);
    expect(general.parts.gpu?.offer.specs.gpuModel).not.toBe('RTX 5080');
    expect(ai.parts.gpu?.offer.specs.vram ?? 0).toBeGreaterThanOrEqual(12);
    expect(render.gpu!).toBeGreaterThanOrEqual(general.gpu ?? 0);
  });

  it('upgrade: PC topo de linha não troca nada (no-gain); mais memória vale mesmo sem fps', () => {
    const top: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '7800X3D', socket: 'AM5', tdp: 120 } },
      motherboard: { specs: { chipset: 'B650', socket: 'AM5', formFactor: 'matx', memory: 'ddr5' } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 5080', vram: 16 } },
      psu: { specs: { watts: 1000, efficiency: 'gold' } },
    };
    expect(planBudget({ budget: 20000, res: '1440p', owned: top }, catalog()).status).toBe('no-gain');
    // 8 GB num 5600 para trabalho: só mais memória entra como upgrade (sem mudar processador nem placa de vídeo).
    const small: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '5600', socket: 'AM4', tdp: 65, cores: 6, threads: 12 } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      ram: { specs: { memory: 'ddr4', ramCapacity: 8, ramModules: 1, ramSpeed: 3200 } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 4070', vram: 12 } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    const memory = planBudget({ budget: 600, res: '1080p', owned: small, profile: 'productivity', workload: 'cpu' }, catalog());
    expect(memory.status).toBe('ok');
    expect(memory.parts.ram).toBeDefined();
    expect(memory.parts.cpu).toBeUndefined();
    expect(memory.notes).toContain('more-ram');
  });

  it('upgrade caro por pouco não compensa: o motor diz para não trocar em vez de gastar', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '5800X3D', socket: 'AM4' } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 3060', vram: 12 } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    // A única troca à venda rende ~30% por R$ 9.000: menos de 4% por R$ 1.000, muito pouco por real.
    const pricey = { ...catalog(), cpu: [], motherboard: [], gpu: [gpu('RTX 4060 Ti', 9000, { vram: 16 })] };
    const p = planBudget({ budget: 10000, res: '1080p', owned }, pricey);
    expect(['no-gain', 'no-data']).toContain(p.status);
  });

  it('determinismo e tempo: o mesmo pedido dá o mesmo resultado, rápido', () => {
    const req = { budget: 9000, res: '1440p', hz: 144, profile: 'mixed' } as const;
    const offers = catalog();
    const start = performance.now();
    const a = planBudget(req, offers);
    const b = planBudget(req, offers);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(JSON.stringify({ ...a, parts: ids(a) })).toBe(JSON.stringify({ ...b, parts: ids(b) }));
  });
});

describe('motor V5: configuração inteira, upgrades complementares e retorno marginal', () => {
  const ramGb = (o: BudgetOption) => (o.parts.ram ? (o.parts.ram.offer.specs.ramCapacity ?? 0) * (o.parts.ram.qty ?? 1) : 0);
  const am5Pc = (more: Partial<Build> = {}): Build => ({
    cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '7800X3D', socket: 'AM5', tdp: 120 } },
    motherboard: { specs: { chipset: 'B650', socket: 'AM5', formFactor: 'matx', memory: 'ddr5', memoryMaxGb: 192 } },
    gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 5080', vram: 16 } },
    psu: { specs: { watts: 850, efficiency: 'gold', atx: '3.0' } },
    ...more,
  });

  it('PC forte com pouca memória e SSD pequeno: sugere memória e SSD sem trocar processador nem placa de vídeo', () => {
    const owned = am5Pc({
      ram: { specs: { memory: 'ddr5', ramCapacity: 8, ramModules: 1, ramSpeed: 4800 } },
      ssd: { specs: { ssdInterface: 'sata', ssdForm: '2.5', ssdCapacity: 240 } },
    });
    const p = planBudget({ budget: 3000, res: '1440p', owned }, catalog());
    expect(p.status).toBe('ok');
    expect(p.parts.cpu).toBeUndefined();
    expect(p.parts.gpu).toBeUndefined();
    expect(!!p.parts.ram || !!p.parts.ssd).toBe(true);
    // Memória e SSD juntos também são opção (sem ganho de FPS).
    expect(prepareBudget({ res: '1440p', owned }, catalog()).options().some((o) => o.parts.ram && o.parts.ssd && !o.parts.gpu)).toBe(true);
  });

  it('memória e SSD adequados ficam: o upgrade não troca o que já serve', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '5600', socket: 'AM4', tdp: 65 } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      ram: { specs: { memory: 'ddr4', ramCapacity: 32, ramModules: 2, ramSpeed: 3200 } },
      ssd: { specs: { ssdInterface: 'nvme', ssdForm: 'm2', ssdCapacity: 2000 } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super' } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    const p = planBudget({ budget: 5000, res: '1080p', owned }, catalog());
    expect(p.status).toBe('ok');
    expect(p.parts.gpu).toBeDefined();
    expect(p.parts.ram).toBeUndefined();
    expect(p.parts.ssd).toBeUndefined();
    expect(p.parts.psu).toBeUndefined(); // a fonte atual aguenta: não troca por melhoria irrelevante
  });

  it('placa de vídeo junto com SSD ou memória são combinações consideradas quando a peça atual limita', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '5800X3D', socket: 'AM4', tdp: 105 } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      ram: { specs: { memory: 'ddr4', ramCapacity: 16, ramModules: 2, ramSpeed: 3200 } },
      ssd: { specs: { ssdInterface: 'sata', ssdForm: '2.5', ssdCapacity: 480 } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super' } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    const options = prepareBudget({ res: '1440p', owned }, catalog()).options();
    expect(options.some((o) => o.parts.gpu && o.parts.ssd)).toBe(true);
    expect(options.some((o) => o.parts.gpu && o.parts.ram)).toBe(true);
  });

  it('retorno marginal muito baixo: a recomendada não é a mais rápida, e a mais rápida continua como opção', () => {
    const fast = budgetGpuScore({ gpuModel: 'RTX 5080' }, '1440p')!;
    const mid = budgetGpuScore({ gpuModel: 'RTX 4080 Super' }, '1440p')!;
    expect(fast / mid).toBeLessThan(1.15);
    // A mais rápida rende ~11% a mais custando 3x: muito pouco a mais por real.
    const offers = { ...catalog(), gpu: [gpu('RTX 4080 Super', 6000, { gpuLength: 300 }), gpu('RTX 5080', 18000, { gpuLength: 300 })] };
    const p = planBudget({ budget: 30000, res: '1440p', hz: 144 }, offers);
    expect(p.status).toBe('ok');
    expect(p.parts.gpu?.offer.specs.gpuModel).toBe('RTX 4080 Super');
    expect([p, ...p.alternatives].some((o) => o.parts.gpu?.offer.specs.gpuModel === 'RTX 5080')).toBe(true);
    // O bestObjective é o da opção mais forte que aparece (sem divergência).
    expect(Math.max(...[p, ...p.alternatives].filter((o) => !o.stretch).map((o) => o.objective!))).toBeCloseTo(p.bestObjective!, 1);
  });

  it('upgrade com orçamento enorme: a nota de cada opção não depende do valor (R$ 30 mil, 50 mil e 100 mil dão a mesma escolha)', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '2600', socket: 'AM4', tdp: 65 } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      ram: { specs: { memory: 'ddr4', ramCapacity: 16, ramModules: 2, ramSpeed: 3200 } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super' } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    const evaluate = prepareBudget({ res: '1440p', owned }, catalog());
    const picks = [30000, 50000, 100000].map((b) => evaluate(b));
    for (const p of picks) expect(p.status).toBe('ok');
    expect(new Set(picks.map((p) => p.total)).size).toBe(1);
    expect(new Set(picks.map((p) => p.utility)).size).toBe(1);
    // Não gasta tudo: o total fica bem abaixo do valor.
    expect(picks[2]!.total).toBeLessThan(30000);
  });

  it('o mesmo ganho relativo vale igual em escalas diferentes (sem limite fixo de pontos por real)', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '5800X3D', socket: 'AM4' } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 3060', vram: 12 } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    // ~30% por R$ 9.000 não compensa; o mesmo ganho por R$ 3.000 compensa.
    const at = (price: number) => planBudget({ budget: 10000, res: '1080p', owned }, { ...catalog(), cpu: [], motherboard: [], gpu: [gpu('RTX 4060 Ti', price, { vram: 16 })] }).status;
    expect(['no-gain', 'no-data']).toContain(at(9000));
    expect(at(3000)).toBe('ok');
  });

  it('placa-mãe: mais de uma por plataforma quando a mais cara tem construção melhor (VRM com evidência, expansão)', () => {
    const offers = catalog();
    offers.motherboard.push(offer({ socket: 'AM5', chipset: 'B650', memory: 'ddr5', formFactor: 'matx', memorySlots: 4, m2Slots: 2 }, 1150,
      { sheet: { vrmHeatsink: true, vrmPhases: '12+2+1' } }));
    const boards = new Set(prepareBudget({ res: '1440p', hz: 144 }, offers).options()
      .filter((o) => o.parts.cpu?.offer.specs.cpuModel === '7800X3D').map((o) => o.parts.motherboard?.offer.storeSku));
    expect(boards.size).toBe(2);
  });

  it('B840 é chipset de entrada: processador de 170 W não vai nele; um de 65 W vai', () => {
    const offers = catalog();
    offers.motherboard = [offer({ socket: 'AM5', chipset: 'B840', memory: 'ddr5', formFactor: 'matx' }, 650)];
    offers.cpu = [amd('Ryzen 9', '9950X', 'AM5', { tdp: 170, cooler: false, igpu: true }, 4000), amd('Ryzen 5', '7600', 'AM5', { tdp: 65, cooler: true, igpu: true }, 1100)];
    offers.cooler.push(offer({ coolerType: 'water', coolerSockets: ['AM5'], radiator: 360, coolerTdp: 300 }, 600));
    const options = prepareBudget({ res: '1080p' }, offers).options();
    expect(options.some((o) => o.parts.cpu?.offer.specs.cpuModel === '9950X')).toBe(false);
    expect(options.some((o) => o.parts.cpu?.offer.specs.cpuModel === '7600')).toBe(true);
  });

  it('edição de vídeo pede pelo menos 32 GB, mesmo com processador de poucas threads', () => {
    const p = planBudget({ budget: 9000, res: '1080p', profile: 'productivity', workload: 'video' }, catalog());
    expect(p.status).toBe('ok');
    expect(ramGb(p)).toBeGreaterThanOrEqual(32);
  });

  it('pequena mudança de preço não troca a recomendação por uma bem pior', () => {
    const offers = catalog();
    const before = planBudget({ budget: 9000, res: '1440p', hz: 144 }, offers);
    const nudged = { ...offers, gpu: offers.gpu.map((g) => ({ ...g, priceCash: g.priceCash * 1.01 })) };
    const after = planBudget({ budget: 9000, res: '1440p', hz: 144 }, nudged);
    expect(after.objective!).toBeGreaterThanOrEqual(before.objective! * 0.95);
  });

  it('determinismo e tempo no upgrade com as combinações complementares', () => {
    const owned = am5Pc({ ram: { specs: { memory: 'ddr5', ramCapacity: 16, ramModules: 2, ramSpeed: 5600 } }, ssd: { specs: { ssdInterface: 'sata', ssdForm: '2.5', ssdCapacity: 480 } } });
    const start = performance.now();
    const a = planBudget({ budget: 20000, res: '4k', hz: 144, owned, profile: 'mixed' }, catalog());
    const b = planBudget({ budget: 20000, res: '4k', hz: 144, owned, profile: 'mixed' }, catalog());
    expect(performance.now() - start).toBeLessThan(2000);
    expect([a.status, a.total, a.utility]).toEqual([b.status, b.total, b.utility]);
  });
});

describe('motor V6: configuração final, somar em vez de trocar, adequação e otimização', () => {
  const amdPc = (more: Partial<Build> = {}): Build => ({
    cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '7800X3D', socket: 'AM5', tdp: 120 } },
    motherboard: { specs: { chipset: 'B650', socket: 'AM5', formFactor: 'atx', memory: 'ddr5', memorySlots: 4, m2Slots: 2, memoryMaxGb: 192 } },
    gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 5080', vram: 16 } },
    psu: { specs: { watts: 850, efficiency: 'gold', atx: '3.0' } },
    ...more,
  });
  const ddr5Kit = (cap: number, price: number) => offer({ memory: 'ddr5', ramCapacity: cap, ramModules: 2, ramSpeed: 6000 }, price);

  it('soma memória nos slots livres em vez de trocar: a configuração final tem a atual mais o kit', () => {
    const owned = amdPc({ ram: { specs: { memory: 'ddr5', ramCapacity: 16, ramModules: 2, ramSpeed: 6000 } } });
    const offers = { ...catalog(), ram: [ddr5Kit(16, 450), ddr5Kit(32, 800)] };
    const options = prepareBudget({ res: '1440p', owned }, offers).options();
    const added = options.find((o) => o.notes.includes('ram-added'));
    expect(added).toBeDefined();
    expect(added!.parts.ram?.offer.specs.ramCapacity).toBe(16);
    expect(added!.final?.ramGb).toBe(32);
    expect(added!.parts.cpu).toBeUndefined();
  });

  it('não soma memória sem slots livres informados (2 slots ocupados)', () => {
    const owned = amdPc({
      motherboard: { specs: { chipset: 'B650', socket: 'AM5', formFactor: 'matx', memory: 'ddr5', memorySlots: 2 } },
      ram: { specs: { memory: 'ddr5', ramCapacity: 16, ramModules: 2, ramSpeed: 6000 } },
    });
    const options = prepareBudget({ res: '1440p', owned }, { ...catalog(), ram: [ddr5Kit(16, 450), ddr5Kit(32, 800)] }).options();
    expect(options.some((o) => o.notes.includes('ram-added'))).toBe(false);
  });

  it('SSD novo soma ao atual (que fica como disco extra) quando há onde ligar', () => {
    const owned = amdPc({
      ram: { specs: { memory: 'ddr5', ramCapacity: 32, ramModules: 2, ramSpeed: 6000 } },
      ssd: { specs: { ssdInterface: 'sata', ssdForm: '2.5', ssdCapacity: 480 } },
    });
    const p = planBudget({ budget: 2000, res: '1440p', owned }, catalog());
    expect(p.status).toBe('ok');
    expect(p.parts.ssd).toBeDefined();
    expect(p.notes).toContain('keeps-ssd');
    expect(p.final?.storageGb).toBe((p.parts.ssd!.offer.specs.ssdCapacity ?? 0) + 480);
    expect(p.final?.storageKind).toBe('nvme');
  });

  it('8 GB e 16 GB não valem igual quando a configuração pede 32: o processador forte de produtividade leva memória', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 9', cpuModel: '7950X', socket: 'AM5', tdp: 170, cores: 16, threads: 32 } },
      motherboard: { specs: { chipset: 'X670', socket: 'AM5', formFactor: 'atx', memory: 'ddr5', memorySlots: 2 } },
      ram: { specs: { memory: 'ddr5', ramCapacity: 8, ramModules: 1, ramSpeed: 5600 } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 4070' } },
      psu: { specs: { watts: 850, efficiency: 'gold' } },
    };
    const offers = { ...catalog(), ram: [ddr5Kit(16, 450), ddr5Kit(32, 800), ddr5Kit(64, 1700)] };
    const p = planBudget({ budget: 3000, res: '1080p', profile: 'productivity', owned }, offers);
    expect(p.status).toBe('ok');
    expect(p.parts.ram).toBeDefined();
    expect(p.final?.ramGb).toBeGreaterThanOrEqual(32);
  });

  it('placa de vídeo com muita memória de vídeo leva 32 GB em jogos (pela configuração, não pelo orçamento)', () => {
    const offers = { ...catalog(), gpu: [gpu('RTX 5080', 7000, { gpuLength: 300, vram: 16 })] };
    const p = planBudget({ budget: 15000, res: '1440p', hz: 144 }, offers);
    expect(p.status).toBe('ok');
    expect(p.final?.ramGb).toBe(32);
    expect(p.adequacy?.ram).toBe('confirmed');
  });

  it('adequação separada da compatibilidade: fonte atual sem potência informada fica "unknown", nunca confirmada', () => {
    const owned = amdPc({ psu: { specs: {} }, gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super' } } });
    const p = planBudget({ budget: 5000, res: '1080p', owned }, catalog());
    expect(p.status).toBe('ok');
    expect(p.adequacy?.psu).toBe('unknown');
    expect(p.notes).toContain('psu-unknown');
  });

  it('cooler com TDP declarado acima da carga é adequação confirmada; só pela construção, estimada', () => {
    const offers = catalog();
    const p = planBudget({ budget: 9000, res: '1440p', hz: 144 }, offers);
    expect(p.status).toBe('ok');
    if (p.parts.cooler) expect(p.adequacy?.cooler).toBe(p.parts.cooler.offer.specs.coolerTdp !== undefined ? 'confirmed' : 'estimated');
    else expect(['estimated', 'confirmed']).toContain(p.adequacy?.cooler);
  });

  it('cooler: além do mais barato que passa, o de mais evidência térmica entra na busca (sem diversidade forçada)', () => {
    const offers = catalog();
    offers.cooler.push(offer({ coolerType: 'air', coolerSockets: ['AM4', 'AM5'], coolerTdp: 260 }, 180));
    const coolersUsed = new Set(prepareBudget({ res: '1440p', hz: 144 }, offers).options()
      .filter((o) => o.parts.cpu?.offer.specs.cpuModel === '7800X3D' && o.parts.cooler).map((o) => o.parts.cooler!.offer.specs.coolerTdp));
    expect(coolersUsed.has(180)).toBe(true);
    expect(coolersUsed.has(260)).toBe(true);
  });

  it('busca exaustiva sobre as opções válidas: a recomendada tem a maior utilidade entre as que cabem (PC inteiro)', () => {
    const evaluate = prepareBudget({ res: '1440p', hz: 144 }, catalog());
    const all = evaluate.options();
    for (const budget of [5000, 9000, 15000]) {
      const p = evaluate(budget);
      if (p.status !== 'ok') continue;
      const best = Math.max(...all.filter((o) => o.total <= budget).map((o) => o.utility!));
      expect(p.utility).toBeCloseTo(best, 4);
    }
  });

  it('catálogo sintético com ótimo conhecido: uma placa de vídeo domina as outras (mais rápida e mais barata) e é a escolhida', () => {
    const offers = { ...catalog(), gpu: [gpu('RTX 4070', 3500), gpu('RTX 4080 Super', 3400, { gpuLength: 300 }), gpu('RTX 3060', 3600)] };
    const p = planBudget({ budget: 12000, res: '1440p', hz: 144 }, offers);
    expect(p.parts.gpu?.offer.specs.gpuModel).toBe('RTX 4080 Super');
    for (const alt of p.alternatives) expect(alt.parts.gpu?.offer.specs.gpuModel === 'RTX 3060' && alt.total >= p.total).toBe(false);
  });

  it('nenhuma alternativa é dominada pela configuração completa (custo, índice, memória, armazenamento)', () => {
    const p = planBudget({ budget: 12000, res: '1440p', hz: 144, profile: 'mixed' }, catalog());
    const opts = [p, ...p.alternatives].filter((o) => !o.stretch);
    for (const x of opts) for (const y of opts) {
      if (x === y) continue;
      const dom = y.total <= x.total && y.objective! >= x.objective! && (y.final?.ramGb ?? 0) >= (x.final?.ramGb ?? 0) && (y.final?.storageGb ?? 0) >= (x.final?.storageGb ?? 0)
        && (y.total < x.total || y.objective! > x.objective! || (y.final?.ramGb ?? 0) > (x.final?.ramGb ?? 0) || (y.final?.storageGb ?? 0) > (x.final?.storageGb ?? 0));
      expect(dom && (y.utility ?? 0) >= (x.utility ?? 0) + 0.05).toBe(false);
    }
  });

  it('rótulos vêm do motor e batem com a vantagem: a de maior desempenho é a de maior índice; a econômica é mais barata', () => {
    const offers = { ...catalog(), gpu: [gpu('RTX 3060', 1800), gpu('RTX 4070', 3500), gpu('RTX 4080 Super', 6000, { gpuLength: 300 }), gpu('RTX 5080', 18000, { gpuLength: 300 })] };
    const p = planBudget({ budget: 30000, res: '1440p', hz: 144 }, offers);
    expect(p.reason).toBe('recommended');
    for (const alt of p.alternatives) {
      if (alt.reason === 'max-performance') expect(alt.objective!).toBeGreaterThan(p.objective!);
      if (alt.reason === 'economy' || alt.reason === 'value') expect(alt.total).toBeLessThan(p.total);
    }
    const strongest = Math.max(...[p, ...p.alternatives].filter((o) => !o.stretch).map((o) => o.objective!));
    expect(strongest).toBeCloseTo(p.bestObjective!, 1);
  });

  it('orçamentos extremos (R$ 40, 50, 75 e 100 mil): monotônico, nunca acima do valor e sem gastar tudo à toa', () => {
    const evaluate = prepareBudget({ res: '4k', hz: 144 }, catalog());
    let prev: number | undefined;
    for (const budget of [40000, 50000, 75000, 100000]) {
      const p = evaluate(budget);
      expect(p.status).toBe('ok');
      expect(p.total).toBeLessThanOrEqual(budget);
      if (prev !== undefined) expect(p.utility!).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p.utility;
    }
    expect(evaluate(100000).total).toBeLessThan(40000);
  });

  it('preferência muda a escolha entre alternativas parecidas; exigência obriga mesmo mais cara', () => {
    // Par real empatado em 1440p (RTX 5070 Ti 116,8 e RX 9070 XT 116,5 na tabela), mesmo preço: a preferência decide.
    const amdGpu = (price: number) => offer({ gpuMaker: 'amd', gpuModel: 'RX 9070 XT', gpuLength: 300 }, price);
    const offers = { ...catalog(), gpu: [gpu('RTX 5070 Ti', 4500, { gpuLength: 300 }), amdGpu(4500)] };
    const amdPick = planBudget({ budget: 12000, res: '1440p', hz: 144, preferences: { gpu: 'amd' } }, offers);
    const nvPick = planBudget({ budget: 12000, res: '1440p', hz: 144, preferences: { gpu: 'nvidia' } }, offers);
    expect(amdPick.parts.gpu?.offer.specs.gpuMaker).toBe('amd');
    expect(nvPick.parts.gpu?.offer.specs.gpuMaker).toBe('nvidia');
    const pricey = { ...catalog(), gpu: [gpu('RTX 5070 Ti', 4500, { gpuLength: 300 }), amdGpu(7000)] };
    expect(planBudget({ budget: 12000, res: '1440p', hz: 144, requiredBrands: { gpu: 'amd' } }, pricey).parts.gpu?.offer.specs.gpuMaker).toBe('amd');
  });

  it('upgrade: o plano traz o PC atual (antes) e o motor ainda recomenda não trocar quando nada compensa', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 7', cpuModel: '5800X3D', socket: 'AM4' } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'RTX 3060', vram: 12 } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    const ok = planBudget({ budget: 10000, res: '1080p', owned }, { ...catalog(), cpu: [], motherboard: [], gpu: [gpu('RTX 4060 Ti', 3000, { vram: 16 })] });
    expect(ok.status).toBe('ok');
    expect(ok.current?.objective).toBeGreaterThan(0);
    expect(ok.objective! / ok.current!.objective - 1).toBeCloseTo(ok.gain!, 1);
    expect(ok.utility!).toBeGreaterThan(ok.current!.utility);
    const no = planBudget({ budget: 10000, res: '1080p', owned }, { ...catalog(), cpu: [], motherboard: [], gpu: [gpu('RTX 4060 Ti', 9000, { vram: 16 })] });
    expect(['no-gain', 'no-data']).toContain(no.status);
  });

  it('consistência entre funcionalidades: as opções do motor (usadas pelas dicas do gargalo) contêm a recomendada', () => {
    const owned: Build = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '5600', socket: 'AM4', tdp: 65 } },
      motherboard: { specs: { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' } },
      gpu: { specs: { gpuMaker: 'nvidia', gpuModel: 'GTX 1660 Super' } },
      psu: { specs: { watts: 750, efficiency: 'gold' } },
    };
    const evaluate = prepareBudget({ res: '1080p', owned }, catalog());
    const p = evaluate(6000);
    expect(p.status).toBe('ok');
    expect(evaluate.options().some((o) => o.total === p.total && o.objective === p.objective)).toBe(true);
  });

  it('estatísticas da busca no plano (candidatos e descartes), deterministas', () => {
    const a = planBudget({ budget: 9000, res: '1440p', hz: 144 }, catalog());
    const b = planBudget({ budget: 9000, res: '1440p', hz: 144 }, catalog());
    expect(a.stats?.candidates).toBeGreaterThan(0);
    expect(a.stats).toEqual(b.stats);
  });
});
