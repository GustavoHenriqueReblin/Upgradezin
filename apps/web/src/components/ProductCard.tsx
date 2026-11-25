import { useState } from 'react';
import { ChartLine, Check, Clock, Plus, Ticket, TrendingDown } from 'lucide-react';
import { couponApplies, effectiveCash, ssdCapacityLabel, type Offer, type ProductGroup } from '@upgradezin/shared';
import type { CandidateCheck } from '../build.ts';
import { productHref, productKeyOf } from '../product.ts';
import type { CategoryId } from '@upgradezin/shared';
import { CompareButton } from './CompareControls.tsx';
import { AlertButton } from './PriceAlerts.tsx';
import { CompatBadge, IssueList } from './Compat.tsx';
import { PriceHistory } from './PriceHistory.tsx';
import { storeName } from '../stores.ts';
import { StoreDot } from './StoreDot.tsx';
import {
  ago,
  brl,
  CASE_TOWER_LABEL,
  COOLER_SOCKET_LABEL,
  COOLER_TYPE_LABEL,
  discountOf,
  EFF_COLOR,
  EFF_LABEL,
  FORM_FACTOR_LABEL,
  MEMORY_LABEL,
  MODULAR_LABEL,
  SOCKET_LABEL,
} from '../format.ts';

interface Props {
  group: ProductGroup;
  compareCategory?: CategoryId;
  /** Escolhendo peça para a montagem: como este produto ficaria nela. */
  compat?: CandidateCheck;
  onPick?: () => void;
  /** Já é a peça da montagem. */
  picked?: boolean;
  /** A montagem já tem outra peça desta categoria: escolher troca. */
  replacing?: boolean;
}

