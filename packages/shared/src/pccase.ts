import { isWhite, stripAccents } from './normalize.ts';
import { FORM_FACTORS, type CaseSpecs, type FormFactor } from './types.ts';

const plain = (title: string) => stripAccents(title).toLowerCase();

/** Gabinete (sem PC montado, kit com peças, suporte ou acessório). */
export function isCase(title: string): boolean {
  const t = plain(title);
  if (!/^\s*gabinete\b/.test(t)) return false;
  return !/\+\s*(?:processador|placa|memoria|fonte)|computador|\bpc\s+(?:completo|montado)|suporte|rodinha|\bpes?\b\s+para|filtro\s+de\s+poeira/.test(t);
}

const rank = (f: FormFactor) => FORM_FACTORS.indexOf(f);

export function extractCaseSpecs(title: string): CaseSpecs {
  const t = plain(title);
  const specs: CaseSpecs = {};
  // Formatos citados; vale o maior (gabinete ATX também recebe Micro-ATX e Mini-ITX).
  const found: FormFactor[] = [];
  if (/\be-?atx\b/.test(t)) found.push('eatx');
  if (/(?<![\w-])atx\b/.test(t.replace(/\be-?atx\b/g, ' ').replace(/\b(?:m|micro)[\s-]?atx\b/g, ' '))) found.push('atx');
  if (/\b(?:m|micro)[\s-]?atx\b|\bmatx\b/.test(t)) found.push('matx');
  if (/\bmini[\s-]?itx\b|\bitx\b/.test(t)) found.push('mini-itx');
  const tower = /full[\s-]?tower/.test(t) ? 'full' : /mid[\s-]?tower|middle\s*tower/.test(t) ? 'mid' : /mini[\s-]?tower/.test(t) ? 'mini' : undefined;
  if (tower) specs.caseTower = tower;
  if (found.length) specs.caseFormFactor = found.sort((a, b) => rank(b) - rank(a))[0];
  // Sem formato no título: pela torre (full = E-ATX, mid = ATX, mini = Micro-ATX).
  else if (tower) specs.caseFormFactor = tower === 'full' ? 'eatx' : tower === 'mid' ? 'atx' : 'matx';

  if (/vidro|glass/.test(t)) specs.caseGlass = true;
  if (/sem\s*(?:fans?|ventoinhas?|cooler)|sem\s*fonte\s*\/\s*fans/.test(t)) specs.caseFans = 0;
  else {
    // Também "3 Coolers RGB", "Com 3 Coolers", "4 Cooler" (as lojas chamam ventoinha de cooler); não o que o
    // gabinete suporta ("suporta 6 coolers", "até 9 fans"), nem o cooler do processador.
    const included = (re: RegExp) => {
      for (const m of t.matchAll(re)) if (!/(suport\w*|ate|max\w*|compativel com)\s*(?:para\s*)?$/.test(t.slice(Math.max(0, m.index! - 20), m.index!).trim())) return m[1];
      return undefined;
    };
    const n =
      included(/(\d{1,2})\s*x?\s*(?:fans?|ventoinhas?|cooler\s*fans?)\b/g) ??
      included(/com\s*(\d{1,2})\s*x?\s*(?:fans?|coolers?|ventoinhas?)\b/g) ??
      included(/\b(\d)x\s*(?:fans?|cooler)/g) ??
      included(/\b(\d{1,2})\s*coolers?\b(?!\s*(?:de|do|para)\s*(?:processador|cpu))/g);
    if (n && Number(n) <= 12) specs.caseFans = Number(n);
  }
  return specs;
}

/** A placa-mãe cabe no gabinete? (gabinete sem formato conhecido: undefined) */
export const caseFits = (caseFf: FormFactor | undefined, board: FormFactor) => (caseFf ? rank(caseFf) >= rank(board) : undefined);

const NOISE = new Set([
  'gabinete', 'gamer', 'office', 'mid', 'mini', 'full', 'tower', 'atx', 'matx', 'micro', 'itx', 'e', 'm', 'de', 'com', 'sem', 'em', 'lateral',
  'frontal', 'vidro', 'temperado', 'fans', 'fan', 'preto', 'black', 'branco', 'white', 'argb', 'rgb', 'usb', 'aquario',
]);

/** Chave de modelo: marca + linha + cor (o mesmo gabinete com outra cor é outro produto). */
export function caseModelKey(title: string, brand?: string): string {
  const head = plain(title).split(/,| - /)[0]!;
  const b = brand ? plain(brand).replace(/[^a-z0-9 ]+/g, '') : '';
  const words = [...new Set(head.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/))].filter((w) => w && !NOISE.has(w) && !b.split(' ').includes(w)).sort();
  const fans = extractCaseSpecs(title).caseFans;
  return [b, ...words, fans !== undefined ? `${fans}fans` : '', isWhite(title) ? 'white' : ''].filter(Boolean).join(' ');
}
