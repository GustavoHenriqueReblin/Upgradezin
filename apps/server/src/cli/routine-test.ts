/**
 * Teste da rotina contra as lojas de verdade, pelo mesmo caminho do servidor:
 * collectSweepPage(origin 'routine') -> withStore (fila e intervalo da loja) -> adapter -> loadPage
 * (aba nova no Chrome da loja, fechada no fim). Lê a 1ª página de cada categoria (o primeiro
 * caminho configurado) e grava no banco como a rotina grava (a volta segue dali na rotina).
 *
 * Lojas em paralelo; dentro de cada loja, uma categoria por vez. Bloqueio para a loja (como a
 * rotina: a pausa vale e ela não segue com as outras categorias).
 *
 *   pnpm routine-test                              -> todas as lojas, todas as categorias com página configurada
 *   pnpm routine-test --stores=s2,s3               -> só algumas lojas
 *   pnpm routine-test --categories=gpu,ssd         -> só algumas categorias
 *   pnpm routine-test --keep-open                  -> no fim, deixa os Chromes abertos até Ctrl+C
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveCash, ENABLED_CATEGORIES, STORES, type CategoryId, type StoreId } from '@upgradezin/shared';
import { browserOpen, closeBrowser } from '../browser.ts';
import { ExtSetupError } from '../browser-ext.ts';
import { config } from '../config.ts';
import { deleteMeta, metaByPrefix, setMeta } from '../db/db.ts';
import { getDb } from '../db/instance.ts';
import { type Backoff, backoffInfo, BlockedError, PageLimitError, registerSuccess, useBackoffStorage } from '../pace.ts';
import { collectSweepPage, withBrowserSession } from '../prices/collect.ts';
import { getMeta } from '../db/db.ts';
import { ACTIVE_STORES, storeConfig, sweepPaths, useStoreStorage } from '../stores.ts';

// ----- mesmo preparo do servidor (src/index.ts): lojas e pausas, do banco -----
const db = getDb();
useStoreStorage(db);
useBackoffStorage(
  metaByPrefix(db, 'backoff:').map(([k, v]) => [k.slice('backoff:'.length), JSON.parse(v)] as [StoreId, Backoff]),
  (store, b) => (b ? setMeta(db, `backoff:${store}`, JSON.stringify(b)) : deleteMeta(db, `backoff:${store}`)),
);

const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k!, v ?? '1'];
    }),
);
// Vírgula ou espaço: o PowerShell transforma "--stores=s2,s3" em "--stores=s2 s3".
const list = (v?: string) => v?.split(/[\s,]+/).filter(Boolean);
const wanted = list(flags.stores);
const stores = (wanted ?? [...ACTIVE_STORES]).filter((s): s is StoreId => ACTIVE_STORES.includes(s as StoreId));
for (const s of wanted ?? []) if (!stores.includes(s as StoreId)) console.error(`Loja ignorada: "${s}" (ativas: ${ACTIVE_STORES.join(', ')})`);
const cats = list(flags.categories);
for (const c of cats ?? []) if (!(ENABLED_CATEGORIES as string[]).includes(c)) console.error(`Categoria ignorada: "${c}"`);
const categories = ENABLED_CATEGORIES.filter((c) => !cats || cats.includes(c));
if (!stores.length || !categories.length) {
  console.error(`Uso: pnpm routine-test [--stores=${STORES.join(',')}] [--categories=${ENABLED_CATEGORIES.join(',')}] [--keep-open]`);
  process.exit(1);
}
// Rotina ligada no servidor ao mesmo tempo usaria o mesmo Chrome: avisa.
if (getMeta(db, 'routine')?.includes('"enabled":true')) console.warn('Aviso: a rotina está ligada neste banco; com o servidor rodando, pare-o antes.');

type Status = 'ok' | 'vazio' | 'bloqueada' | 'pausada' | 'limite' | 'erro' | 'pulada';
interface Row {
  store: StoreId;
  category: CategoryId;
  path: string;
  status: Status;
  count: number;
  ms: number;
  cheapest?: { title: string; price: number };
  detail?: string;
}
const rows: Row[] = [];
const ac = new AbortController();
process.on('SIGINT', () => ac.abort(new Error('Ctrl+C')));

const t0 = Date.now();
const clock = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

console.log(
  `Teste de rotina: ${stores.join(', ')} × ${categories.length} categorias | ` +
    `pausa após bloqueio: ${config.BACKOFF_ENABLED ? 'ligada' : 'desligada'} | passo: ${config.BROWSER_STEP_MS} ms\n`,
);

/** Uma loja: a 1ª página de cada categoria, em sequência. */
async function runStore(store: StoreId) {
  const name = storeConfig(store).name;
  let stopped: Status | null = null;
  for (const category of categories) {
    const path = sweepPaths(store, category)[0];
    if (!path) continue;
    const base = { store, category, path };
    if (ac.signal.aborted || stopped) {
      rows.push({ ...base, status: 'pulada', count: 0, ms: 0, detail: stopped ? `loja parou (${stopped})` : 'cancelado' });
      continue;
    }
    const start = Date.now();
    console.log(`${clock()} [${name}] ${category} ${path}…`);
    try {
      const r = await collectSweepPage(store, category, 0, 1, ac.signal, { origin: 'routine' });
      registerSuccess(store);
      const offers = db
        .prepare(`SELECT offer FROM listings WHERE store = ? AND category = ? ORDER BY last_seen_at DESC LIMIT ?`)
        .all(store, category, r.saved)
        .map((x) => JSON.parse((x as { offer: string }).offer) as import('@upgradezin/shared').Offer);
      const sale = offers.filter((o) => o.inStock && !o.marketplace && !o.openbox);
      const best = sale.sort((a, b) => effectiveCash(a) - effectiveCash(b))[0];
      const row: Row = { ...base, status: r.read ? 'ok' : 'vazio', count: r.read, ms: Date.now() - start };
      if (best) row.cheapest = { title: best.title, price: effectiveCash(best) };
      rows.push(row);
      console.log(`${clock()} [${name}] ${category}: ${offers.length} ofertas em ${(row.ms / 1000).toFixed(1)}s${best ? ` | menor: ${brl(effectiveCash(best))} ${best.title.slice(0, 50)}` : ''}`);
    } catch (err) {
      const ms = Date.now() - start;
      const msg = (err as Error)?.message ?? String(err);
      let status: Status = 'erro';
      if (err instanceof BlockedError) status = err.paused ? 'pausada' : 'bloqueada';
      else if (err instanceof PageLimitError) status = 'limite';
      rows.push({ ...base, status, count: 0, ms, detail: err instanceof BlockedError ? `${err.reason}: ${msg}` : msg });
      console.log(`${clock()} [${name}] ${category}: ${status.toUpperCase()} em ${(ms / 1000).toFixed(1)}s (${msg})`);
      // Como a rotina: bloqueio, pausa ou limite param a loja; erro segue para a próxima categoria.
      // Com BACKOFF_ENABLED=false, bloqueio não para: segue para a próxima categoria.
      if (status === 'pausada' || status === 'limite' || (status === 'bloqueada' && config.BACKOFF_ENABLED)) stopped = status;
      // Extensão não instalada ou porta ocupada: as próximas falhariam igual.
      if (err instanceof ExtSetupError) stopped = 'erro';
    }
  }
}

