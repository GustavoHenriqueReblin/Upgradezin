import { describe, expect, it } from 'vitest';
import { alertPrice, alertText, evaluateAlert, notificationText, type PriceAlert } from './alerts.ts';
import type { Offer } from './types.ts';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const base = { key: 'gpu:1', category: 'gpu' as const, title: 'Placa RTX 5060', createdAt: 1, armed: true };
const offer = (priceCash: number, extra: Partial<Offer> = {}) => ({ store: 's1', storeSku: '1', title: 'x', url: 'https://s1.example/1', priceCash, inStock: true, ...extra }) as Offer;

describe('regras do alerta de preço', () => {
  it('preço de agora: a oferta mais barata em estoque das próprias lojas', () => {
    expect(alertPrice([offer(2000), offer(1500, { inStock: false }), offer(1200, { marketplace: true } as Partial<Offer>), offer(1900)])).toBe(1900);
    expect(alertPrice([offer(1500, { inStock: false })])).toBeUndefined();
  });

  it('preço-alvo avisa uma vez e só rearma quando o preço sobe acima do alvo', () => {
    const alert: PriceAlert = { ...base, kind: 'target', target: 2000 };
    const above = evaluateAlert(alert, 2100, 10);
    expect(above).toEqual({ alert: { ...alert, price: 2100, checkedAt: 10 } });
    const hit = evaluateAlert(above.alert, 1950, 20);
    expect(hit.fired).toEqual({ price: 1950, reference: 2000 });
    expect(hit.alert.armed).toBe(false);
    expect(evaluateAlert(hit.alert, 1900, 30).fired).toBeUndefined(); // continua abaixo: não repete
    const rearmed = evaluateAlert(hit.alert, 2100, 40).alert;
    expect(rearmed.armed).toBe(true);
    expect(evaluateAlert(rearmed, 1990, 50).fired).toEqual({ price: 1990, reference: 2000 });
  });

  it('qualquer queda: o preço avisado vira a nova referência; sem estoque não é queda', () => {
    const alert: PriceAlert = { ...base, kind: 'drop', base: 2000 };
    expect(evaluateAlert(alert, 2000, 1).fired).toBeUndefined();
    expect(evaluateAlert(alert, undefined, 1).fired).toBeUndefined();
    const hit = evaluateAlert(alert, 1800, 2);
    expect(hit.fired).toEqual({ price: 1800, reference: 2000 });
    expect(hit.alert.base).toBe(1800);
    expect(evaluateAlert(hit.alert, 1800, 3).fired).toBeUndefined();
    expect(evaluateAlert(hit.alert, 1750, 4).fired).toEqual({ price: 1750, reference: 1800 });
  });

  it('voltou ao estoque avisa ao ter preço e rearma quando esgota de novo', () => {
    const alert: PriceAlert = { ...base, kind: 'stock' };
    const out = evaluateAlert(alert, undefined, 1);
    expect(out.fired).toBeUndefined();
    expect(out.alert.price).toBeUndefined();
    const back = evaluateAlert(out.alert, 2500, 2);
    expect(back.fired).toEqual({ price: 2500 });
    expect(evaluateAlert(back.alert, 2400, 3).fired).toBeUndefined();
    expect(evaluateAlert(evaluateAlert(back.alert, undefined, 4).alert, 2600, 5).fired).toEqual({ price: 2600 });
  });

  it('textos do que espera e do que aconteceu', () => {
    expect(alertText({ kind: 'target', target: 1500 })).toBe(`Avisa quando chegar a ${brl(1500)}.`);
    expect(alertText({ kind: 'drop', base: 1800 })).toBe(`Avisa quando baixar de ${brl(1800)}.`);
    expect(alertText({ kind: 'stock' })).toBe('Avisa quando voltar ao estoque.');
    expect(notificationText({ kind: 'target', price: 1899, reference: 2000 })).toBe(`Chegou a ${brl(1899)} (seu alvo: ${brl(2000)}).`);
    expect(notificationText({ kind: 'drop', price: 1800, reference: 2000 })).toBe(`Baixou para ${brl(1800)} (era ${brl(2000)}).`);
    expect(notificationText({ kind: 'stock', price: 2500 })).toBe(`Voltou ao estoque por ${brl(2500)}.`);
  });
});
