import { trackActivity, useActivityView } from '../activity.ts';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Ticket, TrendingDown } from 'lucide-react';
import { CATEGORY_DEFS, effectiveCash, sheetRows, type Offer, type ProductPage as ProductPageData } from '@upgradezin/shared';
import { ago, brl } from '../format.ts';
import { splitOffers } from '../product.ts';
import { storeName } from '../stores.ts';
import { PriceHistoryBody } from './PriceHistory.tsx';
import { CouponLine, lowBadge, PromoLine } from './ProductCard.tsx';
import { StoreDot } from './StoreDot.tsx';
import { fetchProduct } from '../compare.ts';
import { CompareButton } from './CompareControls.tsx';
import { AlertButton } from './PriceAlerts.tsx';
import { CatalogHeader } from './CatalogHeader.tsx';

/**
 * Página do produto: ofertas de cada loja, ficha técnica (todos os campos da categoria; o que a
 * ficha não tem aparece como "não informado") e histórico de preço. Só do banco.
 */
export function ProductPage({ productKey }: { productKey: string }) {
  const [page, setPage] = useState<ProductPageData | null>(null);
  const [error, setError] = useState<'not-found' | 'failed' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchProduct(productKey, controller.signal)
      .then((p) => {
        setPage(p);
        document.title = `${p.title} · Upgradezin`;
      })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message === 'not-found' ? 'not-found' : 'failed'); });
    return () => controller.abort();
  }, [productKey]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <CatalogHeader category={page?.category} />
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

const offerKey = (o: Offer) => `${o.store}-${o.storeSku}`;

function Content({ page }: { page: ProductPageData }) {
  useActivityView({ screen: 'product', category: page.category, product: page.key });
  // Padrão da busca: só o novo vendido pela própria loja; produto aberto e outros vendedores atrás do botão.
  const { rest, others, best, othersInStock, history } = useMemo(() => splitOffers(page.offers), [page.offers]);
  const [showOthers, setShowOthers] = useState(false);
  const rows = sheetRows(page.category, page.values);
  const price = best ? effectiveCash(best) : 0;
  const low = best ? lowBadge(best, price) : null;
  return (
    <>
      <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white sm:w-40">
          {page.image ? <img src={page.image} alt="" className="max-h-full max-w-full object-contain" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-zinc-500">{CATEGORY_DEFS[page.category].name}</div>
          <h1 className="mt-1 text-lg font-semibold leading-snug sm:text-xl">{page.title}</h1>
          {best ? (
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  À vista{price < best.priceCash ? ' com Cupom' : ''} · {storeName(best.store)}
                </div>
                <div className="text-3xl font-bold tabular-nums">{brl(price)}</div>
                {low && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <TrendingDown className="h-3.5 w-3.5 shrink-0" /> {low}
                  </div>
                )}
                {(price < best.priceCash || best.coupon) && <CouponLine offer={best} />}
                {best.promo && <PromoLine promo={best.promo} />}
                {best.priceCard && best.priceCard > best.priceCash + 1 && <div className="text-xs text-zinc-400">{brl(best.priceCard)} no cartão</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={best.url}
                  onClick={() => trackActivity({ screen: 'product', action: 'offer', category: page.category, store: best.store, product: page.key })}
                  target="_blank"
                  rel="noreferrer"
                  className="button-link flex items-center gap-1.5 rounded-lg accent-control px-4 font-medium"
                >
                  Ver na loja <ExternalLink className="h-4 w-4" />
                </a>
                <AlertButton product={{ productKey: page.key, category: page.category, title: page.title, price: effectiveCash(best) }} />
                <CompareButton category={page.category} productKey={page.key} />
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm">
              <div className="font-medium text-red-500">Sem estoque nas lojas agora</div>
              {othersInStock > 0 && (
                <div className="text-zinc-500">
                  {othersInStock === 1 ? 'Há 1 oferta' : `Há ${othersInStock} ofertas`} de produto aberto ou de outros vendedores abaixo.
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <AlertButton product={{ productKey: page.key, category: page.category, title: page.title }} />
                <CompareButton category={page.category} productKey={page.key} />
              </div>
            </div>
          )}
        </div>
      </section>

      {(rest.length > 0 || others.length > 0) && (
        <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold dark:border-zinc-800">{best ? 'Outras ofertas' : 'Onde comprar'}</h2>
          {rest.length > 0 && <OfferList offers={rest} />}
          {others.length > 0 && (
            <div className={rest.length ? 'border-t border-zinc-100 dark:border-zinc-800' : ''}>
              <button
                type="button"
                onClick={() => setShowOthers((v) => !v)}
                className="flex w-full items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:text-accent-600 dark:text-zinc-300 dark:hover:text-accent-400"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showOthers ? 'rotate-180' : ''}`} />
                {showOthers ? 'Esconder' : 'Ver também'} produto aberto e outros vendedores ({others.length})
              </button>
              {showOthers && <OfferList offers={others} />}
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold dark:border-zinc-800">Ficha técnica</h2>
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
        <h2 className="mb-3 font-semibold">Histórico de preço</h2>
        <PriceHistoryBody offers={history} />
      </section>
    </>
  );
}

/** Linhas de oferta: a linha toda leva à loja (como no card da busca); o botão e o melhor preço ficam só em cima. */
function OfferList({ offers }: { offers: Offer[] }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {offers.map((o) => (
        <li key={offerKey(o)}>
          <a
            href={o.url}
            onClick={() => trackActivity({ screen: 'product', action: 'offer', store: o.store, product: o.productKey })}
            target="_blank"
            rel="noreferrer"
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${o.inStock ? '' : 'opacity-60'}`}
          >
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
              <div className="flex items-center justify-end gap-1 font-bold tabular-nums">
                {effectiveCash(o) < o.priceCash && <Ticket className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="com cupom" />}
                {brl(effectiveCash(o))}
              </div>
              {o.priceCard && o.priceCard > o.priceCash + 1 && <div className="text-xs text-zinc-400">{brl(o.priceCard)} no cartão</div>}
            </div>
            {(o.coupon || o.promo) && (
              <div className="w-full text-xs">
                {o.coupon && <CouponLine offer={o} />}
                {o.promo && <PromoLine promo={o.promo} />}
              </div>
            )}
            <div className="w-full text-[11px] text-zinc-400">preço visto {ago(o.collectedAt)}</div>
          </a>
        </li>
      ))}
    </ul>
  );
}
