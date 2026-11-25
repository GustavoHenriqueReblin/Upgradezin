import { describe, expect, it } from 'vitest';
import { normalizeListing } from './categorize.ts';
import { checkBuild, type Build, type BuildSlot } from './compat.ts';
import { chipsetSupport, cpuFamily, cpuMemorySpeed, cpuPower, cpuTdp, GPU_POWER } from './hardware.ts';
import { extractCpuSpecs } from './cpu.ts';
import { withSheetSpecs } from './sheet/specs.ts';

/** Peça a partir do título do anúncio, como chega das lojas. */
const part = (category: BuildSlot, title: string) => ({ specs: normalizeListing(category, title).specs });

const MB_B550 = part('motherboard', 'Placa-Mãe MSI B550 Gaming WiFi6E, AMD AM4, ATX, DDR4, Wi-Fi 6E, Bluetooth 5.3');
const MB_B450 = part('motherboard', 'Placa Mãe Gigabyte B450M DS3H V2, AMD AM4, mATX, DDR4');
const MB_A320 = part('motherboard', 'Placa Mãe ASUS Prime A320M-K, AMD AM4, mATX, DDR4');
const MB_B650 = part('motherboard', 'Placa Mãe ASUS TUF Gaming B650-Plus WiFi, AMD AM5, ATX, DDR5');
const MB_B850 = part('motherboard', 'Placa Mãe Gigabyte B850 Eagle WiFi6E, AMD AM5, ATX, DDR5');
const MB_B760_D4 = part('motherboard', 'Placa Mãe ASUS Prime B760M-A D4, Intel LGA 1700, mATX');
const MB_H610 = part('motherboard', 'Placa Mãe Gigabyte H610M S2H, Intel LGA 1700, mATX, DDR4');
const MB_B460 = part('motherboard', 'Placa Mãe ASUS Prime B460M-A, Intel LGA 1200, mATX, DDR4');
const MB_H310 = part('motherboard', 'Placa Mãe ASRock H310CM-HDV, Intel LGA 1151, mATX, DDR4');
const MB_ITX = part('motherboard', 'Placa Mãe ASRock B650I Lightning WiFi, AM5');

const CPU_5600 = part('cpu', 'Processador AMD Ryzen 5 5600, 3.5GHz (4.4GHz Max Turbo), Cache 35MB, AM4, Sem Vídeo - 100-100000927BOX');
const CPU_5600G = part('cpu', 'Processador AMD Ryzen 5 5600G, 3.9GHz, AM4, Vídeo Integrado Radeon, Com Cooler');
const CPU_2600 = part('cpu', 'Processador AMD Ryzen 5 2600, 3.4GHz, AM4');
const CPU_7600 = part('cpu', 'Processador AMD Ryzen 5 7600, 3.8GHz, AM5, Com Cooler Wraith Stealth');
const CPU_9600X = part('cpu', 'Processador AMD Ryzen 5 9600X, 3.9GHz, AM5, Sem Cooler');
const CPU_12400F = part('cpu', 'Processador Intel Core i5-12400F, 2.5GHz, LGA 1700, Sem Vídeo');
const CPU_14600K = part('cpu', 'Processador Intel Core i5-14600K, 3.5GHz, LGA 1700');
const CPU_11400 = part('cpu', 'Processador Intel Core i5-11400, 2.6GHz, LGA 1200');
const CPU_7700 = part('cpu', 'Processador Intel Core i7-7700, 3.6GHz, LGA 1151');

const RAM_DDR4 = part('ram', 'Memória RAM Kingston Fury Beast, 16GB (2x8GB), 3200MHz, DDR4, CL16');
const RAM_DDR4_3600 = part('ram', 'Memória RAM Corsair Vengeance LPX, 16GB (2x8GB), 3600MHz, DDR4, CL18');
const RAM_DDR5 = part('ram', 'Memória RAM Kingston Fury Beast, 32GB (2x16GB), 6000MHz, DDR5, CL36');
const RAM_DDR5_4X = part('ram', 'Memória RAM Corsair Vengeance, 64GB (4x16GB), 5600MHz, DDR5, CL40');

const GPU_4060 = part('gpu', 'Placa de Vídeo Gigabyte RTX 4060 Eagle OC 8GB GDDR6');
const GPU_4090 = part('gpu', 'Placa de Vídeo ASUS ROG Strix RTX 4090 OC 24GB GDDR6X');

