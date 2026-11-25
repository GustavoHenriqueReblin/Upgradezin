import { mkdir, mkdtemp, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BUILD_SLOTS, STORES, effectiveCash, prepareBudget, type BudgetMode, type BudgetOffer, type BudgetOption, type BudgetPlan, type BudgetProfile, type BudgetRequest, type Build, type BuildSlot, type StoreId } from '@upgradezin/shared';
import { budgetOffers, budgetPlan } from '../budget.ts';
import { openDb, type Db } from '../db/db.ts';
import { backup, DatabaseSync } from '../db/sqlite.ts';
import { rereadSheets } from '../prices/sheets.ts';

const BUDGETS = [5000, 8000, 12000, 15000];
const MODES = ['buyable', 'ideal'] as const;
const PROFILES = ['games', 'mixed'] as const;
const RESOLUTIONS = ['1080p', '1440p', '4k'] as const;
const REFRESH_RATES = [60, 144];
// Menor valor aceito pela API, usado só para pedir ao motor o mínimo que monta.
const PROBE_BUDGET = 100;

export function budgetScenarios() {
  return (['minimum', ...BUDGETS] as const).flatMap((budgetTier) =>
    MODES.flatMap((mode) => PROFILES.flatMap((profile) =>
      RESOLUTIONS.flatMap((res) => REFRESH_RATES.map((hz) => ({ budgetTier, mode, profile, res, hz }))),
    )),
  );
}

export function resolveBudgetScenario({ budgetTier, ...inputs }: ReturnType<typeof budgetScenarios>[number], evaluate: (request: BudgetRequest) => BudgetPlan) {
  const request = { ...inputs, budget: budgetTier === 'minimum' ? PROBE_BUDGET : budgetTier };
  const plan = evaluate(request);
  if (budgetTier !== 'minimum') return { request, plan, minimumBrl: plan.minTotal ?? null };
  const minimumBrl = plan.status === 'ok' ? request.budget : plan.minTotal ?? null;
  if (minimumBrl === null || minimumBrl === request.budget) return { request, plan, minimumBrl };
  const atMinimum = { ...request, budget: minimumBrl };
  return { request: atMinimum, plan: evaluate(atMinimum), minimumBrl };
}

export function reportOption(option: BudgetOption, request: BudgetRequest) {
  const violations: string[] = [];
  if (option.total > request.budget && !option.stretch) violations.push('over-budget');
  if (option.issues.some((issue) => issue.level === 'error')) violations.push('incompatible');

  const parts = Object.fromEntries(BUILD_SLOTS.map((slot) => {
    const part = option.parts[slot];
    if (!part) return [slot, null];
    if (request.mode === 'buyable' && (!part.offer.inStock || part.reference)) violations.push(`unavailable:${slot}`);
    return [slot, {
      title: part.offer.title,
      productKey: part.offer.productKey ?? null,
      storeId: part.reference ? null : part.offer.store,
      storeSku: part.reference ? null : part.offer.storeSku,
      quantity: part.qty ?? 1,
      totalBrl: part.price,
      inStock: part.offer.inStock,
      priceSource: part.reference ? 'history' : 'offer',
      observedAt: part.reference?.at ?? part.offer.collectedAt,
      specs: part.offer.specs,
    }];
  }));
  return {
    totalBrl: option.total,
    remainingBrl: Math.round((request.budget - option.total) * 100) / 100,
    stretch: option.stretch === true,
    performance: { combinedIndex: option.fps, gain: option.gain ?? null, objectiveIndex: option.objective ?? null, workIndex: option.work ?? null, cpuIndex: option.cpu ?? null, gpuIndex: option.gpu ?? null, cpuGpuRatio: option.ratio ?? null },
    parts,
    notes: option.notes,
    issues: option.issues,
    violations,
  };
}

function loadAuditOffers(db: Db, now: number, stores: StoreId[]) {
  return new Map(MODES.map((mode) => [
    mode, new Map(BUILD_SLOTS.map((slot) => [slot, budgetOffers(db, slot, mode, stores, now)])),
  ]));
}

