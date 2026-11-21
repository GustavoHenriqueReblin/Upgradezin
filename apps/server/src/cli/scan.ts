/**
 * Busca pelo terminal, sem UI. Sempre com termo: nunca a categoria inteira.
 *   pnpm scan 750W                         -> fontes de 750 W
 *   pnpm scan 750W,850W                    -> vários termos, um por vez em cada loja
 *   pnpm scan B550 --category=motherboard  -> placas-mãe B550
 *   pnpm scan 750W --stores=s1             -> só algumas lojas (IDs)
 *   pnpm scan 850W --json --top=20         -> imprime JSON / limita a lista
 *   pnpm scan --sweep                      -> confere os caminhos de varredura (admin, Lojas):
 *                                             1ª página de cada categoria, sem gravar
 */
import { effectiveCash, ENABLED_CATEGORIES, groupOffers, type CategoryId, type Offer, type StoreId } from '@upgradezin/shared';
import { closeBrowser } from '../browser.ts';
import { previewSweep } from '../prices/collect.ts';
import { runSearch } from '../search.ts';
import { getDb } from '../db/instance.ts';
import { ACTIVE_STORES, storeConfig, useStoreStorage } from '../stores.ts';

// Lojas como o servidor usa (banco; na primeira vez, copiadas do .env).
useStoreStorage(getDb());

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k!, v ?? '1'];
  }),
);
const terms = args
  .filter((a) => !a.startsWith('--'))
  .join(' ')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const category = (flags.category ?? 'psu') as CategoryId;
// Vírgula ou espaço: o PowerShell transforma "--stores=s2,s3" em "--stores=s2 s3".
const stores = ((flags.stores?.split(/[\s,]+/).filter(Boolean) ?? [...ACTIVE_STORES]) as StoreId[]).filter((id) => ACTIVE_STORES.includes(id));

if (flags.sweep) {
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  const cats = flags.category ? [category] : ENABLED_CATEGORIES;
  for (const store of stores) {
    for (const cat of cats) {
      const path = storeConfig(store).sweep[cat];
      if (!path) continue;
      try {
        const r = await previewSweep(store, cat, ac.signal);
        if (!r) console.log(`${store} ${cat}: a loja não tem varredura`);
        else console.log(`${store} ${cat} ${path}: ${r.totalPages} páginas, ${r.offers.length} ofertas na 1ª (${r.offers.slice(0, 2).map((o) => o.title.slice(0, 40)).join(' | ')})`);
      } catch (err) {
        console.log(`${store} ${cat} ${path}: ERRO ${(err as Error).message}`);
      }
    }
  }
  await closeBrowser();
  process.exit(0);
}

if (!terms.length || !ENABLED_CATEGORIES.includes(category) || !stores.length) {
  console.error(`Uso: pnpm scan <termo>[,<termo>…] [--category=${ENABLED_CATEGORIES.join('|')}] [--stores=${ACTIVE_STORES.join(',')}] [--json] [--top=N]`);
  process.exit(1);
}

const all: Offer[] = [];
const ac = new AbortController();
process.on('SIGINT', () => ac.abort());

// O Chrome de cada loja fica aberto entre consultas: fecha no fim (senão o processo não termina).
await runSearch(
  { category, terms, stores },
  {
    onStatus: (e) =>
      console.error(
        `[${storeConfig(e.store).name}] ${e.state}${e.reason ? ` ${e.reason}` : ''}${e.page ? ` pág ${e.page}/${e.totalPages ?? '?'}` : ''}${e.count != null ? ` (${e.count})` : ''}${e.ms ? ` ${(e.ms / 1000).toFixed(1)}s` : ''}`,
      ),
    // Lotes parciais chegam durante a busca; a lista final da loja substitui todos eles.
    onOffers: (store, offers, partial) => {
      if (partial) return;
      for (let i = all.length - 1; i >= 0; i--) if (all[i]!.store === store) all.splice(i, 1);
      all.push(...offers);
    },
  },
  ac.signal,
  true,
);

const groups = groupOffers(all.filter((o) => !o.marketplace && !o.openbox)).sort((a, b) => effectiveCash(a.best) - effectiveCash(b.best));

if (flags.json) {
  console.log(JSON.stringify(groups, null, 2));
} else {
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  console.log(`\n${all.length} ofertas, ${groups.length} produtos\n`);
  for (const g of groups.slice(0, Number(flags.top ?? 40))) {
    const s = g.specs;
    const spec = [
      s.watts && `${s.watts}W`, s.efficiency, s.modular, s.atx && `ATX ${s.atx}`,
      s.gpuModel, s.vram && `${s.vram}GB ${s.vramType ?? ''}`.trim(),
      s.cpuLine && `${s.cpuLine} ${s.cpuModel ?? ''}`.trim(), s.cores && `${s.cores} núcleos`, s.igpu === false && 'sem vídeo',
      s.chipset, s.socket, s.formFactor, s.memory,
      s.ramCapacity && `${s.ramCapacity}GB${(s.ramModules ?? 1) > 1 ? ` (${s.ramModules}x)` : ''}`, s.ramSpeed && `${s.ramSpeed}MHz`, s.ramLatency && `CL${s.ramLatency}`,
      s.wifi && 'wifi', s.rgb && 'rgb', s.white && 'branca',
    ]
      .filter(Boolean)
      .join(' · ');
    const lojas = g.offers
      .map((o) => `${storeConfig(o.store).name} ${brl(effectiveCash(o))}${o.coupon?.code ? ` (cupom ${o.coupon.code})` : ''}${o.inStock ? '' : ' (esgotado)'}`)
      .join(' | ');
    console.log(`${brl(effectiveCash(g.best)).padStart(12)}  ${g.title.slice(0, 70)}\n${''.padStart(14)}${spec}\n${''.padStart(14)}${lojas}\n`);
  }
}

await closeBrowser();
process.exit(0);