const PSU_550 = part('psu', 'Fonte MSI MAG A550BN, 550W, 80 Plus Bronze, PFC Ativo');
const PSU_650 = part('psu', 'Fonte Corsair CX650, 650W, 80 Plus Bronze');
const PSU_850_ATX3 = part('psu', 'Fonte MSI MAG A850GL, 850W, 80 Plus Gold, ATX 3.1, PCIe 5, Full Modular');
const PSU_1000_ATX3 = part('psu', 'Fonte Corsair RM1000x, 1000W, 80 Plus Gold, ATX 3.1, PCIe 5, Full Modular');

const codes = (b: Build) => checkBuild(b).issues.map((i) => i.code);

describe('checkBuild: montagens válidas', () => {
  it('AM4 com B550, Ryzen 5 5600, DDR4 e RTX 4060: tudo verde', () => {
    const r = checkBuild({ motherboard: MB_B550, cpu: CPU_5600, ram: RAM_DDR4, gpu: GPU_4060, psu: PSU_550 });
    expect(r.issues.filter((i) => i.level !== 'info')).toEqual([]);
    expect(r.status).toEqual({ motherboard: 'ok', cpu: 'ok', ram: 'ok', gpu: 'ok', psu: 'ok' });
    expect(r.power).toEqual({ estimate: 90 + 115 + 75, recommended: 400, partial: false });
  });
  it('AM5 com B850, Ryzen 5 9600X e DDR5', () => {
    const r = checkBuild({ motherboard: MB_B850, cpu: CPU_9600X, ram: RAM_DDR5, gpu: GPU_4060, psu: PSU_650 });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('LGA1700 com placa D4 e memória DDR4', () => {
    expect(codes({ motherboard: MB_B760_D4, cpu: CPU_12400F, ram: RAM_DDR4 })).not.toContain('memory-type-mismatch');
  });
  it('montagem vazia ou com uma peça só não tem problema', () => {
    expect(checkBuild({}).issues).toEqual([]);
    expect(checkBuild({ motherboard: MB_B550 }).status).toEqual({ motherboard: 'ok' });
  });
});

describe('checkBuild: incompatibilidades (vermelho)', () => {
  it('processador de outro encaixe', () => {
    const r = checkBuild({ motherboard: MB_B550, cpu: CPU_7600 });
    expect(r.issues[0]).toMatchObject({ level: 'error', code: 'socket-mismatch', parts: ['motherboard', 'cpu'] });
    expect(r.status).toMatchObject({ motherboard: 'error', cpu: 'error' });
  });
  it('trocar a placa-mãe de AM4 para AM5 marca processador e memória na hora', () => {
    const am4: Build = { motherboard: MB_B550, cpu: CPU_5600, ram: RAM_DDR4 };
    expect(checkBuild(am4).issues.filter((i) => i.level === 'error')).toEqual([]);
    const r = checkBuild({ ...am4, motherboard: MB_B650 });
    expect(r.status).toMatchObject({ motherboard: 'error', cpu: 'error', ram: 'error' });
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['socket-mismatch', 'memory-type-mismatch']));
  });
  it('mesmo encaixe, chipset que não aceita a geração', () => {
    expect(codes({ motherboard: MB_B550, cpu: CPU_2600 })).toContain('chipset-unsupported');
    expect(codes({ motherboard: MB_B460, cpu: CPU_11400 })).toContain('chipset-unsupported');
    expect(codes({ motherboard: MB_H310, cpu: CPU_7700 })).toContain('chipset-unsupported');
  });
  it('memória DDR4 em placa DDR5', () => {
    expect(codes({ motherboard: MB_B650, ram: RAM_DDR4 })).toContain('memory-type-mismatch');
  });
  it('memória de tipo que o processador não usa (sem placa escolhida)', () => {
    expect(codes({ cpu: CPU_7600, ram: RAM_DDR4 })).toContain('memory-cpu-mismatch');
    expect(codes({ cpu: CPU_12400F, ram: RAM_DDR5 })).not.toContain('memory-cpu-mismatch'); // LGA1700 aceita os dois
  });
  it('kit de 4 pentes em placa Mini-ITX', () => {
    expect(codes({ motherboard: MB_ITX, ram: RAM_DDR5_4X })).toContain('slots-exceeded');
  });
  it('quantidade: pentes avulsos somam (2 kits de 2 = 4 pentes)', () => {
    const avulso = part('ram', 'Memória RAM Kingston Fury Beast, 8GB, 3200MHz, DDR4, CL16 - KF432C16BB/8');
    expect(codes({ motherboard: MB_B550, ram: { ...avulso, qty: 2 } })).not.toContain('slots-exceeded');
    expect(codes({ motherboard: MB_ITX, ram: { ...RAM_DDR5, qty: 2 } })).toContain('slots-exceeded');
    const r = checkBuild({ motherboard: MB_ITX, ram: { ...RAM_DDR5, qty: 2 } });
    expect(r.issues.find((i) => i.code === 'slots-exceeded')?.message).toBe('São 4 pentes e a placa-mãe só tem 2 slots.');
    // Avulsos iguais: aviso leve (só o kit garante a frequência), sem mudar o selo.
    expect(codes({ ram: { ...avulso, qty: 2 } })).toContain('memory-separate-modules');
    expect(codes({ ram: avulso })).not.toContain('memory-separate-modules');
  });
  it('memória abaixo de 32 GB: observação que não muda o selo', () => {
    const kit16 = part('ram', 'Memória RAM Kingston Fury Beast, 16GB (2x8GB), 3200MHz, DDR4, CL16');
    const r = checkBuild({ ram: kit16 });
    expect(r.issues.find((i) => i.code === 'memory-capacity')).toMatchObject({ level: 'info' });
    expect(r.status.ram).toBe('ok');
    expect(codes({ ram: { ...kit16, qty: 2 } })).not.toContain('memory-capacity'); // 2 kits = 32 GB
  });
  it('fonte abaixo do consumo máximo', () => {
    const r = checkBuild({ cpu: CPU_14600K, gpu: GPU_4090, psu: PSU_550 });
    expect(r.issues.find((i) => i.code === 'psu-too-weak')?.level).toBe('error');
    expect(r.status.psu).toBe('error');
  });
});

