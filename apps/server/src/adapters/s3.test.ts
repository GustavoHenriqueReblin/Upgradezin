import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { mapS3Card, readS3Cards, S3_CARD_SELECTOR } from './s3.ts';
import { COLLECTED_AT, fixture } from './fixtures.ts';

/** Mesma função que roda no navegador, aqui sobre um DOM em Node. */
const cardsOf = (file: string) => {
  const { document } = parseHTML(fixture(file));
  return readS3Cards(Array.from(document.querySelectorAll(S3_CARD_SELECTOR)));
};
const offersOf = (file: string, category: 'psu' | 'motherboard') =>
  cardsOf(file)
    .map((c) => mapS3Card(c, COLLECTED_AT, category))
    .filter((o): o is Offer => !!o);

describe('S3: leitura dos cards', () => {
  it('lê atributos data-tss-* e o DOM do card', () => {
    const cards = cardsOf('s3-psu.html');
    expect(cards).toHaveLength(4);
    expect(cards[2]).toEqual({
      id: '889424',
      brand: 'ASROCK',
      price: '609.99',
      stock: '1',
      title: 'Fonte ASRock PRO Series, 750W, 80 Plus Gold, Cybenetics Gold, Full Modular, ATX 3.1, PCIe 5.1, Preto, PRO-M750G',
      href: '/produto/42489/fonte-asrock-pro-series-750w-80-plus-gold-cybenetics-gold-full-modular-atx-31-pcie-51-preto-pro-m750g',
      img: expect.stringMatching(/^https:\/\/img\.s3\.example\//),
      oldPrice: 'R$ 919,99',
      instCount: '12x',
      instValue: 'R$ 59,81',
      coupon: 'Cupom 10% OFF',
    });
  });
});

describe('S3: fonte', () => {
  const offers = offersOf('s3-psu.html', 'psu');
  const byId = (id: string) => offers.find((o) => o.storeSku === id)!;

  it('usa o id do link como SKU e calcula o total no cartão', () => {
    expect(byId('42489')).toMatchObject({
      store: 's3',
      brand: 'ASRock',
      priceCash: 609.99,
      priceCard: 717.72,
      listPrice: 919.99,
      installments: { count: 12, value: 59.81 },
      coupon: { percent: 10 },
      url: expect.stringMatching(/^https:\/\/www\.s3\.example\/produto\/42489\//),
    });
  });

  it('esgotado: sem estoque e sem parcelamento', () => {
    expect(byId('20583')).toMatchObject({ inStock: false, installments: undefined, priceCard: undefined });
  });

  it('extrai specs do título', () => {
    expect(byId('42121').specs).toEqual({ watts: 750, efficiency: 'gold', efficiencyCert: '80plus', modular: 'full', atx: '3.1' });
  });
});

describe('S3: placa-mãe', () => {
  const offers = offersOf('s3-motherboard.html', 'motherboard');

  it('formato pelo sufixo M do modelo, mesmo com "ATX" errado no título', () => {
    expect(offers.find((o) => o.storeSku === '16145')!.specs.formFactor).toBe('matx');
  });

  it('cupom de 5%', () => {
    expect(offers.find((o) => o.storeSku === '20595')!.coupon).toEqual({ percent: 5 });
  });
});

describe('S3: produto aberto', () => {
  it('"OPEN BOX" no título marca como produto aberto', () => {
    const card = cardsOf('s3-motherboard.html')[0]!;
    const asNew = mapS3Card(card, COLLECTED_AT, 'motherboard')!;
    const open = mapS3Card({ ...card, title: `${card.title} - OPEN BOX` }, COLLECTED_AT, 'motherboard')!;
    expect(asNew.openbox).toBe(false);
    expect(open.openbox).toBe(true);
  });
});
