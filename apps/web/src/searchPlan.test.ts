import { describe, expect, it } from 'vitest';
import {
  allSearchTerms,
  CHIPSETS,
  COOLER_TYPES,
  CPU_LINES,
  FORM_FACTORS,
  GPU_MAKERS,
  MEMORY_TYPES,
  PSU_POWERS,
  RAM_CAPACITIES,
  SOCKETS,
  SSD_INTERFACES,
  type CategoryId,
  type Offer,
} from '@upgradezin/shared';
import { applyFilters, commonWords, DEFAULT_FILTERS, matchesText, resetResultFilters, type Filters } from './filters.ts';
import { MAX_TERMS, planSearch } from './searchPlan.ts';

const f = (patch: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...patch });

describe('planSearch', () => {
  it('fonte: potências viram termos', () => {
    expect(planSearch('psu', f({ watts: [850, 750] }))).toMatchObject({ ready: true, terms: ['750W', '850W'] });
    expect(planSearch('psu', f({})).ready).toBe(false);
  });

  it('processador: linhas viram termos; sem linha, a plataforma', () => {
    expect(planSearch('cpu', f({ cpuLines: ['Ryzen 5', 'Ryzen 7'], sockets: ['AM4'] }))).toMatchObject({ ready: true, terms: ['Ryzen 5', 'Ryzen 7'] });
    expect(planSearch('cpu', f({ sockets: ['LGA1700'] }))).toMatchObject({ ready: true, terms: ['LGA1700'] });
    expect(planSearch('cpu', f({}))).toMatchObject({ ready: false, label: 'Escolha a Plataforma ou a Linha' });
  });

  it('placa de vídeo: busca pelo fabricante do chip (a loja não entende série); série filtra', () => {
    expect(planSearch('gpu', f({ gpuMakers: ['nvidia'] }))).toMatchObject({ ready: true, terms: ['NVIDIA GeForce'] });
    // Mais de um fabricante: uma busca só (menos requisições por loja); o fabricante filtra.
    expect(planSearch('gpu', f({ gpuMakers: ['amd', 'nvidia'], gpuSeries: ['RTX 50'] }))).toMatchObject({
      ready: true,
      terms: ['placa de video'],
      label: 'Buscar Placas NVIDIA, AMD (RTX 50)',
    });
    expect(planSearch('gpu', f({ gpuSeries: ['RTX 50'] }))).toMatchObject({ ready: false, label: 'Escolha o Fabricante do Chip' });
  });

  it('memória: tipo obrigatório e capacidades viram termos', () => {
    expect(planSearch('ram', f({ memory: ['ddr4'], ramCapacity: [32, 16] }))).toMatchObject({ ready: true, terms: ['DDR4 16GB', 'DDR4 32GB'] });
    expect(planSearch('ram', f({ ramCapacity: [16] }))).toMatchObject({ ready: false, label: 'Escolha o Tipo de Memória' });
    expect(planSearch('ram', f({ memory: ['ddr5'] }))).toMatchObject({ ready: false, label: 'Escolha ao Menos uma Capacidade' });
  });

  it(`não passa de ${MAX_TERMS} termos (limite da API)`, () => {
    const watts = [450, 500, 550, 600, 650, 700, 750, 800, 850];
    expect(planSearch('psu', f({ watts }))).toMatchObject({ ready: false, label: `Escolha até ${MAX_TERMS} Opções` });
  });
});