describe('checkBuild: ressalvas (amarelo)', () => {
  it('BIOS pode precisar de atualização', () => {
    expect(codes({ motherboard: MB_B450, cpu: CPU_5600 })).toContain('chipset-bios');
    expect(codes({ motherboard: MB_A320, cpu: CPU_5600G })).toContain('chipset-bios');
    expect(codes({ motherboard: MB_B650, cpu: CPU_9600X })).toContain('chipset-bios');
    expect(codes({ motherboard: MB_H610, cpu: CPU_14600K })).toContain('chipset-bios');
    expect(codes({ motherboard: MB_B850, cpu: CPU_9600X })).not.toContain('chipset-bios');
  });
  it('fonte no limite', () => {
    const conventional = { specs: { ...PSU_850_ATX3.specs, atx: undefined } };
    const r = checkBuild({ cpu: CPU_14600K, gpu: GPU_4090, psu: conventional });
    expect(r.issues.find((i) => i.code === 'psu-tight')?.message).toContain('950 W');
    expect(codes({ cpu: CPU_14600K, gpu: GPU_4090, psu: PSU_850_ATX3 })).not.toContain('psu-tight');
    expect(codes({ cpu: CPU_14600K, gpu: GPU_4090, psu: PSU_1000_ATX3 })).not.toContain('psu-tight');
  });
  it('processador sem vídeo integrado e sem placa de vídeo (observação: a placa de vídeo é peça da montagem)', () => {
    expect(checkBuild({ cpu: CPU_12400F }).issues.find((i) => i.code === 'needs-gpu')?.level).toBe('info');
    expect(checkBuild({ cpu: CPU_12400F }).status.cpu).toBe('ok');
    expect(codes({ cpu: CPU_12400F, gpu: GPU_4060 })).not.toContain('needs-gpu');
    expect(codes({ cpu: CPU_5600G })).not.toContain('needs-gpu');
  });
  it('processador sem cooler', () => {
    expect(codes({ cpu: CPU_9600X })).toContain('needs-cooler');
    expect(codes({ cpu: CPU_7600 })).not.toContain('needs-cooler');
  });
  it('placa Intel que trava a frequência da memória', () => {
    const r = checkBuild({ motherboard: MB_B460, cpu: part('cpu', 'Processador Intel Core i5-10400F, LGA 1200'), ram: RAM_DDR4_3600 });
    expect(r.issues.find((i) => i.code === 'memory-speed-locked')).toMatchObject({ level: 'warn', parts: ['ram', 'motherboard'] });
  });
});

