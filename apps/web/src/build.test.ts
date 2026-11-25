import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeListing, type BuildSlot, type Offer, type StoreId } from '@upgradezin/shared';
import { bestOffer, buildDrives, buildTotals, checkCandidate, editDrive, loadBuild, sanitizeBuild, saveBuild, slotFilters, type BuildItem, type SavedBuild } from './build.ts';
import { DEFAULT_FILTERS } from './filters.ts';

const offer = (store: StoreId, priceCash: number, inStock = true): Offer =>
  ({ store, storeSku: `${store}-${priceCash}`, title: '', url: '', priceCash, inStock, seller: '', marketplace: false, openbox: false, specs: {}, modelKey: '', collectedAt: '2026-01-01T00:00:00.000Z' }) as Offer;

const item = (slot: BuildSlot, title: string, offers: Offer[] = [offer('s1', 100)]): BuildItem => ({
  key: title,
  title,
  specs: normalizeListing(slot, title).specs,
  offers,
});

const MB_AM4 = item('motherboard', 'Placa-mãe MSI B550 Gaming Plus, AMD AM4, ATX, DDR4');
const MB_AM5 = item('motherboard', 'Placa Mãe Gigabyte B850 Eagle WiFi6E, AMD AM5, ATX, DDR5');
const MB_LGA1700 = item('motherboard', 'Placa Mãe Gigabyte B760M DS3H, Intel LGA 1700, mATX');
const CPU_5600 = item('cpu', 'Processador AMD Ryzen 5 5600, AM4');
const CPU_7600 = item('cpu', 'Processador AMD Ryzen 5 7600, AM5, com cooler');
const GPU_4060 = item('gpu', 'Placa de vídeo Gigabyte RTX 4060 Eagle OC 8GB GDDR6');

it('adiciona, valida e remove discos por posição, incluindo apenas compras no total', () => {
  const motherboard = { ...MB_AM4, specs: { m2Slots: 1, sataPorts: 2 } };
  const nvme: BuildItem = { ...item('ssd', 'SSD NVMe'), current: true, specs: { ssdInterface: 'nvme' } };
  const sata: BuildItem = { ...item('ssd', 'SSD SATA', [offer('s1', 220)]), specs: { ssdInterface: 'sata' } };
  const first = { motherboard, ssd: nvme };
  expect(checkCandidate(first, 'ssd', nvme.specs, 1).status).toBe('error');
  expect(checkCandidate(first, 'ssd', sata.specs, 1).status).toBe('ok');
  const build = editDrive(first, 1, sata);
  expect(buildTotals(build)).toMatchObject({ best: 320, parts: 2, current: 1 });
  expect(buildDrives(sanitizeBuild(JSON.parse(JSON.stringify(build)))).map((d) => d.title)).toEqual(['SSD NVMe', 'SSD SATA']);
  expect(editDrive(build, 0).ssd).toBe(sata);
});

describe('slotFilters: a busca de cada peça já vem filtrada pela montagem', () => {
  it('placa-mãe AM4 → processador AM4 e memória DDR4', () => {
    const b: SavedBuild = { motherboard: MB_AM4 };
    expect(slotFilters('cpu', b).sockets).toEqual(['AM4']);
    expect(slotFilters('ram', b).memory).toEqual(['ddr4']);
  });
  it('processador escolhido primeiro → placa-mãe da mesma plataforma; memória pelo processador', () => {
    const b: SavedBuild = { cpu: CPU_7600 };
    expect(slotFilters('motherboard', b).sockets).toEqual(['AM5']);
    expect(slotFilters('ram', b).memory).toEqual(['ddr5']);
  });
  it('plataforma com DDR4 e DDR5 sem tipo informado não chuta', () => {
    expect(slotFilters('ram', { motherboard: MB_LGA1700 }).memory).toEqual([]);
  });
  it('fonte: potências a partir da recomendada', () => {
    const f = slotFilters('psu', { cpu: CPU_5600, gpu: GPU_4060 });
    expect(f.watts).toEqual([450, 500, 550]); // 90 + 115 + 75 = 280 W → recomendado 400 W
  });
  it('mantém o resto do formulário e não muda nada sem peça que restrinja', () => {
    const base = { ...DEFAULT_FILTERS, cpuLines: ['Ryzen 5'], sockets: ['LGA1700' as const] };
    expect(slotFilters('cpu', { motherboard: MB_AM4 }, base)).toMatchObject({ cpuLines: ['Ryzen 5'], sockets: ['AM4'] });
    expect(slotFilters('gpu', { motherboard: MB_AM4 })).toEqual(DEFAULT_FILTERS);
  });
});

