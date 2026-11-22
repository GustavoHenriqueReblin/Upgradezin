import { describe, expect, it } from 'vitest';
import { readSheet, sheetText, type Offer } from '@upgradezin/shared';
import { mapS3Card, parseS3Cards, s3SheetFromHtml } from './s3.ts';
import { COLLECTED_AT, fixture } from './fixtures.ts';

/** A mesma leitura do adapter: os cards a partir do HTML da página. */
const cardsOf = (file: string) => parseS3Cards(fixture(file));
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

describe('S3: ficha técnica da página do produto', () => {
  it('bloco "Especificações Técnicas": rótulo em negrito e valor na linha de baixo viram uma linha só', () => {
    const read = (category: 'gpu' | 'case' | 'cooler', file: string) => readSheet(category, sheetText(s3SheetFromHtml(fixture(file))!));
    expect(read('gpu', 's3-product-gpu.html')).toMatchObject({ chip: 'Arc B570', vramGb: 10, memType: 'GDDR6', busBits: 192, lengthMm: 249, pcie: '4.0 x8', power16Pin: false });
    expect(read('case', 's3-product-case.html')).toMatchObject({ model: 'V1-BK-V1', formFactor: 'Mid Tower', maxGpuMm: 395, radiators: '120,140,240,280,360' });
    expect(read('cooler', 's3-product-cooler.html')).toMatchObject({ model: 'ACFRE00125A', type: 'ar', heightMm: 159, sockets: 'LGA1851,LGA1700,AM5,AM4' });
  });

  it('dois-pontos dentro do rótulo não ficam duplicados', () => {
    const html = '<div id="esptec"><p><strong>Liberação de GPU:&nbsp;&nbsp;</strong><br>até 395 mm</p><p><strong>Modelo</strong><b>:</b><br>V1-BK</p></div>';
    expect(s3SheetFromHtml(html)).toBe('<p><strong>Liberação de GPU:</strong> até 395 mm</p><p><strong>Modelo</strong>: V1-BK</p>');
  });

  it('página sem o bloco: sem ficha', () => {
    expect(s3SheetFromHtml('<html><body><div id="esptec"> </div></body></html>')).toBeNull();
  });
});
