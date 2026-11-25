import { describe, expect, it, vi } from 'vitest';
import { parseCpuzReport, type BudgetPlan, type Offer } from '@upgradezin/shared';
import amd from '../../../packages/shared/fixtures/cpuz/amd-am4-rx6600.txt?raw';
import type { BuildItem } from './build.ts';
import { BUDGET_VISIBLE, budgetRequest, defaultBudgetUi, formatBudget, lastBudgetMode, loadBudgetResult, optionHeadline, optionLabels, optionsOf, ownedBuild, parseBudget, planToBuild,
  sanitizeBudgetUi, saveBudgetResult, stretchGain } from './budget.ts';
import { resultDate } from './components/BudgetView.tsx';

const pc = parseCpuzReport(amd)!;
const offer = (store: Offer['store'], sku: string, title: string, priceCash: number, specs: Offer['specs']): Offer =>
  ({ store, storeSku: sku, title, url: `https://${store}.example/${sku}`, priceCash, inStock: true, specs, modelKey: 'rtx5070', productKey: 'p1', collectedAt: '' }) as Offer;

describe('montar pelo orçamento: tela', () => {
  it('deixa habilitada a opção de Montar pelo orçamento', () => {
    expect(BUDGET_VISIBLE).toBe(true);
  });

  it('lembra o modo de preço e o inclui no pedido', () => {
    expect(sanitizeBudgetUi({ priceMode: 'ideal' }).priceMode).toBe('ideal');
    expect(sanitizeBudgetUi({ priceMode: 'unknown' }).priceMode).toBeUndefined();
    expect(budgetRequest(5000, { res: '1440p', mode: 'ideal' })).toMatchObject({ mode: 'ideal' });
  });

  it('lembra o perfil de uso e o envia junto do orçamento', () => {
    expect(sanitizeBudgetUi({ profile: 'mixed' }).profile).toBe('mixed');
    expect(sanitizeBudgetUi({ profile: 'unknown' }).profile).toBeUndefined();
    expect(budgetRequest(5000, { res: '1440p', profile: 'mixed' })).toMatchObject({ profile: 'mixed' });
  });

  it('lê o valor digitado de vários jeitos', () => {
    expect(parseBudget('8000')).toBe(8000);
    expect(parseBudget('R$ 8.000,00')).toBe(8000);
    expect(parseBudget('12.500')).toBe(12500);
    expect(parseBudget('R$ 8.000,75')).toBe(8000.75);
    expect(parseBudget('-8000')).toBeUndefined();
    expect(parseBudget('abc')).toBeUndefined();
    expect(parseBudget('')).toBeUndefined();
  });

  it('formata valores digitados e salvos com separadores brasileiros e dois centavos', () => {
    expect(formatBudget(parseBudget('8000')!)).toBe('8.000,00');
    expect(formatBudget(parseBudget('8000,5')!)).toBe('8.000,50');
    expect(defaultBudgetUi().text.full).toBe('8.000,00');
    expect(sanitizeBudgetUi({ text: { full: '8000', upgrade: '2500,50' } }).text).toEqual({ full: '8.000,00', upgrade: '2.500,50' });
  });

  it('as peças atuais: as do relatório e a fonte marcada como "Já tenho"; o pedido leva só as specs', () => {
    const psu: BuildItem = { key: 'psu', title: 'Fonte 650W', specs: { watts: 650 }, offers: [], current: true };
    const owned = ownedBuild(pc, { psu });
    expect(Object.keys(owned).sort()).toEqual(['cpu', 'extraDrives', 'gpu', 'motherboard', 'psu', 'ram', 'ssd']);
    const req = budgetRequest(3000, { res: '1440p', hz: 144 }, owned, { cpu: 132, gpu: 95 });
    expect(req).toMatchObject({ budget: 3000, res: '1440p', hz: 144, current: { cpu: 132, gpu: 95 } });
    expect(req.owned?.psu).toEqual({ specs: { watts: 650 }, qty: 1, current: true });
    expect(req.owned?.extraDrives).toHaveLength(2);
    expect(req.owned?.extraDrives?.[1]).toEqual({ specs: { ssdCapacity: 932, ssdInterface: 'nvme' }, current: true });
    expect(JSON.stringify(req)).not.toContain('Fonte 650W');
    // Fonte comprada numa loja (não "Já tenho") não conta como do PC.
    expect(ownedBuild(pc, { psu: { ...psu, current: undefined } }).psu).toBeUndefined();
  });

  it('usa gabinete e cooler marcados como atuais e preserva a quantidade do kit de RAM', () => {
    const item: BuildItem = { key: 'atual', title: 'Peça Atual', specs: {}, offers: [], current: true };
    const owned = ownedBuild(pc, { case: item, cooler: item, ram: { ...item, qty: 2, specs: { ramCapacity: 8 } } });
    const req = budgetRequest(2500, { res: '1080p' }, owned);
    expect(req.owned).toMatchObject({ case: { current: true }, cooler: { current: true }, ram: { specs: { ramCapacity: 8 }, qty: 2 } });
  });

  it('as opções do plano: a melhor e as alternativas; sem plano, nenhuma', () => {
    const opt = { parts: {}, total: 1000, fps: 100, notes: [], issues: [] };
    const plan: BudgetPlan = { status: 'ok', budget: 2000, ...opt, total: 1500, alternatives: [opt, { ...opt, total: 900 }] };
    expect(optionsOf(plan).map((o) => o.total)).toEqual([1500, 1000, 900]);
    expect(optionsOf({ ...plan, status: 'too-low' })).toEqual([]);
  });

  it('rótulos honestos: a 1ª é a de mais desempenho no valor; a de mais desempenho por real é a de melhor custo-benefício; a que passa do valor diz isso', () => {
    const o = (total: number, fps: number, stretch?: true) => ({ parts: {}, total, fps, notes: [], issues: [], ...(stretch && { stretch }) });
    expect(optionLabels([o(10000, 200), o(7000, 170), o(12000, 230, true)])).toEqual(['Recomendada no valor', 'Melhor custo-benefício', 'Acima do valor']);
    expect(optionLabels([o(10000, 200), o(9500, 150)])).toEqual(['Recomendada no valor · Melhor custo-benefício', '']);
    expect(optionLabels([o(6000, 100), o(9000, 120)])).toEqual(['Recomendada no valor · Melhor custo-benefício', 'Maior desempenho no valor']);
    expect(stretchGain(o(12000, 230, true), o(10000, 200))).toBe(15);
    expect(stretchGain(o(12000, 230, true), o(10000, 0))).toBeUndefined();
  });

  it('o plano vira montagem: a peça comprada com as ofertas de todas as lojas, as atuais que ficam continuam', () => {
    const specs = { gpuMaker: 'nvidia', gpuModel: 'RTX 5070' } as const;
    const offers = [offer('s1', '1', 'Placa de vídeo RTX 5070 12GB', 4200, specs), offer('s2', '9', 'Placa de vídeo RTX 5070 12GB', 4000, specs)];
    const plan: BudgetPlan = { status: 'ok', budget: 4500, parts: { gpu: { price: 4000, offer: offers[1]!, offers } }, total: 4000, fps: 100, notes: [], issues: [], alternatives: [] };
    const b = planToBuild(plan, ownedBuild(pc, {}));
    expect(b.gpu).toMatchObject({ title: 'Placa de vídeo RTX 5070 12GB' });
    expect(b.gpu?.current).toBeUndefined();
    expect(b.gpu?.offers.map((o) => o.store).sort()).toEqual(['s1', 's2']);
    expect(b.cpu).toMatchObject({ current: true, title: 'AMD Ryzen 7 5800X3D' });
    // Memória em 2 pentes avulsos: entra na montagem com a quantidade.
    const ram = offer('s1', '5', 'Memória 16GB DDR4 3200', 729, { memory: 'ddr4', ramCapacity: 16, ramModules: 1 });
    const withRam = planToBuild({ ...plan, parts: { ram: { price: 1458, qty: 2, offer: ram, offers: [ram] } } });
    expect(withRam.ram?.qty).toBe(2);
  });

  it('lembra os campos preenchidos e descarta a marca antiga de execução automática', () => {
    const saved = sanitizeBudgetUi({ mode: 'upgrade', text: { full: '15.000', upgrade: '3000' }, res: '1440p', fast: true, ran: { upgrade: true, full: 'sim' } });
    expect(saved).toEqual({ mode: 'upgrade', text: { full: '15.000,00', upgrade: '3.000,00' }, res: '1440p', fast: true });
    expect(sanitizeBudgetUi({ mode: 'tv', text: { full: 9, upgrade: 'x'.repeat(50) }, res: '8k', fast: 'sim' })).toEqual(defaultBudgetUi());
    expect(sanitizeBudgetUi(null)).toEqual(defaultBudgetUi());
  });

  it('aba ao abrir: a última usada; upgrade só com PC importado; sem histórico, upgrade se há PC', () => {
    expect(lastBudgetMode(pc, { ...defaultBudgetUi(), mode: 'full' })).toBe('full');
    expect(lastBudgetMode(pc, { ...defaultBudgetUi(), mode: 'upgrade' })).toBe('upgrade');
    expect(lastBudgetMode(null, { ...defaultBudgetUi(), mode: 'upgrade' })).toBe('full');
    expect(lastBudgetMode(pc, defaultBudgetUi())).toBe('upgrade');
    expect(lastBudgetMode(null, defaultBudgetUi())).toBe('full');
  });
});

