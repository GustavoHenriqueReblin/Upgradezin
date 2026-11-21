import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { BUILD_SLOTS, STORES, type Offer } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';

/**
 * Montagens compartilhadas por link (/m/<id>). A montagem continua no navegador de quem
 * monta; "Compartilhar" grava uma cópia aqui. Sem login: quem tem o link vê.
 */

/** Link só com http(s): o valor vai para href/src na página de quem abrir. */
const httpsUrl = z
  .string()
  .max(1000)
  .refine((u) => /^https:\/\//i.test(u), 'URL inválida');

const OfferSchema = z
  .object({
    store: z.enum(STORES),
    storeSku: z.string().max(64),
    title: z.string().max(400),
    url: httpsUrl,
    image: httpsUrl.optional(),
    priceCash: z.number().nonnegative().max(1_000_000),
    collectedAt: z.string().max(40),
  })
  .passthrough();

const ItemSchema = z.object({
  key: z.string().max(400),
  title: z.string().max(400),
  brand: z.string().max(100).optional(),
  image: httpsUrl.optional(),
  specs: z.record(z.string(), z.unknown()),
  offers: z.array(OfferSchema).max(12),
  qty: z.number().int().min(1).max(4).optional(),
  /** Peça que a pessoa já tem (importada do CPU-Z): sem ofertas, fora do total. */
  current: z.literal(true).optional(),
});

export const SharedBuildSchema = z
  .object(Object.fromEntries(BUILD_SLOTS.map((s) => [s, ItemSchema.optional()])) as Record<(typeof BUILD_SLOTS)[number], z.ZodOptional<typeof ItemSchema>>)
  .refine((b) => Object.values(b).some(Boolean), 'Montagem vazia');

export type SharedBuildData = z.infer<typeof SharedBuildSchema>;

/** Código curto (8 caracteres, letras e números): 62⁸ combinações, impossível de adivinhar na prática. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function newBuildId(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const BUILD_ID = /^[A-Za-z0-9]{6,16}$/;

const hashOf = (json: string) => createHash('sha256').update(json).digest('hex');

/** Link já criado para exatamente esta montagem (compartilhar de novo não cria outro). */
export function findSharedBuild(db: Db, data: SharedBuildData): string | null {
  const row = db.prepare('SELECT id FROM shared_builds WHERE hash = ? LIMIT 1').get(hashOf(JSON.stringify(data))) as { id: string } | undefined;
  return row?.id ?? null;
}

export function saveSharedBuild(db: Db, data: SharedBuildData, now = new Date().toISOString()): string {
  const json = JSON.stringify(data);
  const existing = findSharedBuild(db, data);
  if (existing) return existing;
  const ins = db.prepare('INSERT INTO shared_builds (id, data, created_at, hash) VALUES (?, ?, ?, ?)');
  for (;;) {
    const id = newBuildId();
    try {
      ins.run(id, json, now, hashOf(json));
      return id;
    } catch (err) {
      if (!String(err).includes('UNIQUE')) throw err; // colisão: tenta outro código
    }
  }
}

/**
 * Montagem salva, com as ofertas trocadas pela versão mais recente que o banco tiver
 * (mesmo anúncio, coletado depois): quem abre o link vê o preço de hoje, não o do dia em que salvou.
 */
export function getSharedBuild(db: Db, id: string): { build: SharedBuildData; createdAt: string } | null {
  const row = db.prepare('SELECT data, created_at FROM shared_builds WHERE id = ?').get(id) as { data: string; created_at: string } | undefined;
  if (!row) return null;
  const build = JSON.parse(row.data) as SharedBuildData;
  const latest = db.prepare('SELECT offer FROM listings WHERE store = ? AND store_sku = ?');
  for (const item of Object.values(build)) {
    if (!item) continue;
    item.offers = item.offers.map((o) => {
      const r = latest.get(o.store, o.storeSku) as { offer: string } | undefined;
      if (!r) return o;
      const fresh = JSON.parse(r.offer) as Offer;
      return fresh.collectedAt > o.collectedAt ? (fresh as unknown as typeof o) : o;
    });
  }
  return { build, createdAt: row.created_at };
}