describe('filtros', () => {
  const offer = (specs: Offer['specs'], extra: Partial<Offer> = {}): Offer => ({
    store: 's1', storeSku: String(Math.random()), title: 't', url: '', priceCash: 100, inStock: true, seller: 's',
    marketplace: false, openbox: false, specs, modelKey: 'k', collectedAt: '', ...extra,
  });

  it('processador: vídeo integrado e cooler só passam quando confirmados', () => {
    const offers = [offer({ igpu: true, cooler: true }), offer({ igpu: false }), offer({ cooler: undefined })];
    expect(applyFilters(offers, f({ igpu: true }))).toHaveLength(1);
    expect(applyFilters(offers, f({ cooler: true }))).toHaveLength(1);
  });

  it('memória: capacidade e pentes', () => {
    const offers = [offer({ ramCapacity: 16, ramModules: 2 }), offer({ ramCapacity: 16, ramModules: 1 }), offer({ ramCapacity: 32, ramModules: 2 })];
    expect(applyFilters(offers, f({ ramCapacity: [16], ramModules: [2] }))).toHaveLength(1);
  });

  it('"Limpar" mantém o que definiu a busca da categoria', () => {
    const cur = f({ gpuMakers: ['nvidia'], gpuSeries: ['RTX 50'], vram: [8], rgb: true, sort: 'vram' });
    expect(resetResultFilters(cur, 'gpu')).toMatchObject({ gpuMakers: ['nvidia'], gpuSeries: [], vram: [], rgb: false, sort: 'vram' });
    expect(resetResultFilters(f({ memory: ['ddr4'], ramCapacity: [16], ramSpeed: [3200] }), 'ram')).toMatchObject({ memory: ['ddr4'], ramCapacity: [16], ramSpeed: [] });
    // Na placa-mãe, memória é refinamento, não busca.
    expect(resetResultFilters(f({ sockets: ['AM4'], memory: ['ddr4'] }), 'motherboard')).toMatchObject({ sockets: ['AM4'], memory: [] });
    // ...a não ser que a busca tenha sido só pela memória.
    expect(resetResultFilters(f({ memory: ['ddr5'] }), 'motherboard')).toMatchObject({ sockets: [], memory: ['ddr5'] });
  });

  it('placa-mãe: várias plataformas (AMD e Intel juntas) ou só a memória', () => {
    expect(planSearch('motherboard', f({}))).toMatchObject({ ready: false });
    expect(planSearch('motherboard', f({ sockets: ['AM5', 'LGA1700'] }))).toMatchObject({ ready: true, terms: ['AM5', 'LGA1700'] });
    // Chipsets escolhidos só de uma plataforma: a outra busca inteira.
    expect(planSearch('motherboard', f({ sockets: ['AM5', 'LGA1700'], chipsets: ['B650', 'B850'] }))).toMatchObject({ terms: ['B650', 'B850', 'LGA1700'] });
    expect(planSearch('motherboard', f({ memory: ['ddr5'] }))).toMatchObject({ ready: true, terms: ['DDR5'], label: 'Buscar Placas-Mãe DDR5' });
    expect(planSearch('motherboard', f({ memory: ['ddr5', 'ddr4'] }))).toMatchObject({ terms: ['DDR4', 'DDR5'] });
  });
});

describe('busca local nos resultados', () => {
  const o = (title: string, brand?: string): Offer => ({
    store: 's1', storeSku: title, title, brand, url: '', priceCash: 100, inStock: true, seller: 's',
    marketplace: false, openbox: false, specs: {}, modelKey: title, collectedAt: '',
  });

  it('todas as palavras precisam aparecer, sem diferenciar acento e maiúscula', () => {
    const offer = o('Placa de Vídeo Gigabyte RTX 5060 WINDFORCE OC 8GB', 'Gigabyte');
    expect(matchesText(offer, 'windforce oc')).toBe(true);
    expect(matchesText(offer, 'Vídeo, gigabyte')).toBe(true);
    expect(matchesText(offer, 'windforce eagle')).toBe(false);
    expect(matchesText(offer, '')).toBe(true);
  });

  it('entra como filtro e "Limpar" apaga', () => {
    const offers = [o('Memória Kingston Fury Beast, 16GB'), o('Memória Corsair Vengeance LPX, 16GB')];
    expect(applyFilters(offers, f({ text: 'fury' }))).toHaveLength(1);
    expect(resetResultFilters(f({ text: 'fury', memory: ['ddr4'] }), 'ram').text).toBe('');
  });

  it('sugere nomes de linha comuns, sem specs, números, marcas nem palavras presentes em quase todos', () => {
    const offers = [
      o('Placa de Vídeo Gigabyte RTX 5060 Windforce OC 8GB, GDDR7, Ray Tracing', 'Gigabyte'),
      o('Placa de Vídeo Gigabyte RTX 5070 Windforce OC 12GB, GDDR7, Ray Tracing', 'Gigabyte'),
      o('Placa de Vídeo MSI RTX 5060 Ventus 2X OC 8GB, GDDR7, DLSS', 'MSI'),
      o('Placa de Vídeo MSI RTX 5070 Ventus 2X OC 12GB, GDDR7, DLSS', 'MSI'),
      o('Placa de Vídeo Asus Dual RTX 5060 8GB, GDDR7', 'ASUS'),
      o('Placa de Vídeo Asus Dual RX 9060 XT OC 16GB, GDDR6', 'ASUS'),
    ];
    const words = commonWords(offers, 12, ['gigabyte', 'msi', 'asus']);
    expect(words).toEqual(expect.arrayContaining(['windforce', 'ventus', 'dual']));
    // "OC" está em 5 de 6: presente em quase todos, não filtra nada.
    expect(words).not.toContain('oc');
    for (const noise of ['ray', 'tracing', 'gddr7', 'rtx', '8gb', 'gigabyte', 'placa', 'video', 'xt']) expect(words).not.toContain(noise);
  });
});

