import { describe, expect, it } from 'vitest';
import { parseCpuzReport, type BudgetPlan, type Offer } from '@upgradezin/shared';
import amd from '../../../packages/shared/fixtures/cpuz/amd-am4-rx6600.txt?raw';
import type { BuildItem } from './build.ts';
import { BUDGET_VISIBLE, budgetRequest, defaultBudgetUi, formatBudget, lastBudgetMode, optionLabels, optionsOf, ownedBuild, parseBudget, planToBuild, sanitizeBudgetUi, stretchGain } from './budget.ts';

const pc = parseCpuzReport(amd)!;
const offer = (store: Offer['store'], sku: string, title: string, priceCash: number, specs: Offer['specs']): Offer =>
  ({ store, storeSku: sku, title, url: `https://${store}.example/${sku}`, priceCash, inStock: true, specs, modelKey: 'rtx5070', productKey: 'p1', collectedAt: '' }) as Offer;

describe('montar pelo orçamento: tela', () => {
  it('deixa habilitada a opção de montar pelo orçamento', () => {
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

  it('as peças atuais: as do relatório e a fonte marcada como "Já Tenho"; o pedido leva só as specs', () => {
    const psu: BuildItem = { key: 'psu', title: 'Fonte 650W', specs: { watts: 650 }, offers: [], current: true };
    const owned = ownedBuild(pc, { psu });
    expect(Object.keys(owned).sort()).toEqual(['cpu', 'extraDrives', 'gpu', 'motherboard', 'psu', 'ram', 'ssd']);
    const req = budgetRequest(3000, { res: '1440p', hz: 144 }, owned, { cpu: 132, gpu: 95 });
    expect(req).toMatchObject({ budget: 3000, res: '1440p', hz: 144, current: { cpu: 132, gpu: 95 } });
    expect(req.owned?.psu).toEqual({ specs: { watts: 650 }, qty: 1, current: true });
    expect(req.owned?.extraDrives).toHaveLength(2);
    expect(req.owned?.extraDrives?.[1]).toEqual({ specs: { ssdCapacity: 932, ssdInterface: 'nvme' }, current: true });
    expect(JSON.stringify(req)).not.toContain('Fonte 650W');
    // Fonte comprada numa loja (não "Já Tenho") não conta como do PC.
    expect(ownedBuild(pc, { psu: { ...psu, current: undefined } }).psu).toBeUndefined();
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
    expect(optionLabels([o(6000, 100), o(9000, 120)])).toEqual(['Recomendada no valor · Melhor custo-benefício', 'Maior Desempenho no Valor']);
    expect(stretchGain(o(12000, 230, true), o(10000, 200))).toBe(15);
    expect(stretchGain(o(12000, 230, true), o(10000, 0))).toBeUndefined();
  });

  it('o plano vira montagem: a peça comprada com as ofertas de todas as lojas, as atuais que ficam continuam', () => {
    const specs = { gpuMaker: 'nvidia', gpuModel: 'RTX 5070' } as const;
    const offers = [offer('s1', '1', 'Placa de Vídeo RTX 5070 12GB', 4200, specs), offer('s2', '9', 'Placa de Vídeo RTX 5070 12GB', 4000, specs)];
    const plan: BudgetPlan = { status: 'ok', budget: 4500, parts: { gpu: { price: 4000, offer: offers[1]!, offers } }, total: 4000, fps: 100, notes: [], issues: [], alternatives: [] };
    const b = planToBuild(plan, ownedBuild(pc, {}));
    expect(b.gpu).toMatchObject({ title: 'Placa de Vídeo RTX 5070 12GB' });
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
