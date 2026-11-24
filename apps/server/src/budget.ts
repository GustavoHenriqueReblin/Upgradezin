import { BUILD_SLOTS, planBudget, type BudgetPlan, type BudgetRequest, type BuildSlot, type Offer } from '@upgradezin/shared';
import { z } from 'zod';

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
    owned: z.partialRecord(z.enum(BUILD_SLOTS), Part).optional(),
    current: z.object({ cpu: z.number().positive().max(1000).optional(), gpu: z.number().positive().max(1000).optional() }).strict().optional(),
  })
  .strict();

export type BudgetResult = { ok: true; plan: BudgetPlan } | { ok: false; error: string };

export function budgetPlan(body: unknown, offersOf: (slot: BuildSlot) => Offer[], now = Date.now()): BudgetResult {
  const parsed = BudgetBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const offers = Object.fromEntries(BUILD_SLOTS.map((s) => [s, offersOf(s)])) as Record<BuildSlot, Offer[]>;
  return { ok: true, plan: planBudget(parsed.data as BudgetRequest, offers, now) };
}