function runMatrix(db: Db, now: number, stores: StoreId[]) {
  const byMode = loadAuditOffers(db, now, stores);
  const evaluate = (request: BudgetRequest) => {
    const result = budgetPlan(request, (slot: BuildSlot, mode) => byMode.get(mode)?.get(slot) ?? [], now);
    if (!result.ok) throw new Error(result.error);
    return result.plan;
  };
  const scenarios = budgetScenarios().map((scenario) => {
    const { request, plan, minimumBrl } = resolveBudgetScenario(scenario, evaluate);
    return {
      id: [scenario.budgetTier, request.mode, request.profile, request.res, request.hz].join('-'),
      budgetTier: scenario.budgetTier,
      request,
      status: plan.status,
      minimumBrl,
      recommendation: plan.status === 'ok' ? reportOption(plan, request) : null,
      alternatives: plan.alternatives.map((option) => reportOption(option, request)),
    };
  });
  return {
    schemaVersion: 2,
    scope: 'full-pc',
    currency: 'BRL',
    catalogAsOf: new Date(now).toISOString(),
    activeStores: stores,
    offersByMode: Object.fromEntries(MODES.map((mode) => [
      mode, Object.fromEntries(BUILD_SLOTS.map((slot) => [
        slot, { current: byMode.get(mode)!.get(slot)!.filter((offer) => offer.inStock).length, historical: byMode.get(mode)!.get(slot)!.filter((offer) => !!offer.reference).length },
      ])),
    ])),
    totals: {
      scenarios: scenarios.length,
      byStatus: Object.fromEntries(['ok', 'too-low', 'no-data', 'no-gain'].map((status) => [status, scenarios.filter((scenario) => scenario.status === status).length])),
      violations: scenarios.flatMap((scenario) => [scenario.recommendation, ...scenario.alternatives]).reduce((n, option) => n + (option?.violations.length ?? 0), 0),
    },
    scenarios,
  };
}

const AUDIT_BUDGETS = Array.from({ length: 57 }, (_, i) => 2000 + i * 500);
const AUDIT_PROFILES = ['games', 'mixed', 'productivity'] as const;
const AUDIT_RATES = [60, 144, 165, 240];
type AuditCatalog = Partial<Record<BuildSlot, BudgetOffer[]>>;

function optionIds(option: BudgetOption) {
  return Object.fromEntries(BUILD_SLOTS.map((slot) => {
    const o = option.parts[slot]?.offer;
    return [slot, o ? o.productKey ?? `${o.store}:${o.storeSku}` : null];
  }));
}

function auditResult(request: BudgetRequest, plan: BudgetPlan) {
  return {
    id: [request.budget, request.mode, request.profile, request.res, request.hz].join('-'),
    request,
    status: plan.status,
    minimumBrl: plan.minTotal ?? null,
    bestObjective: plan.bestObjective ?? null,
    recommendation: plan.status === 'ok' ? reportOption(plan, request) : null,
    alternatives: plan.alternatives.map((option) => reportOption(option, request)),
  };
}

/** Descontos incidem sobre o preço efetivo observado, mantendo ficha, identidade e estoque reais. */
export function simulatedPrice(offer: BudgetOffer, percent: number, now: number): BudgetOffer {
  const scale = (price: number) => Math.round(price * (100 + percent)) / 100;
  return { ...offer, priceCash: offer.inStock ? scale(effectiveCash(offer, now)) : offer.priceCash, coupon: undefined,
    ...(offer.reference && { reference: { ...offer.reference, price: scale(offer.reference.price) } }) };
}

