import {
  CASE_ANY,
  CASE_TERMS,
  CHIPSETS,
  COOLER_TERMS,
  COOLER_TYPES,
  FORM_FACTORS,
  GPU_ANY_QUERY,
  GPU_MAKER_QUERY,
  GPU_MAKERS,
  MEMORY_TYPES,
  SSD_INTERFACES,
  SSD_TERMS,
  type CategoryId,
} from '@upgradezin/shared';
import { GPU_MAKER_LABEL } from './format.ts';
import type { Filters } from './filters.ts';

export interface SearchPlan {
  ready: boolean;
  /** Termos enviados às lojas, um por vez. */
  terms: string[];
  /** Texto do botão principal. */
  label: string;
}

/** Limite de termos por busca na API (cada termo é uma consulta em cada loja). */
export const MAX_TERMS = 8;

const notReady = (label: string): SearchPlan => ({ ready: false, terms: [], label });

/**
 * Transforma o que o usuário escolheu na tela "montar a busca" em termos
 * pequenos para as lojas (nunca a categoria inteira).
 */
function plan(category: CategoryId, f: Filters): SearchPlan {
  switch (category) {
    case 'psu': {
      const watts = [...f.watts].sort((a, b) => a - b);
      if (!watts.length) return notReady('Escolha ao Menos uma Potência');
      return { ready: true, terms: watts.map((w) => `${w}W`), label: `Buscar Fontes de ${watts.map((w) => `${w}W`).join(', ')}` };
    }
    case 'motherboard': {
      // Uma ou mais plataformas (AMD e Intel juntas): cada uma busca pelos chipsets escolhidos
      // dela, ou pela plataforma inteira se nenhum. Sem plataforma, busca pelo tipo de memória.
      if (f.sockets.length) {
        const terms = f.sockets.flatMap((s) => {
          const mine = CHIPSETS[s].filter((c) => f.chipsets.includes(c));
          return mine.length ? mine : [s];
        });
        return { ready: true, terms, label: `Buscar Placas-Mãe ${terms.join(', ')}` };
      }
      if (f.memory.length) {
        const terms = MEMORY_TYPES.filter((m) => f.memory.includes(m)).map((m) => m.toUpperCase());
        return { ready: true, terms, label: `Buscar Placas-Mãe ${terms.join(', ')}` };
      }
      return notReady('Escolha a Plataforma ou a Memória');
    }
    case 'cpu': {
      // Linhas viram termos ("Ryzen 5"); a plataforma filtra o resultado. Sem linha, busca pela plataforma.
      const socket = f.sockets[0];
      if (f.cpuLines.length) return { ready: true, terms: [...f.cpuLines], label: `Buscar ${f.cpuLines.join(', ')}${socket ? ` ${socket}` : ''}` };
      if (socket) return { ready: true, terms: [socket], label: `Buscar Processadores ${socket}` };
      return notReady('Escolha a Plataforma ou a Linha');
    }
    case 'gpu': {
      // A busca das lojas não entende série ("RTX 50"): busca pelo fabricante; série, memória e marca filtram.
      const makers = GPU_MAKERS.filter((m) => f.gpuMakers.includes(m));
      if (!makers.length) return notReady('Escolha o Fabricante do Chip');
      const series = f.gpuSeries.length ? ` (${f.gpuSeries.join(', ')})` : '';
      // Mais de um fabricante: uma busca só pela categoria (metade das requisições em cada loja;
      // o fabricante filtra o resultado). Um fabricante: busca direcionada a ele.
      const terms = makers.length > 1 ? [GPU_ANY_QUERY] : [GPU_MAKER_QUERY[makers[0]!]];
      return { ready: true, terms, label: `Buscar Placas ${makers.map((m) => GPU_MAKER_LABEL[m]).join(', ')}${series}` };
    }
    case 'ram': {
      const type = f.memory.length === 1 ? f.memory[0]!.toUpperCase() : undefined;
      if (!type) return notReady('Escolha o Tipo de Memória');
      const caps = [...f.ramCapacity].sort((a, b) => a - b);
      if (!caps.length) return notReady('Escolha ao Menos uma Capacidade');
      return { ready: true, terms: caps.map((c) => `${type} ${c}GB`), label: `Buscar Memória ${type} ${caps.map((c) => `${c} GB`).join(', ')}` };
    }
    case 'ssd': {
      const ifaces = SSD_INTERFACES.filter((i) => f.ssdInterfaces.includes(i));
      if (!ifaces.length) return notReady('Escolha a Interface');
      return { ready: true, terms: ifaces.map((i) => SSD_TERMS[i]), label: `Buscar ${ifaces.map((i) => SSD_TERMS[i]).join(', ')}` };
    }
    case 'cooler': {
      const types = COOLER_TYPES.filter((t) => f.coolerTypes.includes(t));
      if (!types.length) return notReady('Escolha o Tipo');
      return { ready: true, terms: types.map((t) => COOLER_TERMS[t]), label: `Buscar ${types.map((t) => COOLER_TERMS[t]).join(', ')}` };
    }
    case 'case': {
      // Sem formato: gabinetes em geral. Com formato: um termo por formato, e o resultado mostra onde a placa cabe.
      const ffs = FORM_FACTORS.filter((ff) => f.caseFormFactors.includes(ff));
      const terms = ffs.length ? ffs.map((ff) => CASE_TERMS[ff]) : [CASE_ANY];
      return { ready: true, terms, label: ffs.length ? `Buscar ${terms.join(', ')}` : 'Buscar Gabinetes' };
    }
    default:
      return notReady('Em Breve');
  }
}

export function planSearch(category: CategoryId, f: Filters): SearchPlan {
  const p = plan(category, f);
  if (p.terms.length > MAX_TERMS) return notReady(`Escolha até ${MAX_TERMS} Opções`);
  return p;
}
