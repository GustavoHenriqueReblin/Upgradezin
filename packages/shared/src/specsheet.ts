import type { CategoryId, Specs } from './types.ts';

/**
 * Ficha técnica da página do produto (texto livre, em HTML, escrito por quem cadastrou o
 * produto). Só o que o título não traz e a montagem precisa: medidas físicas e o part
 * number do fabricante ("Modelo"). Cada fabricante escreve de um jeito; o que não bate com
 * as regras fica de fora (a checagem fica "não deu para confirmar", nunca chuta).
 */
export interface SpecSheet {
  specs: Pick<Specs, 'gpuLength' | 'gpu16Pin' | 'coolerHeight' | 'caseMaxGpu' | 'caseMaxCooler' | 'caseRadiators'>;
  /** Part number do fabricante ("- Modelo: RR-S4NA-17PA-R1"). */
  mpn?: string;
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', plusmn: '±', deg: '°',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  atilde: 'ã', otilde: 'õ', agrave: 'à', ccedil: 'ç', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó',
  Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç', times: 'x',
};

/** HTML da ficha -> linhas de texto (um <p>/<li>/<br> por linha), sem acento nem maiúsculas. */
export function sheetLines(html: string): string[] {
  const text = html
    .replace(/<\s*(br|\/p|\/li|\/div|\/tr|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, e: string) => ENTITIES[e] ?? m);
  return text
    .split(/\r?\n/)
    .map((l) => l.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const num = (s: string) => Number(s.replace(',', '.'));

/** Números com unidade de uma linha, em mm ("26,9 cm" -> 269). */
function lengthsMm(line: string): number[] {
  const unit = /\bcm\b/.test(line) && !/\bmm\b/.test(line) ? 10 : 1;
  return [...line.matchAll(/(\d{2,3}(?:[.,]\d+)?)/g)].map((m) => Math.round(num(m[1]!) * unit));
}

const RADIATORS = [120, 140, 240, 280, 360, 420];

export function parseSpecSheet(category: CategoryId, html: string): SpecSheet {
  const lines = sheetLines(html);
  const specs: SpecSheet['specs'] = {};
  const out: SpecSheet = { specs };

  // "- Modelo: 90-GA41ZZ-00UANF": part number do fabricante (com letra e dígito, 4+ caracteres).
  for (const l of lines) {
    const m = l.match(/^-?\s*modelo\s*:?\s*([a-z0-9][a-z0-9._/-]{3,})$/);
    if (m && /\d/.test(m[1]!) && /[a-z]/.test(m[1]!)) {
      out.mpn = m[1]!.toUpperCase();
      break;
    }
  }

  const noise = /embalagem|caixa|pacote|ventilador|ventoinha|\bfan\b|radiador/;

  if (category === 'gpu') {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (noise.test(l)) continue;
      // "Dimensões: 269 x 131 x 40 mm", "Comprimento: 304 mm" ou, na Gigabyte, "Tamanho do cartão: C=215 L=122 A=40 mm".
      if (/dimens|comprimento|tamanho d[oa] (cartao|placa)|card size/.test(l)) {
        // "Dimensões:" sozinho na linha e as medidas na seguinte ("- 269,2 x 131,8 x 40,3 mm").
        const values = /\d/.test(l) ? l : `${l} ${lines[i + 1] ?? ''}`;
        const mm = lengthsMm(values).filter((n) => n >= 100 && n <= 450);
        if (mm.length) {
          specs.gpuLength = Math.max(...mm);
          break;
        }
      }
    }
    // Conector de força: 16 pinos (12V-2x6) ou, se a ficha lista o conector e ele é de 6/8 pinos, sem 12V-2x6.
    if (lines.some((l) => /12v-?2x6|12vhpwr|16\s*-?\s*pin/.test(l))) specs.gpu16Pin = true;
    else if (lines.some((l, i) => /conector/.test(l) && /\b[68]\s*-?\s*pin/.test(`${l} ${lines[i + 1] ?? ''}`))) specs.gpu16Pin = false;
  }

  if (category === 'cooler') {
    for (const l of lines) {
      if (noise.test(l)) continue;
      // "Altura: 154 mm" ou "Dimensões (C x L x A): 120 x 79 x 154 mm" (do dissipador, não do fan).
      const explicit = l.match(/\baltura\b[^:]{0,20}:\s*(\d{2,3}(?:[.,]\d+)?)\s*mm/);
      const dims = /dimens/.test(l) && /\(\s*[clp]\s*x\s*[lp]\s*x\s*a\s*\)/.test(l) ? lengthsMm(l.replace(/\([^)]*\)/, '')) : [];
      // "Dimensões: 104 (C) x 126 (L) x 159 (A) mm": cada medida marcada pela letra.
      const marked = /dimens/.test(l) ? l.match(/(\d{2,3}(?:[.,]\d+)?)\s*(?:mm\s*)?\(\s*a\s*\)/) : null;
      const h = explicit ? num(explicit[1]!) : dims.length >= 3 ? dims[2] : marked ? num(marked[1]!) : undefined;
      if (h && h >= 30 && h <= 200) {
        specs.coolerHeight = Math.round(h);
        break;
      }
    }
  }

  if (category === 'case') {
    let inRadiators = false;
    const radiators = new Set<number>();
    for (const l of lines) {
      const gpu = l.match(/(?:gpu|vga|placa\s+de\s+video)[^0-9]{0,40}?(\d{3})\s*mm/);
      if (gpu && /max|ate\b|comprimento/.test(l) && !specs.caseMaxGpu) specs.caseMaxGpu = Number(gpu[1]);
      const cooler = l.match(/(?:cooler|cpu|processador)[^0-9]{0,40}?(\d{2,3})\s*mm/);
      if (cooler && /altura|max|ate\b/.test(l) && !/radiador|liquid|water/.test(l) && !specs.caseMaxCooler) {
        const h = Number(cooler[1]);
        if (h >= 50 && h <= 200) specs.caseMaxCooler = h;
      }
      // Radiadores: na linha do título da seção e nas linhas logo abaixo, de posição ("- Topo: 360 mm, 280 mm")
      // ou só com a medida ("- 240 mm", "- 2 x 140 mm" = radiador de 280).
      const item = /^-?\s*(?:\d\s*x\s*)?\d{3}\s*mm$/.test(l);
      if (/refrigeracao\s+liquida|radiador|water\s*cooler/.test(l)) inRadiators = true;
      else if (inRadiators && !item && !/^-?\s*(topo|superior|frontal|frente|traseira|traseiro|lateral|inferior|fundo)\b/.test(l)) inRadiators = false;
      if (inRadiators) {
        const times = item ? l.match(/(\d)\s*x\s*(\d{3})\s*mm/) : null;
        if (times) {
          const n = Number(times[1]) * Number(times[2]);
          if (RADIATORS.includes(n)) radiators.add(n);
        } else {
          // "360 mm" e listas com barra ("radiador de 120/140/240/280/360 mm").
          for (const m of l.matchAll(/\b(\d{3}(?:\s*\/\s*\d{3})*)\s*mm/g)) for (const n of m[1]!.split('/').map(Number)) if (RADIATORS.includes(n)) radiators.add(n);
        }
      }
    }
    if (radiators.size) specs.caseRadiators = [...radiators].sort((a, b) => a - b);
  }

  return out;
}
