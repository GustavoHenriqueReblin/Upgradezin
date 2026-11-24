import { cpuScore, ENABLED_CATEGORIES, gpuPerf, STORES, type CategoryId, type CoverageRow, type Offer, type PerfGap, type StoreId, type TimelineBucket } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { applySheets } from '../prices/offer-sheets.ts';
import { sheetCounts } from '../prices/sheets.ts';
import { inProgress, sweepState } from '../prices/sweep.ts';

/**
 * Processadores e placas de vídeo vistos nas lojas nos últimos `days` dias sem nota de desempenho, do
 * mais anunciado para o menos: placa de vídeo com chip fora da tabela; processador sem nota pela ficha
 * (arquitetura e clock máximo) nem pela tabela. Conta na hora, do banco, com a ficha de cada produto.
 */
export function perfGaps(db: Db, now = Date.now(), days = 14): PerfGap[] {
  const rows = db
    .prepare("SELECT category, store, title, offer FROM listings WHERE category IN ('cpu', 'gpu') AND last_seen_at >= ?")
    .all(new Date(now - days * 86_400_000).toISOString()) as { category: 'cpu' | 'gpu'; store: StoreId; title: string; offer: string }[];
  const gaps = new Map<string, PerfGap>();
  const withSheets = (category: 'cpu' | 'gpu') =>
    applySheets(
      db,
      category,
      rows.filter((r) => r.category === category).map((r) => JSON.parse(r.offer) as Offer),
      now,
    ).map((o) => ({ category, store: o.store, title: o.title, o }));
  for (const r of [...withSheets('cpu'), ...withSheets('gpu')]) {
    const s = r.o.specs ?? {};
    if ((r.category === 'gpu' ? gpuPerf(s) : cpuScore(s, r.o.sheet)) !== undefined) continue;
    const model = r.category === 'gpu' ? (s.gpuModel ?? '') : [s.cpuLine, s.cpuModel].filter(Boolean).join(' ');
    const key = `${r.category}|${model}`;
    const g = gaps.get(key) ?? { category: r.category, model, listings: 0, example: r.title, store: r.store };
    g.listings++;
    gaps.set(key, g);
  }
  return [...gaps.values()].sort((a, b) => b.listings - a.listings);
}

/**
 * Cobertura por loja e categoria: anúncios (e quantos em estoque), frescor e a leitura da categoria
 * pela rotina (caminhos configurados, volta em andamento, última volta completa). `paths`: quantos
 * caminhos de categoria cada loja tem em cada categoria (0 ou ausente: a rotina não lê). Aparece
 * também a categoria configurada que ainda não tem anúncio.
 */
export function coverage(db: Db, paths: (store: StoreId, category: CategoryId) => number, now = Date.now()): CoverageRow[] {
  const iso = (ms: number) => new Date(ms).toISOString();
  const listings = db
    .prepare(
      `SELECT store, category, count(*) AS listings, sum(json_extract(offer, '$.inStock') = 1) AS inStock,
         sum(last_seen_at >= ?) AS seen24h, sum(last_seen_at >= ?) AS seen7d, max(last_seen_at) AS last
       FROM listings GROUP BY store, category`,
    )
    .all(iso(now - 86_400_000), iso(now - 7 * 86_400_000)) as { store: StoreId; category: CategoryId; listings: number; inStock: number; seen24h: number; seen7d: number; last: string }[];
  const byKey = new Map(listings.map((l) => [`${l.store}|${l.category}`, l]));
  // Categoria com caminho configurado e ainda sem anúncio também aparece (a rotina ainda não leu).
  const keys = new Set(byKey.keys());
  for (const store of STORES) for (const category of ENABLED_CATEGORIES) if (paths(store, category) > 0) keys.add(`${store}|${category}`);
  const sheets = sheetCounts(db);
  return [...keys]
    .map((key) => {
      const [store, category] = key.split('|') as [StoreId, CategoryId];
      const l = byKey.get(key);
      const s = sweepState(db, store, category);
      const n = paths(store, category);
      return {
        store,
        category,
        listings: l?.listings ?? 0,
        inStock: l?.inStock ?? 0,
        seen24h: l?.seen24h ?? 0,
        seen7d: l?.seen7d ?? 0,
        paths: n,
        sweeping: n && inProgress(s) ? { path: (s.path ?? 0) + 1, page: s.page } : null,
        sweptAt: s.doneAt ?? null,
        lastOkAt: l?.last ?? null,
        // Páginas de produto lidas pela rotina de fichas.
        sheets: sheets.get(key) ?? 0,
      };
    })
    .sort((a, b) => a.store.localeCompare(b.store) || a.category.localeCompare(b.category));
}

/** Consultas por hora de cada loja nas últimas `hours` horas (ok, bloqueio, outro). */
export function attemptTimeline(db: Db, hours: number, now = Date.now()): TimelineBucket[] {
  const since = new Date(now - hours * 3_600_000).toISOString();
  return (
    db
      .prepare(
        `SELECT store, substr(at, 1, 13) || ':00:00.000Z' AS hour,
           sum(status = 'ok') AS ok, sum(status = 'blocked') AS blocked, sum(status NOT IN ('ok', 'blocked')) AS other
         FROM store_attempts WHERE at >= ? GROUP BY store, hour ORDER BY store, hour`,
      )
      .all(since) as unknown as TimelineBucket[]
  ).map((b) => ({ ...b, ok: Number(b.ok), blocked: Number(b.blocked), other: Number(b.other) }));
}
