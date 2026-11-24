import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { productPath, type UpgradeAction, type UpgradePick } from '@upgradezin/shared';
import { brl } from '../format.ts';
import { storeName } from '../stores.ts';
import { StoreDot } from './StoreDot.tsx';

/**
 * As 5 peças que mais acertam a dica de upgrade, com o preço de agora (POST /api/upgrade/picks, só do
 * banco). Processador e placa de vídeo: primeiro as que resolvem o gargalo, da mais barata; depois as
 * que mais sobem por real, com o ganho de cada uma. Memória, fonte e SSD: as mais baratas que servem.
 * Cada uma abre a página do produto, com os preços de todas as lojas.
 */
export function UpgradePicks({ action }: { action: UpgradeAction }) {
  const [picks, setPicks] = useState<UpgradePick[] | null>(null);
  const key = JSON.stringify([action.slot, action.filters, action.context]);

  useEffect(() => {
    let alive = true;
    setPicks(null);
    fetch('/api/upgrade/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: action.slot, filters: action.filters, ...(action.context && { context: action.context }) }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<UpgradePick[]>) : []))
      .then((p) => alive && setPicks(p))
      .catch(() => alive && setPicks([]));
    return () => {
      alive = false;
    };
    // `key` resume a ação: a mesma dica não busca de novo a cada render.
  }, [key]);

  if (!picks) return <p className="mt-3 text-xs text-zinc-500">Procurando as melhores ofertas de agora…</p>;
  if (!picks.length) return null;
  const ranked = picks.some((p) => p.gain !== undefined);
  const resolving = picks.some((p) => p.resolves);

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {resolving ? 'Resolvem o gargalo, da mais barata' : ranked ? 'Mais desempenho por real, agora' : 'Mais baratas que servem, agora'}
      </p>
      <ol className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {picks.map((p, i) => {
          const model = action.slot === 'gpu' ? p.offer.specs.gpuModel : action.slot === 'cpu' ? [p.offer.specs.cpuLine, p.offer.specs.cpuModel].filter(Boolean).join(' ') : undefined;
          return (
            <li key={`${p.offer.store}:${p.offer.storeSku}`}>
              <a
                href={p.offer.productKey ? productPath(p.offer.productKey) : p.offer.url}
                {...(!p.offer.productKey && { target: '_blank', rel: 'noopener noreferrer' })}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <span className="w-4 shrink-0 text-xs tabular-nums text-zinc-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {model && <span className="font-medium">{model}</span>}
                    {p.gain !== undefined && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">+{Math.round(p.gain * 100)}%</span>
                    )}
                    {p.resolves && <span className="rounded bg-accent-500/15 px-1.5 py-0.5 text-xs font-medium text-accent-700 dark:text-accent-300">resolve o gargalo</span>}
                    {p.needsBios && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300" title="A sua placa-mãe aceita este processador depois de atualizar a BIOS">
                        atualize a BIOS
                      </span>
                    )}
                  </span>
                  <span className={`flex items-center gap-1.5 text-xs text-zinc-500 ${model ? '' : 'text-sm text-zinc-700 dark:text-zinc-300'}`}>
                    <StoreDot store={p.offer.store} />
                    <span className="truncate">
                      {storeName(p.offer.store)} · {p.offer.title}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right font-semibold tabular-nums">{brl(p.price)}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              </a>
            </li>
          );
        })}
      </ol>
      {ranked && (
        <p className="mt-1.5 text-xs text-zinc-500">
          Ganho estimado em jogos sobre a sua peça atual: processador pela ficha técnica (arquitetura, clock máximo, cache e núcleos), placa de vídeo pela média de
          análises do chip. &quot;Resolve o gargalo&quot;: chega ao equilíbrio com a outra peça na sua tela. Preço à vista com cupom, da loja mais barata; clique para ver
          todas.
        </p>
      )}
    </div>
  );
}
