import { useEffect, useState } from 'react';
import { ExternalLink, Ticket } from 'lucide-react';
import { CATEGORY_DEFS, effectiveCash, sheetRows, type ProductPage as ProductPageData } from '@upgradezin/shared';
import { ago, brl } from '../format.ts';
import { storeName } from '../stores.ts';
import { PriceHistoryBody } from './PriceHistory.tsx';
import { CouponLine, PromoLine } from './ProductCard.tsx';
import { StoreDot } from './StoreDot.tsx';

/**
 * Página do produto: ofertas de cada loja, ficha técnica (todos os campos da categoria; o que a
 * ficha não tem aparece como "não informado") e histórico de preço. Só do banco.
 */
export function ProductPage({ productKey }: { productKey: string }) {
  const [page, setPage] = useState<ProductPageData | null>(null);
  const [error, setError] = useState<'not-found' | 'failed' | null>(null);

  useEffect(() => {
    fetch(`/api/products/${encodeURIComponent(productKey)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ProductPageData>) : Promise.reject(new Error(r.status === 404 ? 'not-found' : 'failed'))))
      .then((p) => {
        setPage(p);
        document.title = `${p.title} · Upgradezin`;
      })
      .catch((e: Error) => setError(e.message === 'not-found' ? 'not-found' : 'failed'));
  }, [productKey]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <a href="/" className="text-lg font-bold tracking-tight">
            Upgradezin<span className="text-accent-500">.</span>
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {error ? (
          <p className="py-16 text-center text-zinc-500">{error === 'not-found' ? 'Produto não encontrado.' : 'Não foi possível carregar agora.'}</p>
        ) : !page ? (
          <p className="py-16 text-center text-zinc-500">Carregando…</p>
        ) : (
          <Content page={page} />
        )}
      </main>
    </div>
  );
}

function Content({ page }: { page: ProductPageData }) {
  const best = page.offers.find((o) => o.inStock);
  const rows = sheetRows(page.category, page.values);
  return (
    <>
      <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white sm:w-40">
          {page.image ? <img src={page.image} alt="" className="max-h-full max-w-full object-contain" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{CATEGORY_DEFS[page.category].name}</div>
          <h1 className="mt-1 text-lg font-semibold leading-snug sm:text-xl">{page.title}</h1>
          {best ? (
            <div className="mt-3">
              <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Menor preço à vista{effectiveCash(best) < best.priceCash ? ' com cupom' : ''}, {storeName(best.store)}
              </div>
              <div className="text-3xl font-bold tabular-nums">{brl(effectiveCash(best))}</div>
            </div>
          ) : (
            <div className="mt-3 text-sm font-medium text-red-500">Sem estoque nas lojas agora</div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold dark:border-zinc-800">Onde Comprar</h2>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {page.offers.map((o) => (
            <li key={`${o.store}-${o.storeSku}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <StoreDot store={o.store} />
                <span className="font-medium">{storeName(o.store)}</span>
                {o.marketplace && (
                  <span className="truncate text-xs text-amber-600" title={o.seller}>
                    · {o.seller}
                  </span>
                )}
                {o.openbox && <span className="text-xs text-amber-600">· produto aberto</span>}
                {!o.inStock && <span className="text-xs text-red-500">esgotado</span>}
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-1 text-lg font-bold tabular-nums">
                  {effectiveCash(o) < o.priceCash && <Ticket className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="com cupom" />}
                  {brl(effectiveCash(o))}
                </div>
                {o.priceCard && o.priceCard > o.priceCash + 1 && <div className="text-xs text-zinc-400">{brl(o.priceCard)} no cartão</div>}
              </div>
              <a
                href={o.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-accent-950 hover:bg-accent-400"
              >
                Ver na Loja <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {(o.coupon || o.promo) && (
                <div className="w-full text-xs">
                  {o.coupon && <CouponLine offer={o} />}
                  {o.promo && <PromoLine promo={o.promo} />}
                </div>
              )}
              <div className="w-full text-[11px] text-zinc-400">preço visto {ago(o.collectedAt)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold dark:border-zinc-800">Ficha Técnica</h2>
        <dl className="grid grid-cols-1 divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-y-0 dark:divide-zinc-800">
          {rows.map((r) => (
            <div key={r.key} className="flex justify-between gap-4 px-4 py-2 text-sm sm:border-b sm:border-zinc-100 sm:dark:border-zinc-800">
              <dt className="text-zinc-500">{r.label}</dt>
              <dd className={`text-right ${r.informed ? 'font-medium' : 'italic text-zinc-400'}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-semibold">Histórico de Preço</h2>
        <PriceHistoryBody offers={page.offers} />
      </section>
    </>
  );
}
