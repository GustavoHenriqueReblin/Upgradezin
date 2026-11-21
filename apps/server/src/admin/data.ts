import { cpuPerf, gpuPerf, type AdminTerm, type CategoryId, type CoverageRow, type Offer, type PerfGap, type StoreId, type TimelineBucket } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';
import { SHEET_CATEGORIES, sheetCounts } from '../prices/sheets.ts';

/**
 * Processadores e placas de vídeo vistos nas lojas nos últimos `days` dias que a tabela de desempenho
 * não conhece, do mais anunciado para o menos. Conta na hora, do banco: anúncio novo de um modelo
 * novo aparece aqui assim que a rotina ou a varredura o grava.
 */
export function perfGaps(db: Db, now = Date.now(), days = 14): PerfGap[] {
  const rows = db
    .prepare("SELECT category, store, title, offer FROM listings WHERE category IN ('cpu', 'gpu') AND last_seen_at >= ?")
    .all(new Date(now - days * 86_400_000).toISOString()) as { category: 'cpu' | 'gpu'; store: StoreId; title: string; offer: string }[];
  const gaps = new Map<string, PerfGap>();
  for (const r of rows) {
    const s = (JSON.parse(r.offer) as Offer).specs ?? {};
    if ((r.category === 'gpu' ? gpuPerf(s) : cpuPerf(s)) !== undefined) continue;
    const model = r.category === 'gpu' ? (s.gpuModel ?? '') : [s.cpuLine, s.cpuModel].filter(Boolean).join(' ');
    const key = `${r.category}|${model}`;
    const g = gaps.get(key) ?? { category: r.category, model, listings: 0, example: r.title, store: r.store };
    g.listings++;
    gaps.set(key, g);
  }
  return [...gaps.values()].sort((a, b) => b.listings - a.listings);
}

/** Cobertura por loja e categoria: anúncios, frescor e termos coletados. */
export function coverage(db: Db, now = Date.now()): CoverageRow[] {
  const iso = (ms: number) => new Date(ms).toISOString();
  const listings = db
    .prepare(
      `SELECT store, category, count(*) AS listings, sum(last_seen_at >= ?) AS seen24h, sum(last_seen_at >= ?) AS seen7d
       FROM listings GROUP BY store, category`,
    )
    .all(iso(now - 86_400_000), iso(now - 7 * 86_400_000)) as { store: StoreId; category: CategoryId; listings: number; seen24h: number; seen7d: number }[];
  const terms = db
    .prepare(
      `SELECT st.category, tr.store, count(*) AS ok, max(tr.last_ok_at) AS last FROM search_terms st
       JOIN term_runs tr ON tr.term_id = st.id AND tr.last_ok_at IS NOT NULL
       WHERE st.origin != 'sweep' GROUP BY st.category, tr.store`,
    )
    .all() as { category: CategoryId; store: StoreId; ok: number; last: string }[];
  const totals = new Map(
    (db.prepare(`SELECT category, count(*) AS n FROM search_terms WHERE origin != 'sweep' GROUP BY category`).all() as { category: string; n: number }[]).map((r) => [r.category, r.n]),
  );
  // Última coleta boa de qualquer tipo (termo ou varredura) por loja e categoria.
  const lastAny = new Map(
    (
      db
        .prepare(`SELECT st.category, tr.store, max(tr.last_ok_at) AS last FROM term_runs tr JOIN search_terms st ON st.id = tr.term_id GROUP BY st.category, tr.store`)
        .all() as { category: string; store: string; last: string | null }[]
    ).map((r) => [`${r.store}|${r.category}`, r.last]),
  );
  const okBy = new Map(terms.map((t) => [`${t.store}|${t.category}`, t]));
  const sheets = sheetCounts(db);
  return listings
    .map((l) => {
      const key = `${l.store}|${l.category}`;
      return {
        store: l.store,
        category: l.category,
        listings: l.listings,
        seen24h: l.seen24h ?? 0,
        seen7d: l.seen7d ?? 0,
        terms: totals.get(l.category) ?? 0,
        termsOk: okBy.get(key)?.ok ?? 0,
        lastOkAt: lastAny.get(key) ?? null,
        // Fichas técnicas lidas: só nas categorias com ficha física.
        sheets: SHEET_CATEGORIES.includes(l.category) ? (sheets.get(key) ?? 0) : null,
      };
    })
    .sort((a, b) => a.store.localeCompare(b.store) || a.category.localeCompare(b.category));
}

/** Termos (sem a varredura), com a última coleta em cada loja. Filtros por categoria, origem e texto. */
export function listTerms(db: Db, f: { category?: CategoryId; origin?: AdminTerm['origin']; q?: string } = {}): AdminTerm[] {
  const where = [`origin != 'sweep'`];
  const args: string[] = [];
  if (f.category) where.push('category = ?'), args.push(f.category);
  if (f.origin) where.push('origin = ?'), args.push(f.origin);
  // % e _ do texto são literais (escapados com !), não curingas.
  if (f.q) where.push(`lower(term) LIKE ? ESCAPE '!'`), args.push(`%${f.q.toLowerCase().replace(/[!%_]/g, (c) => `!${c}`)}%`);
  const rows = db
    .prepare(`SELECT id, category, term, origin, created_at, last_requested_at FROM search_terms WHERE ${where.join(' AND ')} ORDER BY category, lower(term) LIMIT 1000`)
    .all(...args) as { id: number; category: CategoryId; term: string; origin: AdminTerm['origin']; created_at: string; last_requested_at: string | null }[];
  const runs = db.prepare('SELECT term_id, store, last_ok_at, last_try_at, status, count FROM term_runs').all() as {
    term_id: number;
    store: StoreId;
    last_ok_at: string | null;
    last_try_at: string;
    status: string;
    count: number;
  }[];
  const byTerm = new Map<number, AdminTerm['runs']>();
  for (const r of runs) {
    const list = byTerm.get(r.term_id) ?? [];
    list.push({ store: r.store, lastOkAt: r.last_ok_at, lastTryAt: r.last_try_at, status: r.status, count: r.count });
    byTerm.set(r.term_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    term: r.term,
    origin: r.origin,
    createdAt: r.created_at,
    lastRequestedAt: r.last_requested_at,
    runs: (byTerm.get(r.id) ?? []).sort((a, b) => a.store.localeCompare(b.store)),
  }));
}

/**
 * Apaga um termo pesquisado (texto livre ou do formulário marcado como pesquisado). Os do
 * formulário (seed) voltariam na próxima subida da rotina: não são apagados.
 */
export function deleteTerm(db: Db, id: number): 'deleted' | 'not-found' | 'seed' {
  const row = db.prepare('SELECT origin FROM search_terms WHERE id = ?').get(id) as { origin: string } | undefined;
  if (!row || row.origin === 'sweep') return 'not-found';
  if (row.origin === 'seed') return 'seed';
  db.prepare('DELETE FROM search_terms WHERE id = ?').run(id);
  return 'deleted';
}

/** Dá prioridade ao termo na rotina: conta como pedido agora (a rotina pega primeiro). */
export function prioritizeTerm(db: Db, id: number, now = new Date().toISOString()): boolean {
  return db.prepare(`UPDATE search_terms SET last_requested_at = ? WHERE id = ? AND origin != 'sweep'`).run(now, id).changes > 0;
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
