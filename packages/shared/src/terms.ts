import { CHIPSETS, CPU_LINES, GPU_MAKER_QUERY, MEMORY_TYPES, RAM_CAPACITIES, SOCKETS, type CategoryId, type Specs } from './types.ts';

/** Potências de fonte mais comuns no varejo (as do formulário de fonte). */
export const PSU_POWERS = [450, 500, 550, 600, 650, 700, 750, 800, 850, 1000, 1200];

/** Termos de SSD, cooler e gabinete: a busca é pela interface/tipo/formato; capacidade, radiador etc. filtram o resultado. */
export const SSD_TERMS = { nvme: 'SSD NVMe', sata: 'SSD SATA' } as const;
export const COOLER_TERMS = { air: 'Air Cooler', water: 'Water Cooler' } as const;
export const CASE_TERMS = { 'mini-itx': 'Gabinete Mini ITX', matx: 'Gabinete Micro ATX', atx: 'Gabinete ATX', eatx: 'Gabinete E-ATX' } as const;
/** Gabinete sem formato escolhido. */
export const CASE_ANY = 'Gabinete';

/** Termo genérico de placa de vídeo (mais de um fabricante na mesma busca). */
export const GPU_ANY_QUERY = 'placa de video';

export interface SearchTerm {
  category: CategoryId;
  term: string;
}

/**
 * Todos os termos que a tela de busca pode gerar (apps/web/src/searchPlan.ts). Não vão às lojas:
 * a busca mostra os anúncios do banco (lidos das páginas de categoria) que batem com eles pelas
 * specs (termMatches). Mudou o formulário, muda aqui.
 */
export function allSearchTerms(): SearchTerm[] {
  const out: SearchTerm[] = [];
  const add = (category: CategoryId, terms: string[]) => out.push(...terms.map((term) => ({ category, term })));
  add('psu', PSU_POWERS.map((w) => `${w}W`));
  add('motherboard', [...SOCKETS, ...SOCKETS.flatMap((s) => CHIPSETS[s]), ...MEMORY_TYPES.map((m) => m.toUpperCase())]);
  add('cpu', [...CPU_LINES.amd, ...CPU_LINES.intel, ...SOCKETS]);
  add('gpu', [...Object.values(GPU_MAKER_QUERY), GPU_ANY_QUERY]);
  add('ram', MEMORY_TYPES.flatMap((t) => RAM_CAPACITIES.map((c) => `${t.toUpperCase()} ${c}GB`)));
  add('ssd', Object.values(SSD_TERMS));
  add('cooler', Object.values(COOLER_TERMS));
  add('case', [...Object.values(CASE_TERMS), CASE_ANY]);
  return out;
}

let formTerms: Map<string, Set<string>> | undefined;

/**
 * Texto livre aceito na busca nas lojas ("Não achou? Buscar nas lojas" do filtro de texto): de 3 a
 * 60 caracteres, só letras, números, espaço e - + . / (vai para a URL de busca da loja).
 */
export const isTextTerm = (term: string): boolean => /^[\p{L}\p{N}][\p{L}\p{N} +./-]{2,59}$/u.test(term.trim());

/** O termo é um dos que o formulário gera para a categoria (maiúsculas não importam). */
export function isFormTerm(category: CategoryId, term: string): boolean {
  if (!formTerms) {
    formTerms = new Map();
    for (const t of allSearchTerms()) {
      if (!formTerms.has(t.category)) formTerms.set(t.category, new Set());
      formTerms.get(t.category)!.add(t.term.toLowerCase());
    }
  }
  return !!formTerms.get(category)?.has(term.trim().toLowerCase());
}

/**
 * O anúncio é do que o termo procura, pelas specs lidas do título (não pelo texto): "AM4" =
 * encaixe AM4, "Ryzen 7" = linha Ryzen 7, "750W" = 750 W, "DDR4 16GB" = DDR4 de 16 GB… É assim
 * que a busca do site escolhe, no banco, os anúncios de cada termo. Termo fora do formulário: false.
 */
export function termMatches(category: CategoryId, term: string, specs: Specs): boolean {
  const t = term.trim().toLowerCase();
  const isSocket = (SOCKETS as readonly string[]).some((s) => s.toLowerCase() === t);
  switch (category) {
    case 'psu':
      return /^\d+w$/.test(t) && specs.watts === Number(t.slice(0, -1));
    case 'motherboard':
      if (isSocket) return specs.socket?.toLowerCase() === t;
      if ((MEMORY_TYPES as readonly string[]).includes(t)) return specs.memory === t;
      return specs.chipset?.toLowerCase() === t;
    case 'cpu':
      if (isSocket) return specs.socket?.toLowerCase() === t;
      return specs.cpuLine?.toLowerCase() === t;
    case 'gpu':
      if (t === GPU_ANY_QUERY) return !!specs.gpuModel;
      return Object.entries(GPU_MAKER_QUERY).some(([maker, q]) => q.toLowerCase() === t && specs.gpuMaker === maker);
    case 'ram': {
      const m = t.match(/^(ddr\d) (\d+)gb$/);
      return !!m && specs.memory === m[1] && specs.ramCapacity === Number(m[2]);
    }
    case 'ssd':
      return Object.entries(SSD_TERMS).some(([iface, q]) => q.toLowerCase() === t && specs.ssdInterface === iface);
    case 'cooler':
      return Object.entries(COOLER_TERMS).some(([type, q]) => q.toLowerCase() === t && specs.coolerType === type);
    case 'case':
      if (t === CASE_ANY.toLowerCase()) return true;
      return Object.entries(CASE_TERMS).some(([ff, q]) => q.toLowerCase() === t && specs.caseFormFactor === ff);
  }
  return false;
}