function runExpanded(db: Db, now: number, stores: StoreId[]) {
  const offers = loadAuditOffers(db, now, stores);
  const catalogOf = (mode: BudgetMode): AuditCatalog => Object.fromEntries(offers.get(mode)!);
  const scenarios: ReturnType<typeof auditResult>[] = [];
  const boundaries: { below: ReturnType<typeof auditResult>; above: ReturnType<typeof auditResult> }[] = [];
  const discarded: { id: string; reason: string; option: ReturnType<typeof reportOption> | null; checks?: NonNullable<BudgetPlan['audit']>['rejectedBuilds'] }[] = [];
  const progression: { request: BudgetRequest; before: number; after: number }[] = [];
  for (const mode of MODES) for (const profile of AUDIT_PROFILES) for (const res of RESOLUTIONS) for (const hz of AUDIT_RATES) {
    const inputs = { mode, profile, res, hz };
    const evaluate = prepareBudget(inputs, catalogOf(mode), now);
    let previous: number | undefined;
    let previousPlan: BudgetPlan | undefined;
    let previousBudget: number | undefined;
    let probedChange = false;
    const mainParts = (p: BudgetPlan) => [p.status, p.parts.cpu?.offer.specs.cpuModel, p.parts.gpu?.offer.specs.gpuModel].join('|');
    for (const budget of AUDIT_BUDGETS) {
      const request = { ...inputs, budget };
      const plan = evaluate(budget);
      const score = plan.bestObjective;
      if (previous !== undefined && (score === undefined || score + 0.000001 < previous)) {
        progression.push({ request, before: previous, after: score ?? 0 });
      }
      const row = auditResult(request, plan);
      if (previousPlan && previousBudget !== undefined && mainParts(previousPlan) !== mainParts(plan) &&
        (previousPlan.status !== 'ok' || !probedChange)) {
        if (previousPlan.status === 'ok') probedChange = true;
        const original = mainParts(previousPlan);
        let low = previousBudget * 100;
        let high = budget * 100;
        while (high - low > 1) {
          const mid = Math.floor((low + high) / 2);
          if (mainParts(evaluate(mid / 100, 'primary')) === original) low = mid;
          else high = mid;
        }
        const before = { ...inputs, budget: low / 100 };
        const after = { ...inputs, budget: high / 100 };
        boundaries.push({ below: auditResult(before, evaluate(before.budget)), above: auditResult(after, evaluate(after.budget)) });
      }
      const fell = previousPlan && plan.status === 'ok' && previousPlan.status === 'ok' && (plan.objective ?? 0) + 0.01 < (previousPlan.objective ?? 0);
      const costWithoutGain = previousPlan && plan.status === 'ok' && previousPlan.status === 'ok' && plan.total > previousPlan.total + 1 &&
        (plan.objective ?? 0) <= (previousPlan.objective ?? 0) * 1.01;
      if (fell || costWithoutGain || (plan.status === 'no-data' && budget === AUDIT_BUDGETS.at(-1))) {
        const audit = evaluate(budget, true).audit;
        const stronger = audit?.strongerWithinBudget;
        const beyond = audit?.betterOutsideBudget;
        discarded.push({ id: row.id, reason: stronger ? 'better-score-within-budget-ranked-lower' : beyond ? 'better-score-over-budget' : 'no-higher-score-candidate',
          option: stronger ? reportOption(stronger, request) : beyond ? reportOption(beyond, request) : null, checks: audit?.rejectedBuilds });
      }
      previous = score;
      previousPlan = plan;
      previousBudget = budget;
      scenarios.push(row);
    }
    if (scenarios.length % 684 === 0) console.log(`${scenarios.length} cenários de orçamento concluídos`);
  }

  const sensitivity: { id: string; baseline: ReturnType<typeof auditResult>; result: ReturnType<typeof auditResult>; effect?: Record<string, unknown> }[] = [];
  const taste = { res: '1440p', hz: 144, budget: 12000, profile: 'games' } as const;
  for (const mode of MODES) {
    const catalog = catalogOf(mode);
    const request = { ...taste, mode };
    const plan = prepareBudget(request, catalog, now)(request.budget);
    const baseline = auditResult(request, plan);
    const ids = optionIds(plan);
    const mostSelected = (slot: BuildSlot) => {
      const counts = new Map<string, number>();
      for (const scenario of scenarios) {
        const part = scenario.recommendation?.parts[slot];
        if (scenario.request.mode !== mode || !part) continue;
        const key = part.productKey ?? (part.storeId && part.storeSku ? `${part.storeId}:${part.storeSku}` : null);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    const run = (id: string, input: BudgetRequest, pool: AuditCatalog, target?: BuildSlot) => {
      const changed = prepareBudget(input, pool, now)(input.budget);
      const picked = optionIds(changed);
      const retained = target && ids[target] ? [changed, ...changed.alternatives].some((o) => optionIds(o)[target] === ids[target]) : undefined;
      const effect = { sameParts: JSON.stringify(ids) === JSON.stringify(picked), retainedInOptions: retained ?? null,
        totalDeltaBrl: plan.status === 'ok' && changed.status === 'ok' ? Math.round((changed.total - plan.total) * 100) / 100 : null,
        objectiveDelta: changed.bestObjective !== undefined && plan.bestObjective !== undefined ? changed.bestObjective - plan.bestObjective : null };
      sensitivity.push({ id: `${mode}-${id}`, baseline, result: auditResult(input, changed), effect });
    };
    for (const slot of BUILD_SLOTS) {
      const items = catalog[slot] ?? [];
      for (const percent of [-30, -20, -10, 10, 20, 30]) {
        run(`price-${slot}-${percent}`, request, { ...catalog, [slot]: items.map((o) => simulatedPrice(o, percent, now)) }, slot);
      }
      const key = ids[slot];
      const identity = (o: BudgetOffer) => o.productKey ?? `${o.store}:${o.storeSku}`;
      if (key) run(`promotion-${slot}`, request, { ...catalog, [slot]: items.map((o) => identity(o) === key ? simulatedPrice(o, -20, now) : o) }, slot);
      const popular = mostSelected(slot);
      if (popular) run(`remove-${slot}`, request, { ...catalog, [slot]: items.filter((o) => identity(o) !== popular) }, slot);
    }
    // Usa uma GPU alternativa real e aproxima seu preço do modelo principal por promoção simulada.
    const mainGpu = plan.parts.gpu;
    const otherGpu = mainGpu && (catalog.gpu ?? [])
      .filter((o) => o.specs.gpuModel && o.specs.gpuModel !== mainGpu.offer.specs.gpuModel && (o.inStock || o.reference))
      .map((o) => ({ offer: o, price: o.inStock ? effectiveCash(o, now) : o.reference!.price }))
      .filter((o) => o.price > 0)
      .sort((a, b) => Math.abs(a.price - mainGpu.price) - Math.abs(b.price - mainGpu.price))[0];
    if (mainGpu && otherGpu) {
      const percent = (mainGpu.price * 0.99 / otherGpu.price - 1) * 100;
      const key = otherGpu.offer.productKey ?? `${otherGpu.offer.store}:${otherGpu.offer.storeSku}`;
      run('near-price-gpu', request, { ...catalog, gpu: catalog.gpu?.map((o) =>
        (o.productKey ?? `${o.store}:${o.storeSku}`) === key ? simulatedPrice(o, percent, now) : o) });
    }
    const incomplete = (o: BudgetOffer, slot: BuildSlot): BudgetOffer => {
      const specs = { ...o.specs };
      if (slot === 'gpu') delete specs.gpuLength;
      if (slot === 'case') { delete specs.caseMaxGpu; delete specs.caseMaxCooler; delete specs.caseRadiators; }
      if (slot === 'motherboard') { delete specs.memorySlots; delete specs.m2Slots; }
      if (slot === 'cpu') { delete specs.cores; delete specs.threads; }
      return { ...o, specs, sheet: undefined };
    };
    run('missing-data', request, Object.fromEntries(BUILD_SLOTS.map((slot) => [slot, (catalog[slot] ?? []).map((o) => incomplete(o, slot))])));
    run('contradictory-psu', request, { ...catalog, psu: catalog.psu?.map((o) => o.specs.pcie5
      ? { ...o, sheet: { ...o.sheet, pcie16: 0 } } : o) });
    run('contradictory-board', request, { ...catalog, motherboard: catalog.motherboard?.map((o) => o.specs.m2Slots
      ? { ...o, specs: { ...o.specs, m2Slots: 0 } } : o) });
    for (const cpu of ['amd', 'intel'] as const) for (const gpu of ['amd', 'intel', 'nvidia'] as const) {
      run(`prefer-${cpu}-${gpu}`, { ...request, preferences: { cpu, gpu } }, catalog);
    }
    for (const graphics of ['integrated', 'dedicated'] as const) for (const profile of AUDIT_PROFILES) {
      run(`graphics-${graphics}-${profile}`, { ...request, graphics, profile }, catalog);
    }
    for (const [level, baseBudget, graphics] of [['old', 3000, 'integrated'], ['mid', 6500, 'dedicated'], ['high', 15000, 'dedicated']] as const) {
      const origin = prepareBudget({ ...request, graphics }, catalog, now)(baseBudget);
      if (origin.status !== 'ok') continue;
      const owned: Build = Object.fromEntries(Object.entries(origin.parts).map(([slot, part]) => [slot, { specs: part.offer.specs, qty: part.qty, current: true }]));
      for (const profile of AUDIT_PROFILES) {
        run(`upgrade-${level}-${profile}`, { ...request, owned, budget: 4000, profile }, catalog);
        run(`upgrade-full-${level}-${profile}`, { ...request, owned, budget: 15000, profile }, catalog);
      }
    }
  }
  const results = [...scenarios, ...sensitivity.map((test) => test.result), ...boundaries.flatMap(({ below, above }) => [below, above])];
  return {
    schemaVersion: 2,
    scope: 'expanded',
    currency: 'BRL',
    catalogAsOf: new Date(now).toISOString(),
    activeStores: stores,
    totals: { scenarios: scenarios.length, sensitivity: sensitivity.length, boundaries: boundaries.length,
      byStatus: Object.fromEntries(['ok', 'too-low', 'no-data', 'no-gain'].map((s) => [s, results.filter((r) => r.status === s).length])),
      violations: results.reduce((n, r) => n + [r.recommendation, ...r.alternatives].reduce((m, o) => m + (o?.violations.length ?? 0), 0), 0) },
    progression,
    boundaries,
    discarded,
    scenarios,
    sensitivity,
  };
}

async function main() {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const { values } = parseArgs({ options: { db: { type: 'string' }, output: { type: 'string' }, expanded: { type: 'boolean' }, 'reread-sheets': { type: 'boolean' } } });
  const dbPath = resolve(root, values.db ?? 'data/upgradezin.db');
  const output = resolve(root, values.output ?? (values.expanded ? '.vitest/budget-expanded.json' : '.vitest/budget-full-pc.json'));
  const sourcePath = await realpath(dbPath);
  const outputPath = await realpath(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return output;
  });
  if (outputPath === sourcePath) throw new Error('O arquivo de saída precisa ser diferente do banco.');

  const temp = await mkdtemp(join(tmpdir(), 'upgradezin-budget-'));
  const snapshotPath = join(temp, 'catalog.db');
  let db: Db | undefined;
  try {
    const source = new DatabaseSync(dbPath, { readOnly: true });
    try { await backup(source, snapshotPath); } finally { source.close(); }
    // O mesmo leitor de fichas do servidor pode preparar tabelas. Isso acontece só na cópia temporária.
    db = openDb(snapshotPath);
    if (values['reread-sheets']) rereadSheets(db);
    const { latest } = db.prepare('SELECT max(last_seen_at) AS latest FROM listings').get() as { latest: string | null };
    const now = Date.parse(latest ?? '');
    if (!Number.isFinite(now)) throw new Error('O banco não tem anúncios com uma data de coleta válida.');
    const configured = db.prepare('SELECT id FROM store_configs WHERE enabled = 1').all();
    const stores = STORES.filter((id) => configured.some((row) => row.id === id));
    const report = values.expanded ? runExpanded(db, now, stores) : runMatrix(db, now, stores);
    await mkdir(dirname(output), { recursive: true });
    const staging = `${output}.${process.pid}.tmp`;
    await writeFile(staging, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    await rename(staging, output);
    console.log(`${report.totals.scenarios} cenários em ${output}`);
    console.log(report.totals);
    if (report.totals.violations) process.exitCode = 1;
  } finally {
    db?.close();
    await Promise.all(['', '-wal', '-shm', '-journal'].map((suffix) => rm(snapshotPath + suffix, { force: true })));
    await rmdir(temp);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
