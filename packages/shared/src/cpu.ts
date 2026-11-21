import { stripAccents } from './normalize.ts';
import { SOCKETS, type CpuBrand, type CpuSpecs, type Socket } from './types.ts';

const plain = (title: string) => stripAccents(title).toLowerCase();

/** Sockets antigos (DDR3 e antes) ou de servidor/HEDT: fora do escopo. */
export const OUT_OF_SCOPE_SOCKET = /lga\s*-?\s*(?:775|1150|1155|1156|1366|2011|2066|3647|4677)\b|\bam3\+?\b|\bfm2\+?\b|\bstr[x45]\b|\bsp[356]\b/;

interface ParsedModel {
  brand: CpuBrand;
  line: string;
  /** Modelo com sufixo em maiúsculas: "5600X", "12400F", "265K". */
  model: string;
  gen?: string;
  socket?: Socket;
  /** Intel 2ª a 5ª geração: DDR3, fora do escopo. */
  legacy?: boolean;
}

const up = (s: string) => s.toUpperCase();

/** Socket da Intel Core pela geração (6ª–9ª LGA1151, 10ª–11ª LGA1200, 12ª–14ª LGA1700). */
function intelSocket(gen: number): Socket | undefined {
  if (gen >= 12 && gen <= 14) return 'LGA1700';
  if (gen >= 10) return gen <= 11 ? 'LGA1200' : undefined;
  if (gen >= 6) return 'LGA1151';
  return undefined;
}

/** Linha, modelo, geração e socket a partir do nome do processador. */
export function parseCpuModel(title: string): ParsedModel | undefined {
  const t = plain(title);
  let m: RegExpMatchArray | null;

  // Intel Core Ultra 200 (LGA1851): "Core Ultra 7 265K"
  if ((m = t.match(/core\s*ultra\s*([579])\s*(\d{3})([a-z]*)/)))
    return { brand: 'intel', line: `Core Ultra ${m[1]}`, model: up(m[2]! + m[3]!), gen: `Core Ultra Série ${m[2]![0]}`, socket: 'LGA1851' };

  // Intel Core i3/i5/i7/i9: "Core i5-12400F", "Core i5 12400F", "i7 3770"
  if ((m = t.match(/(?:core\s*)?\bi([3579])[\s-]*(\d{4,5})([a-z]*)/))) {
    const digits = m[2]!;
    const gen = digits.length === 5 ? Number(digits.slice(0, 2)) : Number(digits[0]);
    return {
      brand: 'intel',
      line: `Core i${m[1]}`,
      model: up(digits + m[3]!),
      gen: `${gen}ª Geração`,
      socket: intelSocket(gen),
      legacy: gen <= 5,
    };
  }

  // Intel Core 3/5/7 série 1 (LGA1700): "Core 5 120F"
  if ((m = t.match(/\bcore\s*([357])\s*(\d{3})([a-z]*)\b/)))
    return { brand: 'intel', line: `Core ${m[1]}`, model: up(m[2]! + m[3]!), gen: 'Core Série 1', socket: 'LGA1700' };

  // Pentium / Celeron de desktop (série G): "Pentium Gold G6405", "Celeron G5905".
  // G1/G2/G3 = LGA1155/1150 (DDR3); G4/G5 = LGA1151; G59xx e G6 = LGA1200; G7 = LGA1700.
  if ((m = t.match(/\b(pentium|celeron)\s*(?:gold\s*|dual[\s-]*core\s*)?([a-z]?\d{3,5}[a-z]*)/))) {
    const line = m[1] === 'pentium' ? 'Pentium' : 'Celeron';
    const model = up(m[2]!);
    const g = model.match(/^G(\d)(\d)/);
    if (!g) return { brand: 'intel', line, model, legacy: true }; // sem série G (J/N de notebook, antigos): fora
    const [family, next] = [Number(g[1]), Number(g[2])];
    const socket: Socket | undefined =
      family === 7 ? 'LGA1700' : family === 6 || (family === 5 && next === 9) ? 'LGA1200' : family >= 4 ? 'LGA1151' : undefined;
    return { brand: 'intel', line, model, socket, legacy: family <= 3 };
  }

  // AMD Ryzen: "Ryzen 5 5600X", "Ryzen 7 5800X3D", "Ryzen 5 PRO 4650G"
  if ((m = t.match(/ryzen\s*([3579])\s*(?:pro\s*)?(\d{4})([a-z0-9]*)/))) {
    const series = Number(m[2]![0]);
    return {
      brand: 'amd',
      line: `Ryzen ${m[1]}`,
      model: up(m[2]! + m[3]!),
      gen: `Ryzen ${series}000`,
      // 1000–5000 em AM4; 7000, 8000 e 9000 em AM5 (6000 é de notebook).
      socket: series <= 5 ? 'AM4' : series >= 7 ? 'AM5' : undefined,
    };
  }

  // AMD Athlon (AM4): "Athlon 3000G"
  if ((m = t.match(/\bathlon\s*(?:silver\s*|gold\s*)?(\d{3,4}[a-z]*)/)))
    return { brand: 'amd', line: 'Athlon', model: up(m[1]!), socket: 'AM4' };

  return undefined;
}

