import { useState, type ReactNode } from 'react';
import { Check, Cpu, Link2, Minus, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { BUILD_SLOTS, CATEGORY_DEFS, checkBuild, effectiveCash, MAX_BUILD_DRIVES, type BuildIssue, type BuildSlot, type PcProfile } from '@upgradezin/shared';
import { bestOffer, buildDrives, buildTotals, MAX_QTY, QTY_SLOTS, qtyOf, toBuild, type SavedBuild } from '../build.ts';
import { ago, brl } from '../format.ts';
import { shareBuild, shareUrl } from '../share.ts';
import { storeName } from '../stores.ts';
import { productHref } from '../product.ts';
import { StoreDot } from './StoreDot.tsx';
import { CATEGORY_ICONS } from './CategoryPicker.tsx';
import { CompatBadge, IssueList } from './Compat.tsx';
import { ImportPc } from './ImportPc.tsx';
import { loadPc, PC_SLOTS } from '../pc.ts';

interface Props {
  build: SavedBuild;
  /** Sem `edit`: só leitura (montagem aberta por link). */
  edit?: {
    onOpen: (slot: BuildSlot, driveIndex?: number) => void;
    onRemove: (slot: BuildSlot, driveIndex?: number) => void;
    onQty: (slot: BuildSlot, qty: number) => void;
    onClear: () => void;
    /** Peças atuais lidas do relatório do CPU-Z. */
    onImport: (pc: PcProfile) => void;
    /** "Já tenho": a peça sai do total e conta como parte do PC atual. */
    onOwned: (slot: BuildSlot, owned: boolean, driveIndex?: number) => void;
  };
  /** Título e texto do topo (só leitura: de onde veio a montagem e as ações). */
  header?: ReactNode;
}

/** O que cada peça vazia vai buscar, em uma linha. */
const EMPTY_HINT: Record<BuildSlot, string> = {
  motherboard: 'Comece por aqui: ela define o processador e a memória que servem.',
  cpu: 'A busca já vem com a plataforma da placa-mãe.',
  ram: 'A busca já vem com o tipo de memória da placa-mãe.',
  gpu: 'Opcional se o processador tiver vídeo integrado.',
  psu: 'A busca já vem com a potência recomendada para as peças escolhidas.',
  ssd: 'Onde ficam o sistema e os jogos.',
  cooler: 'Opcional se o processador vier com cooler.',
  case: 'A busca já vem com o formato da placa-mãe.',
};

const LEVEL_ORDER: Record<BuildIssue['level'], number> = { error: 0, warn: 1, unknown: 2, info: 3 };

/** Montagem peça por peça, com compatibilidade revalidada a cada mudança e o total sempre à mostra. */
export function BuildView({ build, edit, header }: Props) {
  const check = checkBuild(toBuild(build));
  const drives = buildDrives(build);
  const totals = buildTotals(build);
  const errors = check.issues.filter((i) => i.level === 'error').length;
  const warns = check.issues.filter((i) => i.level === 'warn').length;
  const hasItems = totals.parts + totals.current > 0;
  const [importing, setImporting] = useState(false);

  return (
    <div className="mx-auto w-full max-w-4xl pb-28">
      {header ?? (
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Montar peça por peça</h2>
            <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">Escolha as peças e acompanhe a compatibilidade da montagem.</p>
          </div>
          {edit && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {hasItems && (
                <button onClick={edit.onClear} className="text-sm text-zinc-500 hover:text-red-600 hover:underline">
                  Limpar montagem
                </button>
              )}
              <button
                onClick={() => setImporting(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-medium transition hover:border-accent-500 focus-visible:outline-2 focus-visible:outline-accent-500 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <Cpu className="h-4 w-4" /> Importar meu PC
              </button>
              {hasItems && <ShareButton build={build} />}
            </div>
          )}
          {edit && importing && (
            <ImportPc
              // PC já importado (no Identificar gargalo ou antes): abre direto na prévia, com "Escolher outro arquivo".
              initial={loadPc()}
              onClose={() => setImporting(false)}
              replacing={PC_SLOTS.filter((s) => build[s] && !build[s]!.current).map((s) => `a ${CATEGORY_DEFS[s].name.toLowerCase()}`)}
              onApply={(pc) => {
                edit.onImport(pc);
                setImporting(false);
              }}
            />
          )}
        </div>
      )}

      <ol className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {BUILD_SLOTS.flatMap<{ slot: BuildSlot; driveIndex: number }>((slot) => slot === 'ssd'
          ? Array.from({ length: Math.max(1, drives.length) }, (_, driveIndex) => ({ slot, driveIndex }))
          : [{ slot, driveIndex: 0 }]).map(({ slot, driveIndex }) => {
          const item = slot === 'ssd' ? drives[driveIndex] : build[slot];
          const Icon = CATEGORY_ICONS[slot];
          const name = slot === 'ssd' ? `Disco ${driveIndex + 1}` : CATEGORY_DEFS[slot].name;
          const issues = driveIndex === 0 ? check.issues.filter((i) => i.parts.includes(slot)).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) : [];
          const offer = item ? bestOffer(item) : undefined;
          const href = item && offer ? productHref({ best: offer, offers: item.offers }) : undefined;
          const qty = item ? qtyOf(item) : 1;
          return (
            <li key={`${slot}:${driveIndex}`} className="px-4 py-3.5 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600 dark:text-accent-400">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{name}</div>
                  {!item &&
                    (!edit ? (
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">Não escolhida.</div>
                    ) : slot === 'gpu' && build.cpu?.specs.igpu === false ? (
                      <div className="text-sm font-medium text-amber-700 dark:text-amber-300">Obrigatória: o processador escolhido não tem vídeo integrado.</div>
                    ) : slot === 'cooler' && build.cpu?.specs.cooler === false ? (
                      <div className="text-sm font-medium text-amber-700 dark:text-amber-300">Obrigatório: o processador escolhido não vem com cooler.</div>
                    ) : (
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">{EMPTY_HINT[slot]}</div>
                    ))}
                </div>
                {item && check.status[slot] && <CompatBadge status={check.status[slot]!} />}
                {!item && edit && (
                  <button
                    onClick={() => edit.onOpen(slot, driveIndex)}
                    aria-label={`Escolher ${name}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl accent-control px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                  >
                    <Plus className="h-4 w-4" /> Escolher
                  </button>
                )}
              </div>

              {item && (
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div
                      className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg ${item.image ? 'bg-white' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'}`}
                    >
                      {item.image ? <img src={item.image} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /> : <Icon className="h-7 w-7" strokeWidth={1.5} />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        {(item.brand || item.current) && (
                          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
                            {item.current && <span className="rounded-md bg-accent-500/15 px-1.5 py-0.5 text-accent-700 dark:text-accent-300">Atual</span>}
                            {item.brand}
                          </div>
                        )}
                        <div className="line-clamp-2 text-sm font-medium leading-snug" title={item.title}>
                          {href ? <a href={href} className="hover:text-accent-700 hover:underline dark:hover:text-accent-400">{item.title}</a> : item.title}
                        </div>
                      </div>
                      {!edit && qty > 1 && <div className="text-sm text-zinc-500">Quantidade: {qty}</div>}
                      {edit && QTY_SLOTS.includes(slot) && !item.current && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-zinc-500">Quantidade</span>
                          <div className="flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700">
                            <button
                              onClick={() => edit.onQty(slot, qty - 1)}
                              disabled={qty <= 1}
                              title="Menos"
                              className="px-2 py-1 text-zinc-500 hover:text-accent-600 disabled:opacity-30"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-6 text-center font-semibold tabular-nums">{qty}</span>
                            <button
                              onClick={() => edit.onQty(slot, qty + 1)}
                              disabled={qty >= MAX_QTY}
                              title="Mais"
                              className="px-2 py-1 text-zinc-500 hover:text-accent-600 disabled:opacity-30"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                      <IssueList issues={issues} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-end justify-between gap-3 sm:flex-col sm:items-end">
                    {item.current && <div className="text-sm text-zinc-500 sm:text-right">Você já tem</div>}
                    {edit && item.offers.length > 0 && <OwnedSwitch on={!!item.current} onChange={(v) => edit.onOwned(slot, v, driveIndex)} />}
                    {offer && !item.current && (
                      <a href={offer.url} target="_blank" rel="noreferrer" className="hover:underline sm:text-right">
                        <div className="text-lg font-bold tabular-nums">{brl(effectiveCash(offer) * qty)}</div>
                        {qty > 1 && (
                          <div className="text-xs tabular-nums text-zinc-500">
                            {qty} × {brl(effectiveCash(offer))}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-zinc-500 sm:justify-end">
                          <StoreDot store={offer.store} />
                          {storeName(offer.store)}
                          {!offer.inStock && <span className="text-red-500">esgotado</span>}
                        </div>
                        <div className="text-[11px] text-zinc-400">preço visto {ago(offer.collectedAt)}</div>
                      </a>
                    )}
                    {edit && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => edit.onOpen(slot, driveIndex)}
                        className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-sm hover:border-accent-500 dark:border-zinc-700"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Trocar
                      </button>
                      <button
                        onClick={() => edit.onRemove(slot, driveIndex)}
                        title="Remover"
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-zinc-500 hover:border-red-400 hover:text-red-600 dark:border-zinc-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    )}
                  </div>
                </div>
              )}

              {slot === 'ssd' && item && edit && driveIndex === drives.length - 1 && drives.length < MAX_BUILD_DRIVES && (
                <button type="button" onClick={() => edit.onOpen('ssd', driveIndex + 1)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm hover:border-accent-500 dark:border-zinc-700">
                  <Plus className="h-4 w-4" /> Adicionar disco
                </button>
              )}

              {/* Recomendação de fonte, mesmo antes de escolher uma. */}
              {slot === 'psu' && check.power && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  Consumo máximo estimado de {check.power.estimate} W · fonte recomendada a partir de {check.power.recommended} W
                  {check.power.partial && ' (sem contar as peças que faltam)'}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {hasItems && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {totals.parts ? `Total à vista · ${totals.parts} ${totals.parts === 1 ? 'peça nova' : 'peças novas'}` : 'Nenhuma peça nova ainda'}
              </div>
              <div className="text-2xl font-bold tabular-nums">{brl(totals.best)}</div>
            </div>
            <div className="hidden flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 sm:flex">
              {totals.perStore.map((s) => (
                <span key={s.store} className="flex items-center gap-1.5">
                  <StoreDot store={s.store} />
                  Tudo na {storeName(s.store)}: {s.missing ? `faltam ${s.missing}` : <b className="tabular-nums">{brl(s.total)}</b>}
                </span>
              ))}
            </div>
            <div className="ml-auto text-sm font-medium">
              {errors ? (
                <span className="text-red-600 dark:text-red-400">
                  {errors} {errors === 1 ? 'incompatibilidade' : 'incompatibilidades'}
                </span>
              ) : warns ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {warns} {warns === 1 ? 'ressalva' : 'ressalvas'}
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">Tudo compatível até aqui</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Já tenho": a peça escolhida numa loja é uma que a pessoa já tem (sai do total). */
function OwnedSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title={on ? 'Contar no total de novo' : 'Já tenho esta peça: tirar do total'}
      className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
    >
      Já tenho
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-accent-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

/**
 * "Compartilhar": grava uma cópia da montagem no servidor e copia o link. A mesma montagem
 * reaproveita o link já gerado; mudou alguma peça, gera outro.
 */
function ShareButton({ build }: { build: SavedBuild }) {
  const [state, setState] = useState<'idle' | 'saving' | 'copied' | 'error'>('idle');
  const [saved, setSaved] = useState<{ json: string; url: string } | null>(null);

  const share = async () => {
    setState('saving');
    try {
      const json = JSON.stringify(build);
      const url = saved?.json === json ? saved.url : shareUrl(await shareBuild(build));
      setSaved({ json, url });
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState((s) => (s === 'copied' ? 'idle' : s)), 2500);
    } catch {
      setState('error');
    }
  };

  const copied = state === 'copied';
  return (
    <button
      onClick={share}
      disabled={state === 'saving'}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
        copied ? 'border-accent-500 text-accent-600 dark:text-accent-400' : 'border-zinc-300 hover:border-accent-500 dark:border-zinc-700'
      }`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
      {state === 'saving' ? 'Gerando link…' : copied ? 'Link copiado' : state === 'error' ? 'Não deu, tentar de novo' : 'Compartilhar'}
    </button>
  );
}
