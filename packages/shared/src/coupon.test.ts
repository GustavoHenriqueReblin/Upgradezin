import { describe, expect, it } from 'vitest';
import { couponApplies, effectiveCash, parseCouponConditions, parseCouponText } from './types.ts';

describe('cupom', () => {
  it.each([
    ['Use o cupom CODIGO e ganhe 10% OFF neste item', { percent: 10 }],
    ['Cupom 5% OFF', { percent: 5 }],
    ['PROMO10OFF', { percent: 10 }],
    ['Use o cupom XYZ e ganhe R$ 50 OFF', { amount: 50 }],
  ])('lê "%s"', (t, exp) => expect(parseCouponText(t)).toEqual(exp));

  it('texto sem desconto não vira cupom', () => expect(parseCouponText('CUPOM CODIGO')).toBeNull());

  it('aplica sobre o preço à vista (caso real: 672,99 com 10% = 605,69)', () => {
    expect(effectiveCash({ priceCash: 672.99, coupon: { code: 'CODIGO', percent: 10 } })).toBe(605.69);
    expect(effectiveCash({ priceCash: 500, coupon: { amount: 50 } })).toBe(450);
    expect(effectiveCash({ priceCash: 500, coupon: { code: 'X' } })).toBe(500);
  });
});

describe('condições do cupom', () => {
  const NOW = new Date('2026-11-20T12:00:00-03:00');
  it('lê "limitados", valor mínimo, validade e PIX do texto da loja', () => {
    expect(parseCouponConditions('Use o cupom BLACKXPG15OFF e ganhe 15% OFF neste item, corre que os cupons são limitados. *Consulte condições completas.', NOW)).toEqual({ limited: true });
    expect(parseCouponConditions('Cupom 10% OFF em compras acima de R$ 1.500,00, válido até 24/11, somente no PIX', NOW)).toEqual({
      minTotal: 1500,
      endsAt: '2026-11-25T02:59:59.000Z',
      cashOnly: true,
    });
    expect(parseCouponConditions('válido até 05/01', NOW).endsAt).toBe('2027-01-06T02:59:59.000Z'); // dd/mm já passado: ano que vem
    expect(parseCouponConditions('ganhe 10% OFF neste item', NOW)).toEqual({});
  });
  it('cupom só vale para o preço que atinge o mínimo e enquanto não vence', () => {
    const now = NOW.getTime();
    const c = { code: 'X', percent: 10, minTotal: 1000 };
    expect(effectiveCash({ priceCash: 900, coupon: c }, now)).toBe(900);
    expect(effectiveCash({ priceCash: 1200, coupon: c }, now)).toBe(1080);
    const expired = { code: 'Y', percent: 10, endsAt: '2026-11-19T02:59:59.000Z' };
    expect(couponApplies({ priceCash: 500, coupon: expired }, now)).toBe(false);
    expect(effectiveCash({ priceCash: 500, coupon: expired }, now)).toBe(500);
  });
});