describe('checkBuild: sem informação suficiente (cinza, nunca verde)', () => {
  it('placa LGA1700 sem tipo de memória no título', () => {
    const mb = part('motherboard', 'Placa Mãe Gigabyte B760M DS3H, Intel LGA 1700, mATX');
    const r = checkBuild({ motherboard: mb, ram: RAM_DDR5 });
    expect(r.issues[0]?.code).toBe('memory-type-unknown');
    expect(r.status).toEqual({ motherboard: 'unknown', ram: 'unknown' });
  });
  it('kit de 4 pentes numa Micro-ATX sem os slots no título (2 ou 4: não dá para saber)', () => {
    const mb = part('motherboard', 'Placa Mãe ASUS Prime B650M-A, AMD AM5, mATX, DDR5');
    expect(codes({ motherboard: mb, ram: RAM_DDR5_4X })).toContain('slots-unknown');
  });
  it('placa ATX conta como 4 slots: kit de 4 serve, 8 pentes não', () => {
    expect(codes({ motherboard: MB_B650, ram: RAM_DDR5_4X })).not.toContain('slots-unknown');
    expect(codes({ motherboard: MB_B650, ram: { ...RAM_DDR5_4X, qty: 2 } })).toContain('slots-exceeded');
  });
  it('fonte sem processador escolhido', () => {
    expect(checkBuild({ gpu: GPU_4060, psu: PSU_650 }).status.psu).toBe('unknown');
  });
  it('placa de vídeo fora da tabela de consumo', () => {
    const r = checkBuild({ cpu: CPU_5600, gpu: { specs: { gpuModel: 'RTX 9999' } }, psu: PSU_650 });
    expect(r.power).toBeUndefined();
    expect(r.status.psu).toBe('unknown');
  });
});

describe('checkBuild: observações (não mudam o selo)', () => {
  it('memória acima do padrão do processador pede perfil XMP/EXPO', () => {
    const r = checkBuild({ motherboard: MB_B650, cpu: CPU_7600, ram: RAM_DDR5 });
    expect(r.issues.find((i) => i.code === 'memory-speed-profile')?.level).toBe('info');
    expect(r.status.ram).toBe('ok');
  });
  it('placa de vídeo forte com fonte sem 12V-2x6', () => {
    const r = checkBuild({ cpu: CPU_5600, gpu: GPU_4090, psu: part('psu', 'Fonte Corsair RM1000e, 1000W, 80 Plus Gold') });
    expect(r.issues.find((i) => i.code === 'gpu-connector')?.level).toBe('info');
    expect(codes({ cpu: CPU_5600, gpu: GPU_4090, psu: PSU_1000_ATX3 })).not.toContain('gpu-connector');
  });
  it('estimativa parcial sem placa de vídeo', () => {
    expect(checkBuild({ cpu: CPU_5600G }).power).toMatchObject({ estimate: 165, partial: true });
  });
});

describe('ordem das categorias', () => {
  it('a barra de categorias segue a ordem da montagem', async () => {
    const { CATEGORIES } = await import('./types.ts');
    const { BUILD_SLOTS } = await import('./compat.ts');
    expect(CATEGORIES.slice(0, BUILD_SLOTS.length)).toEqual([...BUILD_SLOTS]);
  });
});

