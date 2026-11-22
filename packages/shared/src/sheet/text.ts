/**
 * Texto da ficha técnica: o HTML da página vira linhas de texto legível (o que fica guardado no
 * banco, para reler sem abrir a página de novo), e o texto vira pares "rótulo: valor" para o leitor.
 */

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", plusmn: '±', deg: '°', ordm: 'º', ordf: 'ª', micro: 'µ', sup2: '²',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ',
  agrave: 'à', ccedil: 'ç', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
  Atilde: 'Ã', Otilde: 'Õ', Agrave: 'À', Ccedil: 'Ç', times: 'x', trade: '', reg: '', copy: '', hellip: '...', ndash: '-', mdash: '-',
  bull: '•', middot: '·', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

/**
 * HTML da ficha -> texto, uma linha por parágrafo, item ou quebra. Também separa a ficha escrita
 * toda numa linha só ("Núcleos: 4- Nº de threads: 4- TDP: 65 W"): cada "- Rótulo" vira uma linha.
 */
export function sheetText(html: string): string {
  const text = html
    .replace(/<\s*(script|style)\b[\s\S]*?<\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*(br|\/p|\/li|\/div|\/tr|\/h\d|\/dt|\/dd|\/ul|\/table)\b[^>]*>/gi, '\n')
    .replace(/<\s*\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+\d?);/gi, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/[™®©​­]/g, '');
  return text
    .split(/\r?\n/)
    .flatMap((l) => l.replace(/(?<=[^\s\-–])\s?[-–]\s+(?=[A-Za-zÀ-ÿº#])/g, '\n- ').replace(/\s+•\s+/g, '\n• ').split('\n'))
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Sem acento, minúsculas, espaços simples. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/：/g, ':')
    .replace(/×/g, 'x')
    .replace(/；/g, ';')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SheetPair {
  /** Rótulo normalizado, sem marcador ("- ", "• "). */
  label: string;
  /** Valor normalizado; linhas seguintes sem rótulo entram separadas por " | ". */
  value: string;
  /** Título da seção em que o par está ("memoria", "slots de expansao"), normalizado. */
  section: string;
}

export interface SheetDoc {
  /** Linhas normalizadas, sem marcador. */
  lines: string[];
  pairs: SheetPair[];
  /** Todas as linhas juntas (com "\n"). */
  all: string;
}

const BULLET = /^[-•*·–>]+\s*/;
/** Linha que é só um título de seção sem dois-pontos ("Memória", "Armazenamento"): curta, sem número. */
const HEADING = /^[a-z][a-z /&()-]{1,28}$/;

export function sheetDoc(text: string): SheetDoc {
  const lines = text
    .split('\n')
    .map((l) => norm(l).replace(BULLET, ''))
    .filter(Boolean);
  const pairs: SheetPair[] = [];
  let section = '';
  let current: SheetPair | null = null;
  let extra = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const m = l.match(/^([^:]{1,60}?)\s*:\s*(.*)$/);
    if (m) {
      const [, label, value] = m as unknown as [string, string, string];
      // "Memória:" sozinho e a próxima linha também com rótulo: é título de seção.
      if (!value && /:/.test(lines[i + 1] ?? '')) {
        section = label;
        current = null;
        continue;
      }
      current = { label, value, section };
      pairs.push(current);
      extra = 0;
      // "Desempenho: Leitura Sequencial (Máx.): Até 2400 MB/s": o rótulo de dentro também vale.
      const inner = value.match(/^([^:]{2,50}?)\s*:\s*(.+)$/);
      if (inner && /[a-z]/.test(inner[1]!)) pairs.push({ label: inner[1]!, value: inner[2]!, section: label });
      continue;
    }
    // Título sem dois-pontos e o valor na linha seguinte ("Chipset" / "AMD B850"), como em algumas fichas.
    // (Não quando o rótulo anterior ainda espera o valor: "Fator de forma:" / "M-ATX".)
    if (HEADING.test(l) && lines[i + 1] && !/:/.test(lines[i + 1]!) && !(current && !current.value)) {
      current = { label: l, value: '', section };
      pairs.push(current);
      extra = 0;
      section = l;
      continue;
    }
    // Continuação do valor anterior ("Velocidade: 2x1R DDR5-5600" / "2x2R DDR5-5600").
    if (current && extra < 12 && l.length <= 200) {
      current.value = current.value ? `${current.value} | ${l}` : l;
      extra++;
    } else current = null;
  }
  return { lines, pairs, all: lines.join('\n') };
}

/** Valores dos pares cujo rótulo bate (na ordem da ficha); `section` também precisa bater com a seção ou o rótulo. */
export function valuesOf(doc: SheetDoc, label: RegExp, section?: RegExp): string[] {
  return doc.pairs.filter((p) => label.test(p.label) && (!section || section.test(p.section) || section.test(p.label))).map((p) => p.value);
}

/**
 * Primeiro valor lido: tenta cada rótulo, na ordem (o primeiro é o preferido), e devolve o primeiro
 * valor que `parse` aceita.
 */
export function pick<T>(doc: SheetDoc, labels: RegExp[], parse: (value: string, label: string) => T | undefined, section?: RegExp): T | undefined {
  for (const re of labels) {
    for (const p of doc.pairs) {
      if (!re.test(p.label) || (section && !section.test(p.section) && !section.test(p.label))) continue;
      const v = parse(p.value, p.label);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** Número com vírgula ou ponto decimal ("3,4" e "3.4" -> 3.4). */
export const dec = (s: string) => Number(s.replace(',', '.'));

/** Inteiro com separador de milhar ("14.900" e "7,000" -> 14900 e 7000; "3200" -> 3200). */
export const thousands = (s: string) => Number(s.replace(/[.,](?=\d{3}\b)/g, ''));

/** Primeiro número seguido da unidade ("até 4.6ghz" com /ghz/ -> 4.6). */
export function numberWith(value: string, unit: RegExp, opts: { thousands?: boolean } = {}): number | undefined {
  const re = new RegExp(String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:${unit.source})`);
  const m = value.match(re);
  if (!m) return undefined;
  return opts.thousands ? thousands(m[1]!) : dec(m[1]!);
}

/** Primeiro inteiro do valor ("8 (4p + 4e)" -> 8). */
export function firstInt(value: string): number | undefined {
  const m = value.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

/** Sem informação ("não possui", "não", "sem"). */
export const isNo = (v: string) => /^(nao|no|sem|n\/a|nenhum|nenhuma|-)\b/.test(v.trim());
export const isYes = (v: string) => /^(sim|yes|possui|incluso|inclusa)\b/.test(v.trim());
