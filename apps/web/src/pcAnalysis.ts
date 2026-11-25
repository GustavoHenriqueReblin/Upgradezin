import { useEffect, useState } from 'react';
import type { Balance, PcProfile, Resolution, TipKind, Verdict } from '@upgradezin/shared';

/** Textos e dados do diagnóstico do PC usados no Identificar gargalo, no orçamento e no comparador. */

/** Nome curto da resolução nas frases da tela ("Em Full HD, ..."). */
export const SCREEN_LABEL: Record<Resolution, string> = { '1080p': 'Full HD', '1440p': 'Quad HD', '4k': '4K' };

export const VERDICT: Record<Verdict, string> = {
  gpu: 'A placa de vídeo segura o PC',
  cpu: 'O processador segura o PC',
  balanced: 'Processador e placa de vídeo equilibrados',
  unknown: 'Não deu para avaliar o equilíbrio',
};

export const KIND: Record<TipKind, { label: string; cls: string }> = {
  upgrade: { label: 'Upgrade', cls: 'bg-accent-500/15 text-accent-700 dark:text-accent-300' },
  free: { label: 'Grátis', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  attention: { label: 'Atenção', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  info: { label: 'Observação', cls: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300' },
};

type SheetValues = Record<string, number | string | boolean>;

/** Ficha do catálogo pela URL (null = sem pedido); some quando a URL muda e só volta com a resposta certa. */
function useCatalogSheet(url: string | null): SheetValues | undefined {
  const [sheet, setSheet] = useState<{ url: string; values: SheetValues } | undefined>();
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<SheetValues>) : undefined))
      .then((values) => alive && values && setSheet({ url, values }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return sheet && sheet.url === url ? sheet.values : undefined;
}

/**
 * Ficha técnica do processador da pessoa: o mesmo modelo no catálogo (GET /api/sheets/cpu). Sem ela
 * (modelo que o catálogo não tem, ou sem resposta), a análise usa a tabela por linha.
 */
export function useCpuSheet(model: string | undefined): SheetValues | undefined {
  return useCatalogSheet(model ? `/api/sheets/cpu?model=${encodeURIComponent(model)}` : null);
}

/**
 * Campos do chip da placa de vídeo da pessoa (GET /api/sheets/gpu): arquitetura, memória, barramento etc. pelo
 * modelo e a VRAM, com o valor mais comum no catálogo. O CPU-Z traz pouco do vídeo.
 */
export function useGpuSheet(model: string | undefined, vram?: number): SheetValues | undefined {
  return useCatalogSheet(model ? `/api/sheets/gpu?model=${encodeURIComponent(model)}${vram ? `&vram=${vram}` : ''}` : null);
}

/** O veredito em uma frase, na tela da pessoa ("Em Full HD, a RTX 3060 fica esperando o Ryzen 5 3600."). */
export function verdictSummary(pc: PcProfile, balance: Balance): string {
  const screen = `${SCREEN_LABEL[balance.res]}${balance.hz && balance.hz >= 120 ? ` a ${balance.hz} Hz` : ''}`;
  const cpuName = pc.cpu?.title ?? 'o processador';
  const gpuName = pc.gpu?.specs.gpuModel ?? (pc.gpu ? pc.gpu.title : 'o vídeo integrado');
  return (
    balance.verdict === 'gpu'
      ? `Em ${screen}, o ${cpuName} aguenta mais do que ${pc.gpu ? `a ${gpuName}` : gpuName} entrega.`
      : balance.verdict === 'cpu'
        ? `Em ${screen}, ${pc.gpu ? `a ${gpuName}` : 'a placa de vídeo'} fica esperando o ${cpuName}.`
        : balance.verdict === 'balanced'
          ? `Em ${screen}, processador e placa de vídeo estão equilibrados. Trocar só um deles rende pouco.`
          : `Não reconheci ${balance.missing} na tabela de desempenho. As outras dicas continuam valendo.`
  );
}