describe('tabelas de plataforma', () => {
  const fam = (t: string) => cpuFamily(extractCpuSpecs(t));
  it.each([
    ['Processador AMD Ryzen 5 1600', 'zen1'],
    ['Processador AMD Ryzen 5 2400G', 'zen1'],
    ['Processador AMD Ryzen 5 2600', 'zen+'],
    ['Processador AMD Ryzen 5 3400G', 'zen+'],
    ['Processador AMD Ryzen 5 3600', 'zen2'],
    ['Processador AMD Ryzen 5 4600G', 'zen2'],
    ['Processador AMD Ryzen 7 5700X3D', 'zen3'],
    ['Processador AMD Athlon 3000G', 'zen1'],
    ['Processador AMD Ryzen 7 8700G', 'r8000'],
    ['Processador Intel Core i3-10105F', 'i10'],
    ['Processador Intel Core i7-14700K', 'i14'],
    ['Processador Intel Core 5 120F', 'core1'],
    ['Processador Intel Core Ultra 7 265K', 'ultra2'],
    ['Processador Intel Pentium Gold G4560', 'i7'],
    ['Processador Intel Pentium Gold G5400', 'i8'],
    ['Processador Intel Celeron G5905', 'i10'],
    ['Processador Intel Pentium Gold G7400', 'i12'],
  ])('%s → %s', (t, f) => expect(fam(t)).toBe(f));

  it('chipset fora da tabela não inventa resposta', () => {
    expect(chipsetSupport('B550', 'zen3')).toBe('ok');
    expect(chipsetSupport('Q670', 'i12')).toBeUndefined();
  });
  it('frequência oficial de memória', () => {
    expect(cpuMemorySpeed(extractCpuSpecs('Processador Intel Core i5-13400F, LGA 1700'), 'ddr5')).toBe(5600);
    expect(cpuMemorySpeed(extractCpuSpecs('Processador Intel Core i5-13400F, LGA 1700'), 'ddr4')).toBe(3200);
    expect(cpuMemorySpeed(extractCpuSpecs('Processador AMD Ryzen 5 7600, AM5'), 'ddr4')).toBeUndefined();
  });
  it('consumo cresce com a linha', () => {
    const w = (t: string) => cpuPower(extractCpuSpecs(t))!;
    expect(w('Processador AMD Ryzen 5 5600')).toBeLessThan(w('Processador AMD Ryzen 9 7950X'));
    expect(w('Processador Intel Core i5-12400F')).toBeLessThan(w('Processador Intel Core i9-14900K'));
  });
  it('todo chip da tabela de consumo é um modelo que o extrator produz', () => {
    for (const model of Object.keys(GPU_POWER)) {
      const specs = normalizeListing('gpu', `Placa de Vídeo Teste ${model} 8GB`).specs;
      expect(specs.gpuModel, model).toBe(model);
    }
  });
});

describe('SSD, cooler e gabinete na montagem', () => {
  const COOLER_OLD = part('cooler', 'Cooler Para Processador Cooler Master Standard I30, Intel, LGA 1156/1155/1151/1150 - RH-I30-26FK-R1');
  const COOLER_ANY = part('cooler', 'Air Cooler Para Processador Deepcool Ag400 G2 ARGB, 120mm, Intel-amd, Preto');
  const COOLER_NONE = part('cooler', 'Cooler Para Processador Gamemax Gamma 200, RGB');
  const WATER_360 = part('cooler', 'Water Cooler MSI MAG Coreliquid A13, ARGB, 360mm, Intel e AMD, Preto');
  const CASE_MATX = part('case', 'Gabinete Gamer Husky Dome 10, Micro-ATX, Lateral e Frontal em Vidro, Sem Fans, Preto');
  const CASE_ATX = part('case', 'Gabinete Gamer Corsair 4000D RS ARGB, Mid Tower, Lateral em Vidro, com 3x Fans RS ARGB, Preto');
  const CASE_NONE = part('case', 'Gabinete Gamer Rise Mode X5 Glass, RGB, Lateral em Vidro Fumê, Sem FANs, Preto');
  const SSD_GEN4 = part('ssd', 'SSD Kingston NV3, 1TB, M.2 2280, PCIe 4.0 x4, NVMe, Leitura: 6000 MB/s');

  it('cooler fora do encaixe do processador (vermelho); "Intel e AMD" serve; sem informação fica cinza', () => {
    expect(codes({ cpu: CPU_12400F, cooler: COOLER_OLD })).toContain('cooler-socket');
    expect(codes({ cpu: CPU_7600, cooler: COOLER_ANY })).not.toContain('cooler-socket');
    expect(checkBuild({ cpu: CPU_7600, cooler: COOLER_NONE }).status.cooler).toBe('unknown');
  });

  it('cooler na montagem tira o aviso de processador sem cooler', () => {
    expect(codes({ cpu: CPU_9600X })).toContain('needs-cooler');
    expect(codes({ cpu: CPU_9600X, cooler: COOLER_ANY })).not.toContain('needs-cooler');
  });

  it('placa-mãe que não cabe no gabinete (vermelho); gabinete maior serve; sem formato fica cinza', () => {
    expect(codes({ motherboard: MB_B550, case: CASE_MATX })).toContain('case-board');
    expect(codes({ motherboard: MB_B450, case: CASE_ATX })).not.toContain('case-board');
    expect(checkBuild({ motherboard: MB_B550, case: CASE_NONE }).status.case).toBe('unknown');
  });

  it('observações que não mudam o selo: radiador grande e SSD mais novo que o M.2 da placa', () => {
    const r = checkBuild({ motherboard: MB_B450, case: CASE_ATX, cooler: WATER_360, cpu: CPU_5600, ssd: SSD_GEN4 });
    expect(r.issues.filter((i) => i.level === 'info').map((i) => i.code)).toEqual(expect.arrayContaining(['case-radiator', 'ssd-pcie']));
    expect(r.status.ssd).toBe('ok'); // observação não muda o selo
    expect(codes({ motherboard: MB_B650, ssd: SSD_GEN4 })).not.toContain('ssd-pcie');
  });
});

