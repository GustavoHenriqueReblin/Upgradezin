import { OUT_OF_SCOPE_SOCKET } from './cpu.ts';
import { extractLookSpecs, isWhite, stripAccents } from './normalize.ts';
import { CHIPSETS, SOCKET_MEMORY, SOCKETS, type FormFactor, type LookSpecs, type MotherboardSpecs, type Socket } from './types.ts';

const CHIPSET_TO_SOCKET = new Map<string, Socket>(
  SOCKETS.flatMap((s) => CHIPSETS[s].map((c) => [c.toLowerCase(), s] as const)),
);
const KNOWN = new Set(CHIPSET_TO_SOCKET.keys());

const plain = (title: string) => stripAccents(title).toLowerCase();

/**
 * Placa-mãe avulsa de plataforma DDR4/DDR5. Só entra com o socket identificado entre
 * os de SOCKETS (pelo título ou pelo chipset): sem isso, não dá para checar compatibilidade.
 * Descarta kits com processador, combos, acessórios, DDR3 e servidor/workstation.
 */
export function isMotherboard(title: string): boolean {
  const t = plain(title);
  if (!/^\s*placa[\s-]*mae\b/.test(t)) return false;
  if (/\bddr3l?\b/.test(t)) return false;
  if (/\bkit\b|combo|\+\s*processador|processador\s*\+|\+\s*ryzen|\+\s*core|\+\s*memoria/.test(t)) return false;
  if (OUT_OF_SCOPE_SOCKET.test(t)) return false;
  return extractMotherboardSpecs(title).socket !== undefined;
}

export function extractChipset(title: string): string | undefined {
  const t = plain(title);
  // "B550M-A", "B650E", "X870E-E", "H310CM", "Chipset B550": captura o chipset e ignora o sufixo de formato (M/I, CM da ASRock).
  // "A620A"/"A620AM": variante da A620 (mesmo suporte), conta como A620.
  for (const m of t.matchAll(/\b([abhxz]\d{3})(e)?a?c?[mi]?(?=[^a-z0-9]|$)/g)) {
    const withE = `${m[1]}${m[2] ?? ''}`;
    if (KNOWN.has(withE)) return withE.toUpperCase();
    if (KNOWN.has(m[1]!)) return m[1]!.toUpperCase();
  }
  return undefined;
}

export function extractMotherboardSpecs(title: string): MotherboardSpecs & LookSpecs {
  const t = plain(title);
  const specs: MotherboardSpecs & LookSpecs = extractLookSpecs(title);

  const chipset = extractChipset(title);
  if (chipset) specs.chipset = chipset;

  // "AM4", "LGA 1700", "LGA-1200"; "LGA 1151 v2" conta como LGA1151.
  const sock = t.match(/\bam[45]\b|lga\s*-?\s*(?:1851|1700|1200|1151)\b/)?.[0].replace(/[\s-]/g, '').toUpperCase();
  specs.socket = (sock as Socket | undefined) ?? (chipset ? CHIPSET_TO_SOCKET.get(chipset.toLowerCase()) : undefined);

  let ff: FormFactor | undefined;
  if (/mini[\s-]*itx|\bitx\b/.test(t)) ff = 'mini-itx';
  else if (/micro[\s-]*atx|\bm[\s-]?atx\b|\bmaxt\b|\bu[\s-]?atx\b/.test(t)) ff = 'matx';
  else if (/\be[\s-]?atx\b/.test(t)) ff = 'eatx';
  else if (/\batx\b/.test(t)) ff = 'atx';
  else if (/\b[abhxz]\d{3}e?m\b|\b[abhxz]\d{3}e?m-/.test(t)) ff = 'matx'; // "B550M" = micro-ATX
  else if (/\b[abhxz]\d{3}e?i\b/.test(t)) ff = 'mini-itx';
  if (ff) specs.formFactor = ff;

  // "DDR5", "Ddr-4" e o sufixo de modelo "D4"/"D5" ("Prime B760M-A D4", "B760M-HDV/M.2 D4").
  if (/ddr-?5|\bd5\b/.test(t)) specs.memory = 'ddr5';
  else if (/ddr-?4|\bd4\b/.test(t)) specs.memory = 'ddr4';
  else if (specs.socket && SOCKET_MEMORY[specs.socket].length === 1) specs.memory = SOCKET_MEMORY[specs.socket][0]; // plataforma com um tipo só

  // "4xDDR4", "2x DDR5"; Mini-ITX tem sempre 2 slots.
  const slots = t.match(/\b([24])\s*x\s*ddr-?[45]\b/)?.[1];
  if (slots) specs.memorySlots = Number(slots);
  else if (ff === 'mini-itx') specs.memorySlots = 2;

  if (/wi[\s-]?fi|\bwifi\d*e?\b|\bax\b|\bac\b/.test(t)) specs.wifi = true;
  // Módulos Wi-Fi de placa-mãe são combo Wi-Fi + Bluetooth; o título raramente cita os dois.
  if (specs.wifi || /bluetooth|\bbt\s*\d/.test(t)) specs.bluetooth = true;

  return specs;
}

const NOISE = new Set([
  'placa', 'mae', 'chipset', 'socket', 'amd', 'intel', 'am4', 'am5', 'lga', 'lga1700', 'lga1851', '1700', '1851',
  'atx', 'matx', 'micro', 'mini', 'itx', 'eatx', 'm', 'uatx', 'maxt', 'ddr4', 'ddr5', 'preto', 'preta', 'branco', 'branca',
  'bluetooth', 'nvme', 'hdmi', 'dp', 'vga', 'gamer', 'gaming', 'white', 'snow', 'black',
]);

/**
 * Chave de modelo: marca + palavras do modelo (até a primeira vírgula), sem
 * termos de spec que as lojas escrevem de jeitos diferentes.
 *   "Placa Mãe MSI B550M-A PRO, Chipset B550, AMD AM4, mATX, DDR4"   -> "msi b550m a pro"
 *   "Placa Mae Msi B550m-a Pro Am4 2xDDR4 Chipset Amd B550 Matx"      -> "msi b550m a pro"
 * "Gaming" sai do ruído só quando não é o nome do modelo inteiro.
 */
export function motherboardModelKey(title: string, brand?: string): string {
  let head = plain(title).split(',')[0]!;
  head = head.replace(/wi[\s-]fi/g, 'wifi').replace(/\d+\s*x\s*ddr\d/g, ' ').replace(/[^a-z0-9 ]+/g, ' ');
  let tokens = head.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((tk) => !NOISE.has(tk));
  // Mantém "gaming" quando faz parte do nome (ex. "MSI B550 Gaming Plus").
  tokens = tokens.filter((tk) => !NOISE.has(tk) || ((tk === 'gaming' || tk === 'gamer') && kept.length <= 3));
  // Chipset repetido no fim ("B550m ... Chipset B550"): remove o avulso se o modelo já o contém.
  tokens = tokens.filter((tk, i) => tokens.indexOf(tk) === i && !tokens.some((o) => o !== tk && o.startsWith(tk) && KNOWN.has(tk)));
  const b = brand ? plain(brand).replace(/[^a-z0-9 ]+/g, '') : '';
  if (b && !tokens.includes(b)) tokens.unshift(b);
  // Versão branca é outro produto (como na fonte): sufixo fixo, qualquer que seja a grafia.
  if (isWhite(title)) tokens.push('white');
  return tokens.join(' ');
}
