import { describe, expect, it } from 'vitest';
import type { BudgetPlan, BudgetRequest } from '@upgradezin/shared';
import { budgetScenarios, reportOption, resolveBudgetScenario, simulatedPrice } from './budget-test.ts';

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
});