describe('TDP de referência e o que depende dele', () => {
  const tdp = (t: string) => cpuTdp(extractCpuSpecs(t));
  it('por família e sufixo, com as exceções da AMD', () => {
    expect(tdp('Processador AMD Ryzen 5 5600, AM4')).toBe(65);
    expect(tdp('Processador AMD Ryzen 5 5600X, AM4')).toBe(65);
    expect(tdp('Processador AMD Ryzen 7 5800X, AM4')).toBe(105);
    expect(tdp('Processador AMD Ryzen 7 5800X3D, AM4')).toBe(105);
    expect(tdp('Processador AMD Ryzen 7 7800X3D, AM5')).toBe(120);
    expect(tdp('Processador AMD Ryzen 9 7950X, AM5')).toBe(170);
    expect(tdp('Processador AMD Ryzen 5 9600X, AM5')).toBe(65);
    expect(tdp('Processador Intel Core i5-12400F, LGA 1700')).toBe(65);
    expect(tdp('Processador Intel Core i3-12100F, LGA 1700')).toBe(60);
    expect(tdp('Processador Intel Core i7-14700K, LGA 1700')).toBe(125);
    expect(tdp('Processador Intel Core i9-14900KS, LGA 1700')).toBe(150);
    expect(tdp('Processador Intel Core i7-8700K, LGA 1151')).toBe(95);
    expect(tdp('Processador Intel Core Ultra 7 265K, LGA 1851')).toBe(125);
  });

  const COOLER_130W = part('cooler', 'Air Cooler Para Processador Gamer Teste X1, TDP 130W, Intel e AMD, 120mm');
  const WATER_120 = part('cooler', 'Water Cooler Teste W1, 120mm, Intel e AMD');
  const CPU_14700K = part('cpu', 'Processador Intel Core i7-14700K, 3.4GHz, LGA 1700');

  it('cooler fraco para o processador da loja (antes só valia para o PC importado)', () => {
    expect(COOLER_130W.specs.coolerTdp).toBe(130);
    const r = checkBuild({ cpu: part('cpu', 'Processador AMD Ryzen 9 7950X, AM5'), cooler: COOLER_130W });
    expect(r.issues.find((i) => i.code === 'cooler-tdp')?.message).toContain('170 W');
    expect(r.status.cooler).toBe('warn');
    expect(codes({ cpu: CPU_14700K, cooler: COOLER_130W })).not.toContain('cooler-tdp'); // 125 W cabe em 130 W
    expect(codes({ cpu: CPU_12400F, cooler: COOLER_130W })).not.toContain('cooler-tdp');
  });

  it('o TDP do CPU-Z vale mais que o de referência', () => {
    const cpu = { specs: { ...CPU_14700K.specs, tdp: 65 } };
    expect(codes({ cpu, cooler: COOLER_130W })).not.toContain('cooler-tdp');
  });

  it('water cooler de 120 mm com processador forte: observação', () => {
    expect(codes({ cpu: CPU_14700K, cooler: WATER_120 })).toContain('cooler-small-radiator');
    expect(codes({ cpu: CPU_12400F, cooler: WATER_120 })).not.toContain('cooler-small-radiator');
  });

  it('placa de entrada com processador forte: observação sobre a regulagem de energia', () => {
    const r = checkBuild({ motherboard: MB_H610, cpu: CPU_14700K });
    expect(r.issues.find((i) => i.code === 'board-vrm')?.level).toBe('info');
    expect(codes({ motherboard: MB_H610, cpu: CPU_12400F })).not.toContain('board-vrm');
    expect(codes({ motherboard: MB_B650, cpu: part('cpu', 'Processador AMD Ryzen 9 7950X, AM5') })).not.toContain('board-vrm');
  });

  it('H610 trava a memória na frequência oficial', () => {
    expect(codes({ motherboard: MB_H610, cpu: CPU_12400F, ram: RAM_DDR4_3600 })).toContain('memory-speed-locked');
    expect(codes({ motherboard: MB_B760_D4, cpu: CPU_12400F, ram: RAM_DDR4_3600 })).toContain('memory-speed-profile');
  });
});

