import { describe, expect, it } from 'vitest';
import { groupOffers, mpnFromTitle } from './group.ts';
import type { Offer } from './types.ts';

describe('part number no fim do título (identidade da peça entre lojas)', () => {
  it.each([
    ['Memória DDR4 Synex, 8GB, 3200MHz, Preta, SYDSCD4-3200MHZ-8GB', 'SYDSCD4-3200MHZ-8GB'],
    ['Memória DDR4 Synex, 8GB, 3200MHz, Preta, SYDSCD4-3200MHZ-8GB - Open Box', 'SYDSCD4-3200MHZ-8GB'],
    ['Memória DDR4 Rise Mode Z Series, 8GB, 3200MHz, Preto, RM-D4-8G-3200Z', 'RM-D4-8G-3200Z'],
    ['Placa de Vídeo RX 7600 Challenger ASRock AMD Radeon,  8GB GDDR6 - 90-GA41ZZ-00UANF', '90-GA41ZZ-00UANF'],
    ['Memória Kingston Fury Beast, 8GB, 3200MHz, DDR4, Preto, KF432C16BB/8', 'KF432C16BB/8'],
  ])('"%s" -> %s', (title, mpn) => expect(mpnFromTitle(title)).toBe(mpn));

  it.each([
    'Memória DDR4 Synex, 8GB, 3200MHz, Preto',
    'Fonte MSI MAG A750BN, 750W, 80 Plus Bronze, PFC Ativo',
    'Gabinete Gamer Rise Mode X5, Lateral em Vidro, ARGB',
    'Placa-Mãe MSI B550 Gaming, AMD AM4, ATX, DDR4',
  ])('sem código no fim: "%s"', (title) => expect(mpnFromTitle(title)).toBeUndefined());

  it('o mesmo código em lojas diferentes vira um produto; variante (W = branca) fica separada', () => {
    const o = (store: Offer['store'], sku: string, title: string, mpn?: string): Offer => ({
      store, storeSku: sku, title, url: 'https://x.example', priceCash: 100, inStock: true, seller: 's', marketplace: false, openbox: false,
      specs: {}, modelKey: `ram:${store}:${sku}`, collectedAt: '2026-11-20T00:00:00.000Z', mpn: mpn ?? mpnFromTitle(title),
    });
    const groups = groupOffers([
      o('s2', '1', 'Memória Corsair Vengeance LPX 32GB', 'CMK32GX4M2E3200C16'),
      o('s3', '2', 'Memória Corsair Vengeance LPX, 32GB, 3200MHz, Preta, CMK32GX4M2E3200C16'),
      o('s3', '3', 'Memória Corsair Vengeance LPX, 32GB, 3200MHz, Branca, CMK32GX4M2E3200C16W'),
    ]);
    expect(groups.map((g) => g.offers.map((x) => x.storeSku).sort())).toEqual(expect.arrayContaining([['1', '2'], ['3']]));
  });
});
