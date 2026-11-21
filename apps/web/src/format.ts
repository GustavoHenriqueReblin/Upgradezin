import { effectiveCash, type Efficiency, type MemoryType, type Offer, type Socket } from '@upgradezin/shared';

export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const EFF_LABEL: Record<Efficiency, string> = {
  white: 'White',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  titanium: 'Titanium',
};

export const EFF_COLOR: Record<Efficiency, string> = {
  white: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100',
  bronze: 'bg-orange-200 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
  silver: 'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-50',
  gold: 'bg-amber-200 text-amber-900 dark:bg-amber-800/70 dark:text-amber-50',
  platinum: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-50',
  titanium: 'bg-violet-200 text-violet-900 dark:bg-violet-900/60 dark:text-violet-50',
};

export const FORM_FACTOR_LABEL = { 'mini-itx': 'Mini-ITX', matx: 'Micro-ATX', atx: 'ATX', eatx: 'E-ATX' } as const;

export const SOCKET_LABEL: Record<Socket, string> = {
  AM5: 'AMD AM5',
  AM4: 'AMD AM4',
  LGA1851: 'Intel LGA1851',
  LGA1700: 'Intel LGA1700',
  LGA1200: 'Intel LGA1200',
  LGA1151: 'Intel LGA1151',
};

export const MEMORY_LABEL: Record<MemoryType, string> = { ddr4: 'DDR4', ddr5: 'DDR5' };

/** Ordenações extras por categoria (preço menor/maior são fixas na tela). */
export const SORT_LABEL = {
  price: 'Menor Preço à Vista',
  'price-desc': 'Maior Preço à Vista',
  discount: 'Maior Desconto',
  efficiency: 'Melhor Eficiência',
  'per-watt': 'Melhor Preço por Watt',
  watts: 'Maior Potência',
  cores: 'Mais Núcleos',
  vram: 'Mais Memória de Vídeo',
  'per-gb': 'Menor Preço por GB',
  speed: 'Maior Frequência',
  'per-tb': 'Menor Preço por TB',
  read: 'Maior Leitura',
} as const;

export const SSD_INTERFACE_LABEL = { nvme: 'NVMe (M.2)', sata: 'SATA' } as const;

export const COOLER_TYPE_LABEL = { air: 'Air Cooler', water: 'Water Cooler' } as const;

export const CASE_TOWER_LABEL = { mini: 'Mini Tower', mid: 'Mid Tower', full: 'Full Tower' } as const;

/** Encaixes que o título do cooler lista. */
export const COOLER_SOCKET_LABEL: Record<string, string> = { AM5: 'AM5', AM4: 'AM4', LGA1851: 'LGA1851', LGA1700: 'LGA1700', LGA1200: 'LGA1200', LGA115X: 'LGA115x' };

export const CPU_BRAND_LABEL = { amd: 'AMD', intel: 'Intel' } as const;

export const GPU_MAKER_LABEL = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' } as const;

export const COLOR_LABEL = { black: 'Preta', white: 'Branca' } as const;

export const PSU_FORMAT_LABEL = { atx: 'ATX', sfx: 'SFX (Compacta)' } as const;

export const MODULAR_LABEL = { full: 'Full Modular', semi: 'Semi Modular', none: 'Não Modular', unknown: 'Não Informado' };

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 48 * 3600) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} dias`;
}

/** Desconto real contra o preço "de" da loja, já contando o cupom (0 a 1; 0 sem preço "de"). */
export function discountOf(o: Offer): number {
  return o.listPrice && o.listPrice > 0 ? Math.max(0, 1 - effectiveCash(o) / o.listPrice) : 0;
}
