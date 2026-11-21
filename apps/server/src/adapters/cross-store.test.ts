import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { effectiveCash, groupOffers, type CategoryId, type Offer } from '@upgradezin/shared';
import { mapS1Product, parseS1Html } from './s1.ts';
import { mapS2Item, parseS2Rsc, rscFromHtml } from './s2.ts';
import { mapS3Card, readS3Cards, S3_CARD_SELECTOR } from './s3.ts';
import { COLLECTED_AT, fixture } from './fixtures.ts';

function allOffers(category: CategoryId, suffix: string): Offer[] {
  const s1 = parseS1Html(fixture(`s1-${suffix}.html`)).data.map((p) => mapS1Product(p, COLLECTED_AT, category));
  const s2 = parseS2Rsc(rscFromHtml(fixture(`s2-${suffix}.html`))).items.map((it) => mapS2Item(it, COLLECTED_AT, category));
  const { document } = parseHTML(fixture(`s3-${suffix}.html`));
  const s3 = readS3Cards(Array.from(document.querySelectorAll(S3_CARD_SELECTOR))).map((c) => mapS3Card(c, COLLECTED_AT, category));
  return [...s1, ...s2, ...s3].filter((o): o is Offer => !!o);
}

describe('Três lojas juntas', () => {
  for (const [category, suffix] of [['psu', 'psu'], ['motherboard', 'motherboard']] as const) {
    it(`${suffix}: toda oferta tem o mínimo para aparecer na tela`, () => {
      const offers = allOffers(category, suffix);
      expect(offers.length).toBeGreaterThanOrEqual(10);
      for (const o of offers) {
        expect(o.priceCash, o.title).toBeGreaterThan(0);
        expect(effectiveCash(o), o.title).toBeLessThanOrEqual(o.priceCash);
        expect(o.url, o.title).toMatch(/^https:\/\/www\.(s1|s2|s3)\.example\//);
        expect(o.modelKey, o.title).not.toBe('');
        expect(o.title).not.toBe('');
      }
    });
  }

  it('o mesmo modelo em lojas diferentes vira um produto só', () => {
    const groups = groupOffers(allOffers('motherboard', 'motherboard'));
    const msi = groups.find((g) => g.key === 'msi b550 gaming wifi6e')!;
    expect(msi.offers.map((o) => o.store).sort()).toEqual(['s1', 's2']);
    // Melhor oferta: em estoque e menor preço à vista com cupom.
    expect(msi.best.store).toBe('s1');
  });
});
