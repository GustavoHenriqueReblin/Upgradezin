import type { Efficiency, LookSpecs, PsuSpecs } from './types.ts';

/**
 * Versão branca do produto. "80 Plus White" é nível de eficiência, não cor:
 * sai antes de procurar ("Fonte Gamemax GS600, 80 Plus White, Black" é preta).
 */
export function isWhite(title: string): boolean {
  const t = stripAccents(title).toLowerCase().replace(/80\s*\+?\s*plus\s*white/g, ' ');
  return /\b(branc[ao]|white|snow)\b/.test(t);
}

/** Cor e iluminação, iguais para qualquer categoria. */
export function extractLookSpecs(title: string): LookSpecs {
  const t = stripAccents(title).toLowerCase();
  const look: LookSpecs = {};
  if (isWhite(title)) look.white = true;
  if (/\ba?rgb\b/.test(t)) look.rgb = true;
  return look;
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function parseBRL(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/\s/g, '').match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  if (!m) return undefined;
  return Number(m[1]!.replace(/\./g, '') + '.' + m[2]);
}

const BRAND_ALIASES: Record<string, string> = {
  'aero cool': 'Aerocool',
  aerocool: 'Aerocool',
  'be quiet': 'Be Quiet!',
  'be quiet!': 'Be Quiet!',
  'brasil pc': 'BRX',
  'brazil pc': 'BRX',
  brazilpc: 'BRX',
  c3techtech: 'C3Tech',
  c3tech: 'C3Tech',
  'cooler master': 'Cooler Master',
  coolermaster: 'Cooler Master',
  kmex: 'K-Mex',
  'k-mex': 'K-Mex',
  montech: 'Montech',
  xpg: 'XPG',
  adata: 'XPG',
  msi: 'MSI',
  asus: 'ASUS',
  asrock: 'ASRock',
  nzxt: 'NZXT',
  fsp: 'FSP',
  pcyes: 'PCYes',
  mach1: 'MACH1',
  'lian li': 'Lian Li',
  'super flower': 'Super Flower',
  superflower: 'Super Flower',
  generico: 'Genérica',
  gamemax: 'GameMax',
  pny: 'PNY',
  xfx: 'XFX',
  powercolor: 'PowerColor',
  inno3d: 'Inno3D',
  deepcool: 'DeepCool',
  pcfort: 'PCFort',
  sate: 'SATE',
  oex: 'OEX',
  tgt: 'TGT',
  brx: 'BRX',
  dex: 'DEX',
  amd: 'AMD',
  'rise mode': 'Rise Mode',
  generica: 'Genérica',
  'genérica': 'Genérica',
  outros: 'Outros',
  outras: 'Outros',
  oem: 'Outros',
};

export function normalizeBrand(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const k = raw.trim().toLowerCase();
  if (BRAND_ALIASES[k]) return BRAND_ALIASES[k];
  const plain = stripAccents(k);
  if (BRAND_ALIASES[plain]) return BRAND_ALIASES[plain];
  // Padroniza capitalização: "KALKAN"/"kalkan" -> "Kalkan". Siglas conhecidas ficam no dicionário acima.
  return raw
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

const EFF_WORDS: Record<string, Efficiency> = {
  white: 'white',
  standard: 'white',
  bronze: 'bronze',
  silver: 'silver',
  gold: 'gold',
  platinum: 'platinum',
  platinium: 'platinum',
  titanium: 'titanium',
  diamond: 'titanium',
};

export function extractWatts(title: string): number | undefined {
  for (const m of title.matchAll(/(\d{3,4})\s*w(?:atts?)?\b/gi)) {
    const n = Number(m[1]);
    if (n >= 150 && n <= 2500) return n;
  }
  return undefined;
}

export function extractPsuSpecs(title: string): PsuSpecs & LookSpecs {
  const t = stripAccents(title).toLowerCase();
  const specs: PsuSpecs & LookSpecs = extractLookSpecs(title);

  const watts = extractWatts(t);
  if (watts) specs.watts = watts;

  const plus = t.match(/80\s*\+?\s*plus\s*(white|standard|bronze|silver|gold|platinum|platinium|titanium)?/);
  const cyb = t.match(/cybenetics\s*(bronze|silver|gold|platinum|titanium|diamond)/);
  if (plus) {
    specs.efficiency = EFF_WORDS[plus[1] ?? 'white'];
    specs.efficiencyCert = '80plus';
  } else if (cyb) {
    specs.efficiency = EFF_WORDS[cyb[1]!];
    specs.efficiencyCert = 'cybenetics';
  }

  if (/full[\s-]*modular|totalmente modular/.test(t)) specs.modular = 'full';
  else if (/semi[\s-]*modular/.test(t)) specs.modular = 'semi';
  else if (/nao[\s-]*modular|non[\s-]*modular/.test(t)) specs.modular = 'none';

  if (/atx\s*3\.?1/.test(t)) specs.atx = '3.1';
  else if (/atx\s*3(?:\.0)?\b/.test(t)) specs.atx = '3.0';

  if (/pcie?\s*5|pci-e\s*5|12vhpwr|12v[\s-]*2x6/.test(t)) specs.pcie5 = true;

  if (/\bsfx\b/.test(t)) specs.sfx = true;

  return specs;
}

/**
 * Decide se um anúncio é uma fonte ATX/SFX de PC (descarta fonte de notebook,
 * carregador, fonte de bancada, kits etc.).
 */
export function isDesktopPsu(title: string): boolean {
  const t = stripAccents(title).toLowerCase();
  if (!/^\s*fonte\b/.test(t)) return false;
  if (/notebook|carregador|adaptador|bancada|chaveada|nobreak|\bpoe\b|\bled\b|\bcftv\b|\bkit\b|combo|\b\d+\s*v\s*\d+(?:[.,]\d+)?\s*a\b|\bvdc\b|\bvac\b|colmeia|\bmonitor\b|\bdvr\b/.test(t))
    return false;
  return extractWatts(t) !== undefined;
}