describe('checagem física (medidas da ficha técnica)', () => {
  const GPU = (gpuLength?: number, gpu16Pin?: boolean) => ({ specs: { ...GPU_4060.specs, gpuLength, gpu16Pin } });
  const CASE = (caseMaxGpu?: number, caseMaxCooler?: number, caseRadiators?: number[]) => ({ specs: { caseFormFactor: 'atx' as const, caseMaxGpu, caseMaxCooler, caseRadiators } });
  const AIR = (coolerHeight?: number) => ({ specs: { coolerType: 'air' as const, coolerBrands: ['amd' as const, 'intel' as const], coolerHeight } });
  const WATER = (radiator: number) => ({ specs: { coolerType: 'water' as const, radiator, coolerBrands: ['amd' as const, 'intel' as const] } });

  it('placa de vídeo × gabinete: não cabe (vermelho), justa (amarelo), cabe, sem medida (observação)', () => {
    expect(checkBuild({ gpu: GPU(340), case: CASE(320) }).status).toMatchObject({ gpu: 'error', case: 'error' });
    expect(codes({ gpu: GPU(315), case: CASE(320) })).toContain('case-gpu-tight');
    expect(codes({ gpu: GPU(269), case: CASE(420) })).not.toEqual(expect.arrayContaining(['case-gpu-length', 'case-gpu-tight', 'case-gpu-unknown']));
    const r = checkBuild({ gpu: GPU(), case: CASE(420) });
    expect(r.issues.find((i) => i.code === 'case-gpu-unknown')?.level).toBe('info');
    expect(r.status.case).toBe('ok');
  });
  it('air cooler × altura do gabinete; water cooler × radiadores aceitos', () => {
    expect(codes({ cooler: AIR(165), case: CASE(undefined, 155) })).toContain('case-cooler-height');
    expect(codes({ cooler: AIR(150), case: CASE(undefined, 155) })).not.toContain('case-cooler-height');
    expect(codes({ cooler: AIR(), case: CASE(undefined, 155) })).toContain('case-cooler-unknown');
    expect(codes({ cooler: WATER(360), case: CASE(undefined, undefined, [240, 280]) })).toContain('case-radiator-unsupported');
    expect(codes({ cooler: WATER(360), case: CASE(undefined, undefined, [280, 360]) })).not.toEqual(expect.arrayContaining(['case-radiator-unsupported', 'case-radiator']));
    expect(codes({ cooler: WATER(360), case: CASE() })).toContain('case-radiator'); // sem a lista: conferir
  });
  it('conector 12V-2x6: pela ficha quando há; sem ficha, pelo consumo do chip', () => {
    expect(codes({ cpu: CPU_5600, gpu: GPU(300, true), psu: PSU_650 })).toContain('gpu-connector');
    expect(codes({ cpu: CPU_14600K, gpu: { specs: { ...GPU_4090.specs, gpu16Pin: false } }, psu: PSU_1000_ATX3 })).not.toContain('gpu-connector');
    expect(codes({ cpu: CPU_14600K, gpu: GPU_4090, psu: part('psu', 'Fonte Corsair RM1000e, 1000W, 80 Plus Gold') })).toContain('gpu-connector');
  });
});