describe('termos da busca × rotina de coleta', () => {
  // A rotina mantém no banco os termos de allSearchTerms(); a busca do site precisa gerar só termos dessa lista.
  const universe = new Set(allSearchTerms().map((t) => `${t.category}|${t.term.toLowerCase()}`));
  const covered = (category: CategoryId, terms: string[]) => terms.every((t) => universe.has(`${category}|${t.toLowerCase()}`));

  it('toda opção do formulário gera termos que a rotina coleta', () => {
    for (const w of PSU_POWERS) expect(covered('psu', planSearch('psu', f({ watts: [w] })).terms)).toBe(true);
    for (const socket of SOCKETS) {
      expect(covered('motherboard', planSearch('motherboard', f({ sockets: [socket] })).terms)).toBe(true);
      expect(covered('motherboard', planSearch('motherboard', f({ sockets: [socket], chipsets: CHIPSETS[socket] })).terms)).toBe(true);
      expect(covered('cpu', planSearch('cpu', f({ sockets: [socket] })).terms)).toBe(true);
    }
    for (const memory of MEMORY_TYPES) expect(covered('motherboard', planSearch('motherboard', f({ memory: [memory] })).terms)).toBe(true);
    for (const line of [...CPU_LINES.amd, ...CPU_LINES.intel]) expect(covered('cpu', planSearch('cpu', f({ cpuLines: [line] })).terms)).toBe(true);
    for (const m of GPU_MAKERS) expect(covered('gpu', planSearch('gpu', f({ gpuMakers: [m] })).terms)).toBe(true);
    expect(covered('gpu', planSearch('gpu', f({ gpuMakers: [...GPU_MAKERS] })).terms)).toBe(true);
    for (const memory of MEMORY_TYPES)
      for (const c of RAM_CAPACITIES) expect(covered('ram', planSearch('ram', f({ memory: [memory], ramCapacity: [c] })).terms)).toBe(true);
    for (const i of SSD_INTERFACES) expect(covered('ssd', planSearch('ssd', f({ ssdInterfaces: [i] })).terms)).toBe(true);
    for (const t of COOLER_TYPES) expect(covered('cooler', planSearch('cooler', f({ coolerTypes: [t] })).terms)).toBe(true);
    expect(covered('case', planSearch('case', f({})).terms)).toBe(true);
    for (const ff of FORM_FACTORS) expect(covered('case', planSearch('case', f({ caseFormFactors: [ff] })).terms)).toBe(true);
  });
});

describe('SSD, cooler e gabinete', () => {
  it('SSD: interface vira termo; capacidade filtra pela faixa', () => {
    expect(planSearch('ssd', f({ ssdInterfaces: ['sata', 'nvme'] }))).toMatchObject({ ready: true, terms: ['SSD NVMe', 'SSD SATA'] });
    expect(planSearch('ssd', f({ ssdCapacity: [1000] }))).toMatchObject({ ready: false, label: 'Escolha a Interface' });
    const offer = (ssdCapacity: number) => ({ store: 's1', inStock: true, marketplace: false, openbox: false, priceCash: 100, title: '', specs: { ssdCapacity } }) as unknown as Offer;
    expect(applyFilters([offer(480), offer(512), offer(1000)], f({ ssdCapacity: [500], inStockOnly: false })).map((o) => o.specs.ssdCapacity)).toEqual([480, 512]);
  });

  it('cooler: tipo vira termo (já com o nome da categoria)', () => {
    expect(planSearch('cooler', f({ coolerTypes: ['water'] }))).toMatchObject({ ready: true, terms: ['Water Cooler'] });
    expect(planSearch('cooler', f({})).ready).toBe(false);
  });

  it('gabinete: sem formato busca todos; com formato, mostra onde a placa cabe', () => {
    expect(planSearch('case', f({}))).toMatchObject({ ready: true, terms: ['Gabinete'], label: 'Buscar Gabinetes' });
    expect(planSearch('case', f({ caseFormFactors: ['atx'] }))).toMatchObject({ terms: ['Gabinete ATX'] });
    const offer = (caseFormFactor?: string) => ({ store: 's1', inStock: true, marketplace: false, openbox: false, priceCash: 100, title: '', specs: { caseFormFactor } }) as unknown as Offer;
    const shown = applyFilters([offer('matx'), offer('atx'), offer('eatx'), offer()], f({ caseFormFactors: ['atx'], inStockOnly: false }));
    expect(shown.map((o) => o.specs.caseFormFactor)).toEqual(['atx', 'eatx']);
  });
});