try {
  await withBrowserSession(() => Promise.all(stores.map(runStore)));
} finally {
  // ----- relatório -----
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== Resultado (${total}s) ===\n`);
  const w = Math.max(...stores.map((s) => storeConfig(s).name.length), 4);
  console.log(`${'loja'.padEnd(w)}  ${'categoria'.padEnd(12)} ${'status'.padEnd(12)} ${'ofertas'.padStart(7)} ${'tempo'.padStart(7)}  menor preço`);
  for (const r of rows.sort((a, b) => a.store.localeCompare(b.store) || categories.indexOf(a.category) - categories.indexOf(b.category))) {
    console.log(
      `${storeConfig(r.store).name.padEnd(w)}  ${r.category.padEnd(12)} ${r.status.padEnd(12)} ${String(r.count).padStart(7)} ${`${(r.ms / 1000).toFixed(1)}s`.padStart(7)}  ` +
        (r.cheapest ? `${brl(r.cheapest.price)} ${r.cheapest.title.slice(0, 45)}` : (r.detail ?? '').slice(0, 60)),
    );
  }
  console.log('');
  for (const s of stores) {
    const mine = rows.filter((r) => r.store === s);
    const ok = mine.filter((r) => r.status === 'ok' || r.status === 'vazio').length;
    const bo = backoffInfo(s);
    console.log(`${storeConfig(s).name}: ${ok}/${mine.length} consultas deram certo${bo ? ` | EM PAUSA até ${new Date(bo.until).toLocaleTimeString('pt-BR')} (${bo.reason})` : ''}`);
  }
  const dir = join(config.DATA_DIR, 'debug');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `routine-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ startedAt: new Date(t0).toISOString(), seconds: Number(total), rows }, null, 2));
  console.log(`\nRelatório salvo em ${file}`);

  if (flags['keep-open'] && browserOpen() && !ac.signal.aborted) {
    console.log('Chromes abertos (--keep-open). Ctrl+C para fechar.');
    await new Promise<void>((r) => process.once('SIGINT', () => r()));
  }
  await closeBrowser();
  process.exit(0);
}