describe('montar pelo orçamento: ajustes da tela', () => {
  const part = (slot: string, specs: Offer['specs'], offers = [offer('s1', slot, slot, 100, specs)]) => ({ offer: offers[0]!, offers, price: 100 });

  it('lembra o tipo de trabalho e só o envia fora de Jogos', () => {
    expect(sanitizeBudgetUi({ workload: 'gpu' }).workload).toBe('gpu');
    expect(sanitizeBudgetUi({ workload: 'outro' }).workload).toBeUndefined();
    expect(budgetRequest(5000, { res: '1080p', profile: 'productivity', workload: 'gpu' })).toMatchObject({ workload: 'gpu' });
    expect(budgetRequest(5000, { res: '1080p', profile: 'games', workload: 'gpu' })).not.toHaveProperty('workload');
  });

  it('dá nome à opção pelo que ela compra, mesmo sem processador nem placa de vídeo', () => {
    const base = { total: 100, fps: 1, notes: [], issues: [] };
    expect(optionHeadline({ ...base, parts: { gpu: part('gpu', { gpuModel: 'RTX 5070', vram: 12 }) } } as never)).toBe('RTX 5070 12 GB');
    expect(optionHeadline({ ...base, parts: { ssd: part('ssd', {}), psu: part('psu', {}) } } as never)).toBe('Fonte + SSD');
    expect(optionHeadline({ ...base, parts: {} } as never)).toBe('Sem peças novas');
  });

  it('guarda o último resultado de cada aba sem misturar as abas', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
    try {
      const chosen = { ...offer('s1', 'a', 'RTX 5070', 3000, { gpuModel: 'RTX 5070' }), productKey: 'gpu:1' };
      const sameProduct = { ...offer('s2', 'b', 'RTX 5070', 3100, { gpuModel: 'RTX 5070' }), productKey: 'gpu:1' };
      const plan = { status: 'ok', budget: 4000, total: 3000, fps: 1, notes: [], issues: [], alternatives: [], parts: { gpu: { offer: chosen, offers: [chosen, sameProduct], price: 3000 } } } as unknown as BudgetPlan;
      saveBudgetResult('full', { at: 1, plan });
      saveBudgetResult('upgrade', { at: 2, plan });
      expect(loadBudgetResult('full')?.plan.parts.gpu!.offers).toHaveLength(2);
      values.set('upgradezin.budget.result.v1', JSON.stringify({ full: { at: 1, plan: { ...plan, filler: 'x'.repeat(500_000) } } }));
      saveBudgetResult('upgrade', { at: 3, plan: { ...plan, filler: 'x'.repeat(500_000) } as BudgetPlan });
      expect(loadBudgetResult('upgrade')).toBeUndefined();
      values.set('upgradezin.budget.result.v1', JSON.stringify({ full: { at: 1, plan }, upgrade: { at: 2, plan } }));
      saveBudgetResult('full', undefined);
      expect(loadBudgetResult('full')).toBeUndefined();
      expect(loadBudgetResult('upgrade')?.at).toBe(2);
      values.set('upgradezin.budget.result.v1', '{"full":{"at":"ontem"}}');
      expect(loadBudgetResult('full')).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mostra a data do resultado no horário de Brasília', () => {
    expect(resultDate(Date.UTC(2026, 10, 25, 17, 30))).toBe('25/11 às 14:30');
  });
});
