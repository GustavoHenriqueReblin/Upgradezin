import type { Offer, Specs } from '@upgradezin/shared';
import { describe, expect, it } from 'vitest';
import { budgetOffers, budgetPlan } from './budget.ts';
import { openDb } from './db/db.ts';
import { saveCollection } from './prices/prices.ts';

let n = 0;
const offer = (specs: Specs, priceCash: number): Offer =>
  ({ store: 's1', storeSku: String(++n), title: `Peça ${n}`, url: `https://x.example/${n}`, priceCash, inStock: true, specs, modelKey: `m${n}`, collectedAt: '' }) as Offer;

const catalog: Record<string, Offer[]> = {
  cpu: [offer({ cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '5600', socket: 'AM4', tdp: 65, cooler: true }, 700)],
  motherboard: [offer({ socket: 'AM4', chipset: 'B550', memory: 'ddr4', formFactor: 'matx' }, 600)],
  ram: [offer({ memory: 'ddr4', ramCapacity: 32, ramModules: 2, ramSpeed: 3200 }, 500)],
  gpu: [offer({ gpuMaker: 'nvidia', gpuModel: 'RTX 3060' }, 1800)],
  psu: [offer({ watts: 550, efficiency: 'bronze' }, 250)],
  ssd: [offer({ ssdInterface: 'nvme', ssdCapacity: 1000 }, 350)],
  cooler: [],
  case: [offer({ caseFormFactor: 'matx', caseFans: 1 }, 150)],
};

describe('POST /api/budget/plan', () => {
  it('só usa preço histórico no PC ideal e não o devolve como oferta', () => {
    const gpu = { ...catalog.gpu![0]!, inStock: false, priceCash: 0, reference: { price: 1800, at: '2026-11-20T10:00:00Z' } };
    const offers = (slot: string) => slot === 'gpu' ? [gpu] : catalog[slot] ?? [];
    const ideal = budgetPlan({ budget: 5000, res: '1080p', mode: 'ideal' }, offers);
    const buyable = budgetPlan({ budget: 5000, res: '1080p', mode: 'buyable' }, offers);
    expect(ideal).toMatchObject({ ok: true, plan: { status: 'ok', mode: 'ideal', parts: { gpu: { price: 1800, offers: [], reference: gpu.reference, offer: { inStock: false } } } } });
    expect(buyable).toMatchObject({ ok: true, plan: { status: 'no-data', mode: 'buyable' } });
  });

  it('lê estoque recente e último preço em estoque do banco existente', () => {
    const db = openDb(':memory:');
    try {
      const old = offer({ gpuModel: 'RTX 4070' }, 2000);
      const sold = offer({ gpuModel: 'RTX 4060' }, 1500);
      const fresh = offer({ gpuModel: 'RTX 3060' }, 1000);
      const save = (at: string, ...offers: Offer[]) => saveCollection(db, { store: 's1', category: 'gpu', offers, at });
      save('2026-11-20T10:00:00.000Z', old, sold);
      save('2026-11-24T09:00:00.000Z', { ...sold, inStock: false, priceCash: 0 }, fresh);
      const now = Date.parse('2026-11-24T10:00:00.000Z');
      expect(budgetOffers(db, 'gpu', 'buyable', ['s1'], now).map((o) => o.storeSku)).toEqual([fresh.storeSku]);
      const ideal = budgetOffers(db, 'gpu', 'ideal', ['s1'], now);
      expect(ideal.find((o) => o.storeSku === old.storeSku)).toMatchObject({ inStock: false, priceCash: 0, reference: { price: 2000 } });
      expect(ideal.find((o) => o.storeSku === sold.storeSku)).toMatchObject({ inStock: false, priceCash: 0, reference: { price: 1500 } });
      expect(ideal.find((o) => o.storeSku === fresh.storeSku)).toMatchObject({ inStock: true, priceCash: 1000 });
    } finally {
      db.close();
    }
  });

  it('monta com as ofertas de cada peça', () => {
    const r = budgetPlan({ budget: 5000, res: '1080p' }, (s) => catalog[s] ?? []);
    expect(r.ok && r.plan.status).toBe('ok');
    expect(r.ok && Object.keys(r.plan.parts).sort()).toEqual(['case', 'cpu', 'gpu', 'motherboard', 'psu', 'ram', 'ssd']);
  });

  it('aceita as peças atuais do PC (upgrade) e o desempenho delas', () => {
    const owned = {
      cpu: { specs: { cpuBrand: 'amd', cpuLine: 'Ryzen 5', cpuModel: '3600', socket: 'AM4' }, current: true },
      motherboard: { specs: { socket: 'AM4', chipset: 'B550', memory: 'ddr4', formFactor: 'matx', coolerSockets: ['AM4'] }, current: true },
      gpu: { specs: { gpuModel: 'GTX 1660 Super' }, current: true },
    };
    const r = budgetPlan({ budget: 3000, res: '1080p', hz: 144, owned, current: { cpu: 83, gpu: 63 } }, (s) => catalog[s] ?? []);
    expect(r.ok && r.plan.status).toBe('ok');
  });

  it('recusa pedido fora do formato', () => {
    const offers = () => [];
    expect(budgetPlan({ budget: 50, res: '1080p' }, offers).ok).toBe(false);
    expect(budgetPlan({ budget: 5000, res: '8k' }, offers).ok).toBe(false);
    expect(budgetPlan({ budget: 5000, res: '1080p', mode: 'historical' }, offers).ok).toBe(false);
    expect(budgetPlan({ budget: 5000, res: '1080p', extra: 1 }, offers).ok).toBe(false);
    expect(budgetPlan({ budget: 5000, res: '1080p', owned: { tv: { specs: {} } } }, offers).ok).toBe(false);
    expect(budgetPlan({ budget: 5000, res: '1080p', owned: { cpu: { specs: { title: 'x'.repeat(500) } } } }, offers).ok).toBe(false);
  });
});