describe('checkCandidate: cada produto do resultado contra o resto da montagem', () => {
  it('processador de outra plataforma fica vermelho', () => {
    const r = checkCandidate({ motherboard: MB_AM4 }, 'cpu', CPU_7600.specs);
    expect(r.status).toBe('error');
    expect(r.issues[0]?.code).toBe('socket-mismatch');
  });
  it('troca: a candidata entra no lugar da peça atual', () => {
    expect(checkCandidate({ motherboard: MB_AM4, cpu: CPU_5600 }, 'motherboard', MB_AM5.specs).status).toBe('error');
    expect(checkCandidate({ motherboard: MB_AM5, cpu: CPU_5600 }, 'motherboard', MB_AM4.specs).status).toBe('ok');
  });
  it('só mostra o que envolve a candidata', () => {
    const b: SavedBuild = { cpu: item('cpu', 'Processador AMD Ryzen 5 9600X, AM5, sem cooler') };
    const r = checkCandidate(b, 'motherboard', MB_AM5.specs);
    expect(r.issues.map((i) => i.code)).not.toContain('needs-cooler');
  });
});

describe('totais', () => {
  it('melhor oferta: a mais barata em estoque', () => {
    const i = item('cpu', 'Processador AMD Ryzen 5 5600, AM4', [offer('s1', 900), offer('s2', 800, false), offer('s3', 850)]);
    expect(bestOffer(i)?.store).toBe('s3');
  });
  it('soma da melhor combinação e de cada loja sozinha', () => {
    const b: SavedBuild = {
      motherboard: item('motherboard', MB_AM4.title, [offer('s1', 700), offer('s2', 650)]),
      cpu: item('cpu', CPU_5600.title, [offer('s1', 800), offer('s3', 750)]),
    };
    const t = buildTotals(b);
    expect(t.best).toBe(650 + 750);
    expect(t.parts).toBe(2);
    expect(t.perStore).toEqual([
      { store: 's1', total: 1500, missing: 0 },
      { store: 's2', total: 650, missing: 1 },
      { store: 's3', total: 750, missing: 1 },
    ]);
  });
  it('quantidade multiplica o preço da peça', () => {
    const ram = { ...item('ram', 'Memória RAM Kingston Fury Beast, 8GB, 3200MHz, DDR4', [offer('s1', 200), offer('s2', 180)]), qty: 2 };
    const t = buildTotals({ ram });
    expect(t.best).toBe(360);
    expect(t.perStore).toEqual([
      { store: 's1', total: 400, missing: 0 },
      { store: 's2', total: 360, missing: 0 },
    ]);
  });
  it('montagem vazia', () => {
    expect(buildTotals({})).toEqual({ best: 0, perStore: [], parts: 0, current: 0 });
  });
  it('peça atual (do CPU-Z) fica fora do total e da soma por loja', () => {
    const cpu: BuildItem = { ...CPU_5600, offers: [], current: true };
    const t = buildTotals({ cpu, gpu: item('gpu', 'Placa de vídeo Gigabyte RTX 4060 Eagle OC 8GB GDDR6', [offer('s1', 2000)]) });
    expect(t).toEqual({ best: 2000, perStore: [{ store: 's1', total: 2000, missing: 0 }], parts: 1, current: 1 });
  });
});

describe('guardar no navegador', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('salva e carrega; ignora peça em formato inesperado', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    saveBuild({ cpu: CPU_5600 });
    expect(loadBuild()).toEqual({ cpu: CPU_5600 });
    store.set('upgradezin.build.v1', JSON.stringify({ cpu: { title: 1 }, gpu: GPU_4060 }));
    expect(loadBuild()).toEqual({ gpu: GPU_4060 });
  });
  it('a marca de peça atual só passa como true', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    store.set('upgradezin.build.v1', JSON.stringify({ cpu: { ...CPU_5600, current: true }, gpu: { ...GPU_4060, current: 'sim' } }));
    const b = loadBuild();
    expect(b.cpu?.current).toBe(true);
    expect(b.gpu && 'current' in b.gpu).toBe(false);
  });
  it('sem armazenamento disponível, começa vazia e não quebra', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    });
    expect(loadBuild()).toEqual({});
    expect(() => saveBuild({ cpu: CPU_5600 })).not.toThrow();
  });
});

describe('card de resultado sem medida ainda', () => {
  it('placa de vídeo no resultado, com gabinete na montagem: sem "confira o comprimento" (a ficha vem ao escolher)', () => {
    const b = { case: { key: 'c', title: 'Gabinete', specs: { caseFormFactor: 'atx' as const, caseMaxGpu: 400 }, offers: [] } };
    const r = checkCandidate(b, 'gpu', normalizeListing('gpu', 'Placa de vídeo Gigabyte RTX 4060 Eagle OC 8GB GDDR6').specs);
    expect(r.issues.map((i) => i.code)).not.toContain('case-gpu-unknown');
    // Com a medida (peça já medida), a checagem vale no card também.
    expect(checkCandidate(b, 'gpu', { gpuModel: 'RTX 4060', gpuLength: 420 }).status).toBe('error');
  });

  it('memória de 16 GB no resultado: sem "32 GB é o recomendado" em cada card (fica na montagem)', () => {
    expect(checkCandidate({}, 'ram', { memory: 'ddr4', ramCapacity: 16, ramModules: 2 }).issues.map((i) => i.code)).not.toContain('memory-capacity');
  });
});
