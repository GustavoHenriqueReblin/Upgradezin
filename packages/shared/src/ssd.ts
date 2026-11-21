import { isWhite, stripAccents } from './normalize.ts';
import type { SsdSpecs } from './types.ts';

const plain = (title: string) => stripAccents(title).toLowerCase();

/**
 * SSD interno (NVMe ou SATA). Descarta externo/portátil, servidor (U.2, enterprise), HD,
 * acessórios (gaveta, adaptador, dissipador, cabo) e kits com outras peças.
 */
export function isSsd(title: string): boolean {
  const t = plain(title).replace(/^[\s*]+/, '');
  // "SSD Kingston…", "HD SSD…", "Samsung SSD…", "Disco Sólido Interno…": SSD logo no começo do título.
  if (!/\bssd\b/.test(t.slice(0, 40)) && !/^(?:disco\s+solido|unidade\s+de\s+estado\s+solido)/.test(t)) return false;
  // Acessório para SSD (o título começa pelo acessório; "SSD … com dissipador" é SSD).
  if (/^(?:case|gaveta|adaptador|dissipador|heatsink|cabo|suporte|kit)\b/.test(t)) return false;
  return !/extern|portatil|portable|\busb\b|u\.2|enterprise|datacenter|servidor|\+\s*(?:processador|placa|memoria)/.test(t);
}

/** "1TB", "1,92 TB", "500 Gb", "512GB" → GB (1 TB = 1000 GB, como os fabricantes contam). */
function capacityOf(t: string): number | undefined {
  const tb = t.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*tb\b/);
  if (tb) return Math.round(Number(tb[1]!.replace(',', '.')) * 1000);
  const gb = t.match(/\b(\d{3,4})\s*gb?\b/);
  if (gb) return Number(gb[1]);
  // Forma curta de algumas lojas: "1T", "2T".
  const t1 = t.match(/\b([1248])\s*t\b/);
  return t1 ? Number(t1[1]) * 1000 : undefined;
}

export function extractSsdSpecs(title: string): SsdSpecs {
  const t = plain(title);
  const specs: SsdSpecs = {};
  if (/nvme|pcie|pci-e/.test(t)) specs.ssdInterface = 'nvme';
  else if (/sata/.test(t)) specs.ssdInterface = 'sata';
  if (/\bm\.?\s?2\b/.test(t)) specs.ssdForm = 'm2';
  else if (/2[.,]5\s*(?:"|''|pol|polegadas)?/.test(t) || specs.ssdInterface === 'sata') specs.ssdForm = '2.5';
  // M.2 SATA existe: interface SATA, formato M.2.
  if (specs.ssdForm === 'm2' && /\bm\.?\s?2\s*sata\b/.test(t)) specs.ssdInterface = 'sata';

  const cap = capacityOf(t);
  if (cap && cap >= 60 && cap <= 16000) specs.ssdCapacity = cap;

  // "PCIe 4.0 x4", "Pcie Gen 3.0", "Gen4", "PCIe 4"
  const gen = t.match(/pci-?e\s*(?:gen\s*)?([345])(?:\.0)?\b/)?.[1] ?? t.match(/\bgen\s*([345])\b/)?.[1];
  if (gen && specs.ssdInterface === 'nvme') specs.ssdPcie = Number(gen) as 3 | 4 | 5;

  // "Leitura: 6000 MB/s", "Leitura 5000mb/s", "leituras de até 7.000 MB/s"
  const read = t.match(/leitura[^\d]{0,20}(\d{1,2}[.]?\d{3}|\d{3,5})\s*mb/)?.[1];
  if (read) {
    const v = Number(read.replace('.', ''));
    if (v >= 100 && v <= 20000) specs.ssdRead = v;
  }
  // Sem a interface no título: SATA não passa de ~560 MB/s, então leitura maior é NVMe.
  if (!specs.ssdInterface && specs.ssdRead) specs.ssdInterface = specs.ssdRead > 600 ? 'nvme' : 'sata';
  return specs;
}

/** Faixas de capacidade do formulário e dos filtros (480, 500 e 512 GB são a mesma escolha). */
export const SSD_TIERS = [
  { value: 128, label: '120–128 GB', min: 100, max: 160 },
  { value: 250, label: '240–256 GB', min: 200, max: 300 },
  { value: 500, label: '480–512 GB', min: 400, max: 600 },
  { value: 1000, label: '1 TB', min: 900, max: 1100 },
  { value: 2000, label: '2 TB', min: 1800, max: 2200 },
  { value: 4000, label: '4 TB', min: 3600, max: 4400 },
] as const;

export const ssdTier = (gb: number | undefined): number | undefined => (gb ? SSD_TIERS.find((t) => gb >= t.min && gb <= t.max)?.value : undefined);

/** "1000" → "1 TB", "480" → "480 GB". */
export const ssdCapacityLabel = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toLocaleString('pt-BR')} TB` : `${gb} GB`);

const NOISE = new Set(['ssd', 'nvme', 'sata', 'iii', 'pcie', 'gen', 'm', 'leitura', 'gravacao', 'gb', 'tb', 'mb', 's', 'de', 'para', 'com', 'e', 'x', 'preto', 'azul', 'black', 'gamer', 'oem']);

/** Chave de modelo: marca + linha (sem números) + capacidade + interface. "Kingston NV3 1TB" de lojas diferentes viram um produto. */
export function ssdModelKey(title: string, brand?: string): string {
  const head = plain(title).split(/,| - /)[0]!;
  const s = extractSsdSpecs(title);
  const b = brand ? plain(brand).replace(/[^a-z0-9 ]+/g, '') : '';
  const words = [...new Set(head.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/))]
    // Fora números soltos e specs que já têm campo ("gen4", "pcie4", "x4", "2280").
    .filter((w) => w && !NOISE.has(w) && !b.split(' ').includes(w) && !/^\d+(gb|tb|mb|g|t)?$/.test(w) && !/^(?:gen|pcie|pci)\d*$|^x\d$/.test(w))
    .sort();
  return [b, ...words, s.ssdCapacity ? `${s.ssdCapacity}gb` : '', s.ssdInterface ?? '', isWhite(title) ? 'white' : ''].filter(Boolean).join(' ');
}