/**
 * Processador de desktop avulso de plataforma DDR4/DDR5. Só entra com a plataforma
 * identificada (pelo título ou pelo modelo) entre as de SOCKETS: sem isso, não dá para
 * garantir que aceita DDR4 ou DDR5. Descarta kits, combos, servidor e plataformas antigas.
 */
export function isCpu(title: string): boolean {
  const t = plain(title);
  if (!/^\s*processador\b/.test(t)) return false;
  if (/\bkit\b|combo|\+\s*placa|\+\s*memoria|notebook|xeon|epyc|threadripper|\bopteron\b/.test(t)) return false;
  if (OUT_OF_SCOPE_SOCKET.test(t)) return false;
  const p = parseCpuModel(title);
  if (!p || p.legacy) return false;
  return extractCpuSpecs(title).socket !== undefined;
}

export function extractCpuSpecs(title: string): CpuSpecs & { socket?: Socket } {
  const t = plain(title);
  const specs: CpuSpecs & { socket?: Socket } = {};
  const p = parseCpuModel(title);
  if (p) {
    specs.cpuBrand = p.brand;
    specs.cpuLine = p.line;
    specs.cpuModel = p.model;
    if (p.gen) specs.cpuGen = p.gen;
  }

  // Socket escrito no título vale mais que o deduzido do modelo.
  const sock = t.match(/\bam[45]\b|lga\s*-?\s*(?:1851|1700|1200|1151)\b/)?.[0].replace(/[\s-]/g, '').toUpperCase();
  const socket = (sock && (SOCKETS as readonly string[]).includes(sock) ? (sock as Socket) : undefined) ?? p?.socket;
  if (socket) specs.socket = socket;

  // "8 Núcleos", "8-Core", "8-Cores", "Octa Core". O número começa na fronteira da palavra
  // ("Sk1151 Core i7" não é 51 núcleos) e "Core i7"/"Core Ultra" não contam.
  const WORD_CORES: Record<string, number> = { dual: 2, quad: 4, hexa: 6, octa: 8 };
  const cores =
    t.match(/\b(\d{1,3})[\s-]*(?:nucleos|cores?)\b(?!\s*(?:i\d|ultra))/)?.[1] ??
    WORD_CORES[t.match(/\b(dual|quad|hexa|octa)[\s-]*core\b/)?.[1] ?? ''];
  if (cores) specs.cores = Number(cores);
  const threads = t.match(/\b(\d{1,3})[\s-]*threads?\b/)?.[1];
  if (threads) specs.threads = Number(threads);

  // Vídeo integrado: o título manda; senão, pelo sufixo do modelo.
  if (/sem\s*(?:video|graficos?)\s*integrad/.test(t)) specs.igpu = false;
  else if (/com\s*(?:video|graficos?)\s*integrad|radeon\s*graphics|uhd\s*graphics/.test(t)) specs.igpu = true;
  else if (p) {
    const suffix = p.model.replace(/^\d+/, '');
    if (p.brand === 'intel') specs.igpu = !suffix.includes('F');
    else if (p.line !== 'Athlon') specs.igpu = socket === 'AM5' ? !suffix.endsWith('F') : suffix.includes('G');
    else specs.igpu = true;
  }

  // Cooler: só quando o anúncio diz. Part number AMD "WOF" = sem fan (sem cooler).
  if (/sem\s*cooler|\bwof\b|\d+wof\b/.test(t)) specs.cooler = false;
  else if (/com\s*cooler|cooler\s*wraith|\bwraith\b|cooler\s*(?:box|original|incluso)/.test(t)) specs.cooler = true;

  if (p) specs.unlocked = p.brand === 'amd' ? p.line !== 'Athlon' : /K/.test(p.model.replace(/^\d+/, ''));

  return specs;
}

/**
 * Chave de modelo: fabricante + linha + modelo ("amd ryzen 7 5700x").
 * Versão tray/OEM (sem caixa) fica separada da box.
 */
export function cpuModelKey(title: string): string {
  const p = parseCpuModel(title);
  if (!p) return plain(title).split(',')[0]!.trim();
  const tray = /\btray\b|\boem\b|\bmpk\b/.test(plain(title)) ? ' tray' : '';
  return `${p.brand} ${p.line} ${p.model}`.toLowerCase() + tray;
}