export function ProductCard({ group, compareCategory, compat, onPick, picked, replacing }: Props) {
  const { specs, best } = group;
  const chips: { label: string; cls?: string }[] = [];
  const HIGHLIGHT = 'bg-accent-100 text-accent-900 dark:bg-accent-900/50 dark:text-accent-100';
  // Placa de vídeo
  if (specs.gpuModel) chips.push({ label: specs.gpuModel, cls: HIGHLIGHT });
  if (specs.vram) chips.push({ label: `${specs.vram} GB${specs.vramType ? ` ${specs.vramType}` : ''}` });
  if (specs.lowProfile) chips.push({ label: 'Low Profile' });
  // Memória RAM
  if (specs.ramCapacity) {
    const n = specs.ramModules ?? 1;
    chips.push({ label: n > 1 ? `${specs.ramCapacity} GB (${n}x ${specs.ramCapacity / n} GB)` : `${specs.ramCapacity} GB`, cls: HIGHLIGHT });
  }
  if (specs.ramSpeed) chips.push({ label: `${specs.ramSpeed} MHz` });
  if (specs.ramLatency) chips.push({ label: `CL${specs.ramLatency}` });
  // Processador
  if (specs.cores) chips.push({ label: `${specs.cores} núcleos${specs.threads ? ` / ${specs.threads} threads` : ''}` });
  if (specs.cpuGen) chips.push({ label: specs.cpuGen });
  if (specs.igpu !== undefined && specs.cpuLine) chips.push({ label: specs.igpu ? 'Vídeo integrado' : 'Sem vídeo integrado' });
  if (specs.cooler !== undefined) chips.push({ label: specs.cooler ? 'Com cooler' : 'Sem cooler' });
  if (specs.unlocked && specs.cpuBrand === 'intel') chips.push({ label: 'Desbloqueado' });
  // Fonte
  if (specs.watts) chips.push({ label: `${specs.watts} W` });
  if (specs.efficiency)
    chips.push({
      label: `${specs.efficiencyCert === 'cybenetics' ? 'Cybenetics' : '80+'} ${EFF_LABEL[specs.efficiency]}`,
      cls: EFF_COLOR[specs.efficiency],
    });
  if (specs.modular) chips.push({ label: MODULAR_LABEL[specs.modular] });
  if (specs.atx) chips.push({ label: `ATX ${specs.atx}` });
  else if (specs.pcie5) chips.push({ label: 'PCIe 5' });
  if (specs.sfx) chips.push({ label: 'SFX' });
  // Placa-mãe
  if (specs.chipset) chips.push({ label: specs.chipset, cls: HIGHLIGHT });
  if (specs.socket) chips.push({ label: SOCKET_LABEL[specs.socket], cls: specs.cpuLine ? HIGHLIGHT : undefined });
  if (specs.formFactor) chips.push({ label: FORM_FACTOR_LABEL[specs.formFactor] });
  if (specs.memory) chips.push({ label: MEMORY_LABEL[specs.memory] });
  if (specs.wifi) chips.push({ label: 'Wi-Fi' });
  else if (specs.bluetooth) chips.push({ label: 'Bluetooth' });
  // SSD
  if (specs.ssdCapacity) chips.push({ label: ssdCapacityLabel(specs.ssdCapacity), cls: HIGHLIGHT });
  if (specs.ssdInterface) chips.push({ label: specs.ssdInterface === 'nvme' ? `NVMe${specs.ssdPcie ? ` PCIe ${specs.ssdPcie}.0` : ''}` : 'SATA' });
  if (specs.ssdForm) chips.push({ label: specs.ssdForm === 'm2' ? 'M.2' : '2,5"' });
  if (specs.ssdRead) chips.push({ label: `Leitura ${specs.ssdRead.toLocaleString('pt-BR')} MB/s` });
  // Cooler
  if (specs.coolerType) chips.push({ label: `${COOLER_TYPE_LABEL[specs.coolerType]}${specs.radiator ? ` ${specs.radiator} mm` : ''}`, cls: HIGHLIGHT });
  if (specs.coolerSockets?.length) chips.push({ label: specs.coolerSockets.map((s) => COOLER_SOCKET_LABEL[s] ?? s).join(', ') });
  else if (specs.coolerBrands?.length) chips.push({ label: specs.coolerBrands.length > 1 ? 'Intel e AMD' : specs.coolerBrands[0] === 'amd' ? 'Só AMD' : 'Só Intel' });
  if (specs.coolerTdp) chips.push({ label: `Até ${specs.coolerTdp} W` });
  // Gabinete
  if (specs.caseFormFactor) chips.push({ label: `Cabe ${FORM_FACTOR_LABEL[specs.caseFormFactor]}`, cls: HIGHLIGHT });
  if (specs.caseTower) chips.push({ label: CASE_TOWER_LABEL[specs.caseTower] });
  if (specs.caseGlass) chips.push({ label: 'Vidro' });
  if (specs.caseFans !== undefined) chips.push({ label: specs.caseFans ? `${specs.caseFans} Fans` : 'Sem fans' });
  // Aparência
  if (specs.white) chips.push({ label: 'Branca', cls: 'bg-white text-zinc-800 ring-1 ring-zinc-300 dark:bg-zinc-100' });
  if (specs.rgb) chips.push({ label: 'RGB' });

  const price = effectiveCash(best);
  const low = lowBadge(best, price);
  const [historyOpen, setHistoryOpen] = useState(false);
  const discount = Math.round(discountOf(best) * 100);
  const href = productHref(group);
  const compareKey = compareCategory ? productKeyOf(group) : undefined;

  const pickLabel = compat?.status === 'error' ? 'Escolher mesmo assim' : replacing ? 'Trocar na montagem' : 'Adicionar à montagem';
  return (
    <article className="relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {discount >= 5 && (
        <span className="absolute left-2 top-2 z-10 rounded-md bg-emerald-600 px-2 py-0.5 text-sm font-bold text-white shadow">-{discount}%</span>
      )}
      <div className="flex gap-3 p-4">
        <a
          href={href}
          tabIndex={-1}
          aria-hidden
          className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white"
        >
          {group.image ? <img src={group.image} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /> : null}
        </a>
        <div className="min-w-0 flex-1">
          {group.brand && <div className="text-xs font-semibold text-zinc-500">{group.brand}</div>}
          <h2 className="line-clamp-2 text-sm font-medium leading-snug" title={group.title}>
            {href ? (
              <a href={href} className="hover:text-accent-700 hover:underline dark:hover:text-accent-400">
                {group.title}
              </a>
            ) : (
              group.title
            )}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c.label} className={`rounded px-1.5 py-0.5 text-xs ${c.cls ?? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'}`}>
                {c.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {compat && (
        <div className="space-y-1.5 px-4 pb-3">
          <CompatBadge status={compat.status} />
          <IssueList issues={compat.issues} limit={2} />
        </div>
      )}

      <div className="mt-auto px-4 pb-2">
        <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          À vista{price < best.priceCash ? ' com Cupom' : ''}
        </div>
        <div className="text-2xl font-bold tabular-nums">{brl(price)}</div>
        {low && (
          <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <TrendingDown className="h-3.5 w-3.5 shrink-0" /> {low}
          </div>
        )}
        {(price < best.priceCash || (best.coupon && !couponApplies(best))) && <CouponLine offer={best} />}
        {best.promo && <PromoLine promo={best.promo} />}
        {best.priceCard && best.priceCard > best.priceCash + 1 && (
          <div className="text-[11px] text-zinc-400">{brl(best.priceCard)} no cartão</div>
        )}
      </div>

      <ul className="divide-y divide-zinc-100 border-t border-zinc-100 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        {group.offers.map((o, i) => (
          <li key={`${o.store}-${o.storeSku}`}>
            <a
              href={o.url}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-2 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${i === 0 ? 'font-semibold' : ''}`}
            >
              <StoreDot store={o.store} />
              <span>{storeName(o.store)}</span>
              {o.marketplace && <span className="truncate text-xs text-amber-600" title={o.seller}>· {o.seller}</span>}
              {o.openbox && <span className="text-xs text-amber-600">· produto aberto</span>}
              {!o.inStock && <span className="text-xs text-red-500">esgotado</span>}
              {effectiveCash(o) < o.priceCash && <Ticket className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-label="com cupom" />}
              <span className="ml-auto tabular-nums">{brl(effectiveCash(o))}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 px-4 py-1.5 text-[11px] text-zinc-400">
        <button onClick={() => setHistoryOpen(true)} className="flex items-center gap-1 font-medium text-zinc-500 hover:text-accent-600 dark:hover:text-accent-400">
          <ChartLine className="h-3.5 w-3.5" /> Histórico
        </button>
        <span>preço visto {ago(best.collectedAt)}</span>
      </div>
      {historyOpen && <PriceHistory title={group.title} offers={group.offers} onClose={() => setHistoryOpen(false)} />}
      {(onPick || compareKey) && (
        // Três botões só com ícone, do mesmo tamanho (o nome fica na dica e no leitor de tela).
        <div className="flex items-center gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800 [&>*]:flex-1">
          {onPick && (picked ? (
            <div role="img" aria-label="Na montagem" title="Na montagem" className="flex items-center justify-center py-1.5 text-accent-600 dark:text-accent-400">
              <Check aria-hidden="true" className="h-4 w-4" />
            </div>
          ) : (
            <button
              type="button"
              onClick={onPick}
              aria-label={pickLabel}
              title={pickLabel}
              className={`flex items-center justify-center rounded-lg px-2 py-1.5 ${
                compat?.status === 'error'
                  ? 'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40'
                  : 'accent-control'
              }`}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
            </button>
          ))}
          {compareCategory && compareKey && (
            <AlertButton iconOnly product={{ productKey: compareKey, category: compareCategory, title: group.title, ...(best.inStock && { price: effectiveCash(best) }) }} />
          )}
          {compareCategory && compareKey && <CompareButton category={compareCategory} productKey={compareKey} iconOnly />}
        </div>
      )}
    </article>
  );
}

/**
 * "cupom CODIGO · sem cupom R$ 672,99 · limitado · até 24/11" (loja que não informa o código:
 * "cupom de 10% na loja"). Cupom que não vale para este preço diz por quê, sem desconto.
 */
export function CouponLine({ offer }: { offer: Offer }) {
  const c = offer.coupon!;
  const what = c.code ? `cupom ${c.code}` : `cupom de ${c.percent ? `${c.percent}%` : brl(c.amount ?? 0)} na loja`;
  const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (!couponApplies(offer)) {
    const why = c.minTotal && offer.priceCash < c.minTotal ? `só a partir de ${brl(c.minTotal)}` : 'vencido';
    return (
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <Ticket className="h-3.5 w-3.5 shrink-0" />
        <span>
          {what} {why}
        </span>
      </div>
    );
  }
  const conditions = [c.limited && 'limitado', c.endsAt && `até ${day(c.endsAt)}`, c.minTotal && `a partir de ${brl(c.minTotal)}`, c.cashOnly && 'no PIX'].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-1 text-xs text-zinc-500" title={c.limited ? 'A loja avisa que os cupons são limitados: podem acabar antes da compra.' : undefined}>
      <Ticket className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span className="font-medium text-emerald-700 dark:text-emerald-400">{what}</span>
      <span>· sem cupom {brl(offer.priceCash)}</span>
      {conditions.length > 0 && <span>· {conditions.join(' · ')}</span>}
    </div>
  );
}

/** "Oferta até 21/11, 15h · restam 84": o preço volta ao normal quando a oferta acaba. */
export function PromoLine({ promo }: { promo: NonNullable<Offer['promo']> }) {
  const end = promo.endsAt ? new Date(promo.endsAt) : null;
  const two = (n: number) => String(n).padStart(2, '0');
  const when = end ? `${two(end.getDate())}/${two(end.getMonth() + 1)}, ${end.getHours()}h${end.getMinutes() ? two(end.getMinutes()) : ''}` : null;
  const parts = [when ? `Oferta até ${when}` : 'Oferta por tempo limitado', promo.left !== undefined && promo.left <= 50 ? `restam ${promo.left}` : null];
  return (
    <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" title="Quando a oferta acaba, o preço volta ao normal na loja.">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{parts.filter(Boolean).join(' · ')}</span>
    </div>
  );
}

/**
 * "Menor preço em 30 dias" quando o preço de agora é o menor que o banco viu nesse período.
 * Só com ao menos 7 dias de acompanhamento (antes disso, qualquer preço seria "o menor").
 */
export function lowBadge(best: Offer, price: number): string | null {
  const h = best.history;
  if (!h || !best.inStock) return null;
  const since = Date.parse(h.since);
  const days = (Date.now() - since) / 86_400_000;
  if (days < 7 || price > h.min30 + 0.005) return null;
  if (days >= 30) return 'Menor preço em 30 dias';
  const d = new Date(since);
  return `Menor preço desde ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
