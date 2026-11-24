import {
  BUILD_SLOTS,
  checkBuild,
  effectiveCash,
  PSU_POWERS,
  SOCKET_MEMORY,
  STORES,
  worst,
  type Build,
  type BuildIssue,
  type BuildSlot,
  type Offer,
  type PartStatus,
  type PcPart,
  type ProductGroup,
  type Specs,
  type StoreId,
} from '@upgradezin/shared';
import { DEFAULT_FILTERS, type Filters } from './filters.ts';

/**
 * Montagem do PC (docs/ARCHITECTURE.md §17.1): peças escolhidas, totais, pré-filtro
 * da busca de cada peça e compatibilidade de cada candidata. Fica só no navegador.
 */

/** Peça escolhida: o produto como estava no resultado (ofertas de cada loja na hora da escolha). */
export interface BuildItem {
  key: string;
  title: string;
  brand?: string;
  image?: string;
  specs: Specs;
  offers: Offer[];
  /** Unidades (só memória, ver QTY_SLOTS). Ausente = 1. */
  qty?: number;
  /** Peça que a pessoa já tem (importada do CPU-Z): sem ofertas, conta na compatibilidade e fica fora do total. */
  current?: true;
}

/** Peças que aceitam quantidade: memória (pentes avulsos iguais, ex. 2× 8 GB). */
export const QTY_SLOTS: readonly BuildSlot[] = ['ram'];
export const MAX_QTY = 4;
export const qtyOf = (i: BuildItem) => Math.min(MAX_QTY, Math.max(1, Math.floor(i.qty ?? 1)));

export type SavedBuild = Partial<Record<BuildSlot, BuildItem>>;

export const itemFromGroup = (g: ProductGroup): BuildItem => ({
  key: g.key,
  title: g.title,
  brand: g.brand,
  image: g.image,
  specs: g.specs,
  offers: g.offers,
});

/** Peça atual lida do relatório do CPU-Z. */
export const itemFromPc = (slot: BuildSlot, p: PcPart): BuildItem => ({
  key: `pc:${slot}`,
  title: p.title,
  brand: p.brand,
  specs: p.specs,
  offers: [],
  current: true,
});

export function toBuild(b: SavedBuild): Build {
  const out: Build = {};
  for (const slot of BUILD_SLOTS) if (b[slot]) out[slot] = { specs: b[slot]!.specs, qty: qtyOf(b[slot]!), ...(b[slot]!.current && { current: true }) };
  return out;
}

const cheapest = (offers: Offer[]) => [...offers].sort((a, b) => effectiveCash(a) - effectiveCash(b))[0];

/** Melhor oferta da peça: a mais barata em estoque (ou a mais barata, se nenhuma tiver estoque). */
export function bestOffer(item: BuildItem): Offer | undefined {
  return cheapest(item.offers.filter((o) => o.inStock)) ?? cheapest(item.offers);
}

export interface BuildTotals {
  /** Soma da melhor oferta de cada peça (cada uma na loja mais barata). */
  best: number;
  /** Comprando tudo numa loja só: soma do que ela tem em estoque e quantas peças faltam lá. */
  perStore: { store: StoreId; total: number; missing: number }[];
  /** Peças a comprar (as atuais ficam de fora). */
  parts: number;
  /** Peças que a pessoa já tem. */
  current: number;
}

export function buildTotals(b: SavedBuild): BuildTotals {
  const all = BUILD_SLOTS.map((s) => b[s]).filter((i): i is BuildItem => !!i);
  const items = all.filter((i) => !i.current);
  const best = items.reduce((sum, i) => sum + (bestOffer(i) ? effectiveCash(bestOffer(i)!) * qtyOf(i) : 0), 0);
  const perStore = STORES.map((store) => {
    let total = 0;
    let missing = 0;
    for (const i of items) {
      const o = cheapest(i.offers.filter((x) => x.store === store && x.inStock));
      if (o) total += effectiveCash(o) * qtyOf(i);
      else missing++;
    }
    return { store, total, missing };
  }).filter((s) => s.missing < items.length);
  return { best: Math.round(best * 100) / 100, perStore, parts: items.length, current: all.length - items.length };
}

export { PSU_POWERS };

/**
 * Filtros iniciais da busca de uma peça, a partir do que já está na montagem:
 * placa-mãe AM4 → processador AM4; placa DDR4 → memória DDR4; consumo → potências de fonte.
 * Só o que define a busca; o resto a compatibilidade marca no resultado.
 */
export function slotFilters(slot: BuildSlot, b: SavedBuild, base: Filters = DEFAULT_FILTERS): Filters {
  const mb = b.motherboard?.specs;
  const cpu = b.cpu?.specs;
  const f: Filters = { ...base };
  if (slot === 'cpu' && mb?.socket) f.sockets = [mb.socket];
  if (slot === 'motherboard' && cpu?.socket) f.sockets = [cpu.socket];
  if (slot === 'ram') {
    const memory = mb?.memory ?? (cpu?.socket && SOCKET_MEMORY[cpu.socket].length === 1 ? SOCKET_MEMORY[cpu.socket][0] : undefined);
    if (memory) f.memory = [memory];
  }
  if (slot === 'case' && mb?.formFactor) f.caseFormFactors = [mb.formFactor];
  if (slot === 'psu') {
    const power = checkBuild(toBuild(b)).power;
    if (power) f.watts = PSU_POWERS.filter((w) => w >= power.recommended).slice(0, 3);
  }
  return f;
}

export interface CandidateCheck {
  status: PartStatus;
  /** Problemas que envolvem a peça candidata, do mais grave ao mais leve. */
  issues: BuildIssue[];
}

const ORDER: Record<BuildIssue['level'], number> = { error: 0, warn: 1, unknown: 2, info: 3 };

/** Como a peça ficaria na montagem: as outras peças continuam, esta entra no lugar da atual. */
/**
 * "Confira a medida" num card de resultado é ruído (a medida vem da ficha, que nem sempre a tem).
 * Na montagem a observação aparece. Medida que a ficha tem e não cabe aparece no card como erro.
 */
const NOT_MEASURED_YET = new Set(['case-gpu-unknown', 'case-cooler-unknown']);

export function checkCandidate(b: SavedBuild, slot: BuildSlot, specs: Specs): CandidateCheck {
  const r = checkBuild({ ...toBuild(b), [slot]: { specs } });
  const issues = r.issues
    .filter((i) => i.parts.includes(slot) && !NOT_MEASURED_YET.has(i.code))
    .sort((x, y) => ORDER[x.level] - ORDER[y.level]);
  return { status: issues.reduce<PartStatus>((s, i) => worst(s, i.level), 'ok'), issues };
}

// ---------- Guardar no navegador ----------

const KEY = 'upgradezin.build.v1';

/** Só peças com o formato esperado (versões antigas, dados corrompidos ou de fora ficam de fora). */
export function sanitizeBuild(parsed: unknown): SavedBuild {
  const src = (parsed ?? {}) as SavedBuild;
  const out: SavedBuild = {};
  for (const slot of BUILD_SLOTS) {
    const i = src[slot];
    if (i && typeof i.title === 'string' && i.specs && Array.isArray(i.offers)) {
      const item: BuildItem = QTY_SLOTS.includes(slot) && i.qty !== undefined ? { ...i, qty: qtyOf(i) } : { ...i, qty: undefined };
      if (item.current !== true) delete item.current;
      out[slot] = item;
    }
  }
  return out;
}

export function loadBuild(): SavedBuild {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeBuild(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

export function saveBuild(b: SavedBuild): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // navegador sem armazenamento: a montagem vale só enquanto a página estiver aberta
  }
}
