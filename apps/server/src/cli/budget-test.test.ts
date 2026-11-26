import { describe, expect, it } from 'vitest';
import type { BudgetOption, BudgetPlan, BudgetRequest, Build, Offer } from '@upgradezin/shared';
import { budgetScenarios, classifyOptions, reportOption, resolveBudgetScenario, simulatedPrice } from './budget-test.ts';

describe('matriz de PC completo', () => {
  it('aplica variação no preço histórico preservando a identidade e a data', () => {
    const reference = { at: '2026-11-24T12:00:00Z', price: 1000 };
    const offer = { store: 's1', storeSku: 'x', modelKey: 'x', title: 'Peça', url: 'https://s1.example/x', seller: 'S1',
      priceCash: 0, inStock: false, marketplace: false, openbox: false, specs: {}, collectedAt: reference.at, reference } as const;
    expect(simulatedPrice(offer, -20, Date.parse(reference.at))).toMatchObject({ storeSku: 'x', inStock: false, reference: { at: reference.at, price: 800 } });
    expect(reference.price).toBe(1000);
  });
  it('gera os 120 cruzamentos únicos, incluindo 24 rodadas no mínimo dinâmico', () => {
    const scenarios = budgetScenarios();
    expect(scenarios).toHaveLength(120);
    expect(new Set(scenarios.map((request) => JSON.stringify(request))).size).toBe(120);
    expect(scenarios.filter((request) => request.budgetTier === 'minimum')).toHaveLength(24);
    expect(scenarios).toContainEqual({ budgetTier: 15000, mode: 'ideal', profile: 'mixed', res: '4k', hz: 144 });
    expect(scenarios).toContainEqual({ budgetTier: 'minimum', mode: 'buyable', profile: 'games', res: '1080p', hz: 60 });
  });

  it('consulta o mínimo do motor para cada modalidade e repete com o valor devolvido', () => {
    const budgets: number[] = [];
    const evaluate = ({ budget, mode }: BudgetRequest): BudgetPlan => {
      budgets.push(budget);
      const minTotal = mode === 'ideal' ? 2411 : 2758;
      return { budget, status: budget < minTotal ? 'too-low' : 'ok', ...(budget < minTotal && { minTotal }),
        total: 0, parts: {}, fps: 0, notes: [], issues: [], alternatives: [] };
    };
    const base = { budgetTier: 'minimum', mode: 'buyable', profile: 'games', res: '1080p', hz: 60 } as const;
    expect(resolveBudgetScenario(base, evaluate)).toMatchObject({ request: { budget: 2758 }, plan: { status: 'ok' }, minimumBrl: 2758 });
    expect(resolveBudgetScenario({ ...base, mode: 'ideal' }, evaluate)).toMatchObject({ request: { budget: 2411 }, plan: { status: 'ok' }, minimumBrl: 2411 });
    expect(budgets).toEqual([100, 2758, 100, 2411]);
  });

  it('mantém os campos de cada peça e sinaliza uma opção comum acima do limite', () => {
    const option = reportOption({ total: 3000, parts: {}, fps: 42, notes: [], issues: [] }, { budget: 2600, res: '1080p', mode: 'buyable' });
    expect(option).toMatchObject({
      totalBrl: 3000, remainingBrl: -400, stretch: false, violations: ['over-budget'],
      performance: { combinedIndex: 42, cpuIndex: null, gpuIndex: null, cpuGpuRatio: null },
      parts: { motherboard: null, cpu: null, ram: null, gpu: null, psu: null, ssd: null, cooler: null, case: null },
    });
  });

  it('classifica cada opção pela vantagem real e exporta o upgrade (custo, reaproveitadas, final, índice antes e depois)', () => {
    const part = (specs: Record<string, unknown>, price: number, title = 'Peça') => ({ price, offer: { title, specs } as unknown as Offer, offers: [] });
    const base = { notes: [], issues: [] };
    const first: BudgetOption = { ...base, total: 5000, fps: 100, objective: 100, parts: { gpu: part({ gpuModel: 'RTX 4070' }, 3000), cpu: part({ cpuModel: '5600' }, 700) } };
    const faster: BudgetOption = { ...base, total: 5600, fps: 110, objective: 110, parts: { gpu: part({ gpuModel: 'RTX 5070' }, 3600), cpu: part({ cpuModel: '5600' }, 700) } };
    const cheaper: BudgetOption = { ...base, total: 4000, fps: 90, objective: 90, parts: { gpu: part({ gpuModel: 'RTX 3060' }, 2000), cpu: part({ cpuModel: '5600' }, 700) } };
    expect(classifyOptions([first, faster, cheaper])).toEqual([
      ['recomendada'],
      ['maior-desempenho', 'outra-placa-de-video'],
      ['custo-beneficio', 'mais-barata', 'outra-placa-de-video'],
    ]);
    const owned: Build = { cpu: { specs: { cpuModel: '5600' } }, gpu: { specs: { gpuModel: 'RX 6600' } }, psu: { specs: { watts: 650 } } };
    const upgrade = reportOption({ ...base, total: 3000, fps: 140, objective: 140, gain: 0.4, parts: { gpu: part({ gpuModel: 'RTX 4070' }, 3000, 'Placa RTX 4070') } },
      { budget: 3500, res: '1080p', mode: 'buyable', owned }).upgrade;
    expect(upgrade).toEqual({ costBrl: 3000, reused: ['cpu', 'psu'], indexBefore: 100, indexAfter: 140,
      final: { motherboard: null, cpu: '5600', ram: null, gpu: 'Placa RTX 4070', psu: '650 W', ssd: null, cooler: null, case: null } });
  });
});
