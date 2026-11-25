import { BUILD_SLOTS, MAX_BUILD_DRIVES, planBudget, type BudgetMode, type BudgetOffer, type BudgetPlan, type BudgetRequest, type BuildSlot, type StoreId } from '@upgradezin/shared';
import { z } from 'zod';
import type { Db } from './db/db.ts';
import { applySheets } from './prices/offer-sheets.ts';
import { NOT_BROKEN } from './prices/page-errors.ts';

/**
 * Montar pelo orçamento (POST /api/budget/plan): valida o pedido e roda o motor (packages/shared/src/budget.ts)
 * sobre as ofertas de agora de cada peça, com a ficha. As peças atuais (upgrade) vêm do navegador: specs
 * lidas do relatório do CPU-Z, nunca o arquivo.
 */

const Part = z
  .object({
    specs: z.record(z.string().max(40), z.union([z.string().max(100), z.number(), z.boolean(), z.array(z.string().max(20)).max(20), z.array(z.number()).max(20)])),
    qty: z.number().int().min(1).max(8).optional(),
    current: z.boolean().optional(),
  })
  .strict();

export const BudgetBody = z
  .object({
    budget: z.number().min(100).max(1_000_000),
    res: z.enum(['1080p', '1440p', '4k']),
    hz: z.number().int().min(30).max(1000).optional(),
    mode: z.enum(['buyable', 'ideal']).optional(),
    profile: z.enum(['games', 'mixed', 'productivity']).optional(),
    graphics: z.enum(['integrated', 'dedicated']).optional(),
    workload: z.enum(['cpu', 'gpu']).optional(),
    requiredBrands: z.object({ cpu: z.enum(['amd', 'intel']).optional(), gpu: z.enum(['amd', 'intel', 'nvidia']).optional() }).strict().optional(),
    preferences: z.object({ cpu: z.enum(['amd', 'intel']).optional(), gpu: z.enum(['amd', 'intel', 'nvidia']).optional() }).strict().optional(),
    owned: z.object(Object.fromEntries(BUILD_SLOTS.map((slot) => [slot, Part.optional()])) as Record<BuildSlot, z.ZodOptional<typeof Part>>)
      .extend({ extraDrives: z.array(Part).max(MAX_BUILD_DRIVES - 1).optional() }).strict().optional(),
    current: z.object({ cpu: z.number().positive().max(1000).optional(), gpu: z.number().positive().max(1000).optional() }).strict().optional(),
  })
  .strict();

export type BudgetResult = { ok: true; plan: BudgetPlan } | { ok: false; error: string };

export function budgetPlan(body: unknown, offersOf: (slot: BuildSlot, mode: BudgetMode, now: number) => BudgetOffer[], now = Date.now()): BudgetResult {
  const parsed = BudgetBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const offers = Object.fromEntries(BUILD_SLOTS.map((s) => [s, offersOf(s, parsed.data.mode ?? 'buyable', now)])) as Record<BuildSlot, BudgetOffer[]>;
  return { ok: true, plan: planBudget(parsed.data as BudgetRequest, offers, now) };
}

const DAY = 86_400_000;
const REFERENCE_DAYS = 90;

/** Lê o estado do anúncio e o último preço registrado enquanto estava em estoque. */
export function budgetOffers(db: Db, slot: BuildSlot, mode: BudgetMode, stores: readonly StoreId[], now: number): BudgetOffer[] {
  const liveSince = new Date(now - DAY).toISOString();
  const since = mode === 'ideal' ? new Date(now - REFERENCE_DAYS * DAY).toISOString() : liveSince;
  const history = mode === 'ideal'
    ? `LEFT JOIN price_points p ON p.listing_id = listings.id AND p.at = (
        SELECT max(h.at) FROM price_points h WHERE h.listing_id = listings.id AND h.in_stock = 1 AND h.effective_cash > 0
      )`
    : '';
  const rows = db.prepare(`
    SELECT listings.offer, listings.last_seen_at, ${mode === 'ideal'
      ? 'p.effective_cash AS price, p.at AS price_at'
      : 'NULL AS price, NULL AS price_at'}
    FROM listings ${history}
    WHERE listings.category = ? AND listings.last_seen_at >= ? AND ${NOT_BROKEN}
  `).all(slot, since) as { offer: string; last_seen_at: string; price: number | null; price_at: string | null }[];
  const offers: BudgetOffer[] = [];
  for (const row of rows) {
    const offer = JSON.parse(row.offer) as BudgetOffer;
    if (offer.inStock === true && row.last_seen_at >= liveSince && stores.includes(offer.store) && Number.isFinite(offer.priceCash) && offer.priceCash > 0) {
      offers.push({ ...offer, collectedAt: row.last_seen_at });
    } else if (mode === 'ideal' && row.price !== null && row.price_at && row.price_at >= since) {
      offers.push({ ...offer, inStock: false, priceCash: 0, priceCard: undefined, coupon: undefined, promo: undefined, reference: { price: row.price, at: row.price_at } });
    }
  }
  return applySheets(db, slot, offers, now, mode === 'ideal' ? REFERENCE_DAYS : 30);
}