describe('compatibilidade com a ficha técnica', () => {
  /** Peça pelo título com a ficha por cima, como chega do servidor. */
  const sheet = (category: BuildSlot, title: string, values: Record<string, string | number | boolean>) => ({
    specs: withSheetSpecs(category, normalizeListing(category, title).specs, values),
  });
  const codes = (b: Build) => checkBuild(b).issues.map((i) => i.code);
  const board = (values: Record<string, string | number>) => sheet('motherboard', 'Placa Mãe ASUS Prime B450M, AMD AM4, mATX, DDR4', { socket: 'AM4', chipset: 'B450', formFactor: 'Micro-ATX', ramType: 'DDR4', ...values });

  it('memória além do máximo da placa: erro; acima dos MHz da placa: observação', () => {
    const ram = sheet('ram', 'Memória Kingston Fury, 32GB (2x16GB), 3600MHz, DDR4', { type: 'DDR4', capacityGb: 32, modules: 2, mhz: 3600 });
    expect(codes({ motherboard: board({ ramMaxGb: 64, ramMaxMhz: 4000 }), ram })).not.toContain('memory-max-exceeded');
    expect(codes({ motherboard: board({ ramMaxGb: 16 }), ram })).toContain('memory-max-exceeded');
    expect(codes({ motherboard: { ...board({ ramMaxGb: 64 }) }, ram: { ...ram, qty: 3 } })).toContain('memory-max-exceeded'); // 3 kits de 32 = 96 GB
    const slow = checkBuild({ motherboard: board({ ramMaxMhz: 3200 }), ram }).issues.find((i) => i.code === 'memory-speed-board');
    expect(slow?.message).toBe('A placa-mãe vai até 3200 MHz: a memória de 3600 MHz roda a 3200 MHz.');
  });

  it('SSD: M.2 em placa sem M.2 e SATA sem porta SATA; geração do M.2 pela ficha da placa', () => {
    const m2 = sheet('ssd', 'SSD Kingston NV3 1TB, M.2 2280, NVMe PCIe 4.0', { interface: 'NVMe PCIe 4.0', formFactor: 'M.2 2280', capacityGb: 1000 });
    const sata = sheet('ssd', 'SSD Kingston A400 480GB, 2,5", SATA', { interface: 'SATA', formFactor: '2,5"', capacityGb: 480 });
    expect(codes({ motherboard: board({ m2Slots: 0 }), ssd: m2 })).toContain('ssd-no-m2');
    expect(codes({ motherboard: board({ m2Slots: 1 }), ssd: m2 })).not.toContain('ssd-no-m2');
    expect(codes({ motherboard: board({ sataPorts: 0 }), ssd: sata })).toContain('ssd-no-sata');
    // B450 pelo chipset seria PCIe 3.0; a ficha desta placa diz M.2 4.0: sem observação.
    expect(codes({ motherboard: board({ m2Pcie: '4.0' }), ssd: m2 })).not.toContain('ssd-pcie');
    expect(codes({ motherboard: board({}), ssd: m2 })).toContain('ssd-pcie');
  });

  it('placa de vídeo x8 em placa-mãe PCIe 3.0: observação (pela ficha ou pela lista de chips x8)', () => {
    const x8 = sheet('gpu', 'Placa de Vídeo RX 7600 8GB', { chip: 'RX 7600', pcie: '4.0 x8' });
    const x16 = sheet('gpu', 'Placa de Vídeo RTX 4070 12GB', { chip: 'RTX 4070', pcie: '4.0 x16' });
    expect(codes({ motherboard: board({ pcieX16: '3.0' }), gpu: x8 })).toContain('gpu-pcie-lanes');
    expect(codes({ motherboard: board({ pcieX16: '4.0' }), gpu: x8 })).not.toContain('gpu-pcie-lanes');
    expect(codes({ motherboard: board({ pcieX16: '3.0' }), gpu: x16 })).not.toContain('gpu-pcie-lanes');
    // Sem PCIe na ficha: a lista de chips x8 decide (RTX 4060 é x8); B450 é PCIe 3.0 pelo chipset.
    expect(codes({ motherboard: board({}), gpu: sheet('gpu', 'Placa de Vídeo RTX 4060 8GB', { chip: 'RTX 4060' }) })).toContain('gpu-pcie-lanes');
  });

  it('fonte: consumo da placa de vídeo pela ficha quando o chip não está na tabela; a recomendada pelo fabricante é o piso', () => {
    const cpu = part('cpu', 'Processador AMD Ryzen 5 5600, 3.5GHz, AM4');
    const unknown = sheet('gpu', 'Placa de Vídeo Radeon Pro W7000 16GB', { chip: 'Radeon Pro W7000', tdpW: 300 });
    expect(checkBuild({ cpu, gpu: unknown }).power).toBeDefined();
    const withPsu = sheet('gpu', 'Placa de Vídeo RTX 4060 8GB', { chip: 'RTX 4060', psuW: 650 });
    expect(checkBuild({ cpu, gpu: withPsu }).power!.recommended).toBeGreaterThanOrEqual(650);
  });
});
