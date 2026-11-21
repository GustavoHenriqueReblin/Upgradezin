import { describe, expect, it } from 'vitest';
import { cpuModelKey, extractCpuSpecs, isCpu, parseCpuModel } from './cpu.ts';

describe('parseCpuModel', () => {
  it.each([
    ['Processador AMD Ryzen 7 5800X3D, 3.4GHz, 8 Núcleos, AM4', { brand: 'amd', line: 'Ryzen 7', model: '5800X3D', gen: 'Ryzen 5000', socket: 'AM4' }],
    ['Processador AMD Ryzen 5 8400F, 6-Core, 12-Threads, AM5', { brand: 'amd', line: 'Ryzen 5', model: '8400F', gen: 'Ryzen 8000', socket: 'AM5' }],
    ['Processador Intel Core i5-12400F, 2.5GHz, LGA 1700', { brand: 'intel', line: 'Core i5', model: '12400F', gen: '12ª Geração', socket: 'LGA1700' }],
    ['Processador Intel Core i5 12400F, 12ª Geração', { line: 'Core i5', model: '12400F' }],
    ['Processador Intel Core Ultra 7 265K, 20-Core, LGA1851', { line: 'Core Ultra 7', model: '265K', gen: 'Core Ultra Série 2', socket: 'LGA1851' }],
    ['Processador Intel Core i7 7700 3.6ghz Oem', { line: 'Core i7', model: '7700', gen: '7ª Geração', socket: 'LGA1151' }],
    ['Processador Intel Core i5 10400F, LGA 1200', { gen: '10ª Geração', socket: 'LGA1200' }],
    ['Processador AMD Athlon 3000G, 3.5GHz, AM4', { brand: 'amd', line: 'Athlon', model: '3000G', socket: 'AM4' }],
  ])('%s', (title, expected) => {
    expect(parseCpuModel(title)).toMatchObject(expected);
  });
});

describe('isCpu', () => {
  it('aceita processador de desktop DDR4/DDR5', () => {
    expect(isCpu('Processador AMD Ryzen 7 5700X, 3.4GHz, 8 Núcleos, 16 Threads, AM4, Sem Vídeo Integrado - 100-100000926WOF')).toBe(true);
  });
  it.each([
    'Processador Intel I5 2400, 3.1GHz (3.4GHz Turbo), Cache 6MB, LGA 1155, OEM',
    'Processador Intel Core i7-4790 3.40ghz 8mb Oem LGA  1150',
    'Processador AMD Ryzen Threadripper 9970X, 32-Core, 64-Threads, sTR5',
    'Adaptador Socket Para Processador Amd Am5, Contact Frame',
    'Kit Upgrade Processador Ryzen 5 5600 + Placa Mãe B550',
  ])('rejeita %s', (t) => expect(isCpu(t)).toBe(false));
});

describe('extractCpuSpecs', () => {
  it('núcleos, threads e vídeo integrado escritos no título', () => {
    expect(extractCpuSpecs('Processador Intel Core i5-14600KF, 3.5GHz, Cache 24MB, 14 Núcleos, 20 Threads, LGA 1700, Sem Vídeo Integrado')).toMatchObject({
      cores: 14,
      threads: 20,
      igpu: false,
      unlocked: true,
      socket: 'LGA1700',
    });
  });
  it('formatos de núcleos: "8-Cores", "Octa Core"', () => {
    expect(extractCpuSpecs('Processador AMD Ryzen 7 9700X, 8-Cores 16-Threads, AM5').cores).toBe(8);
    expect(extractCpuSpecs('Processador AMD Ryzen 7 5700G, Cache 20MB, Octa Core, AM4').cores).toBe(8);
  });
  it('número grudado no socket não vira núcleo ("Sk1151 Core i7")', () => {
    expect(extractCpuSpecs('Processador Intel Sk1151 Core i7 7700 3.6ghz Oem Sem Cooler').cores).toBeUndefined();
  });
  it('vídeo integrado pelo sufixo quando o título não diz', () => {
    expect(extractCpuSpecs('Processador Intel Core i5-12400F').igpu).toBe(false);
    expect(extractCpuSpecs('Processador Intel Core i5-12400').igpu).toBe(true);
    expect(extractCpuSpecs('Processador AMD Ryzen 5 5600G').igpu).toBe(true);
    expect(extractCpuSpecs('Processador AMD Ryzen 5 5600').igpu).toBe(false); // AM4 sem G
    expect(extractCpuSpecs('Processador AMD Ryzen 5 7600').igpu).toBe(true); // AM5 tem vídeo básico
    expect(extractCpuSpecs('Processador AMD Ryzen 5 7500F').igpu).toBe(false);
  });
  it('cooler: só quando o anúncio diz (ou part number "WOF" = sem fan)', () => {
    expect(extractCpuSpecs('Processador AMD Ryzen 5 5500, 6-Cores, Cooler Wraith Stealth, AM4').cooler).toBe(true);
    expect(extractCpuSpecs('Processador AMD Ryzen 7 5700X, AM4 - 100-100000926WOF').cooler).toBe(false);
    expect(extractCpuSpecs('Processador Intel Core i5 12400, LGA 1700, Com Cooler').cooler).toBe(true);
    expect(extractCpuSpecs('Processador Intel Core i5-12400, LGA 1700').cooler).toBeUndefined();
  });
  it('desbloqueado: Intel K, todo Ryzen', () => {
    expect(extractCpuSpecs('Processador Intel Core i7-14700K').unlocked).toBe(true);
    expect(extractCpuSpecs('Processador Intel Core i5-12400F').unlocked).toBe(false);
    expect(extractCpuSpecs('Processador AMD Ryzen 5 5600').unlocked).toBe(true);
  });
});

describe('cpuModelKey', () => {
  it('mesma chave nos três jeitos de escrever', () => {
    const a = cpuModelKey('Processador AMD Ryzen 7 5700X, 3.4GHz (4.6GHz Max Turbo), Cache 36MB, 8 Núcleos, AM4 - 100-100000926WOF');
    const b = cpuModelKey('Processador AMD Ryzen 7 5700X, 8-Core, 16-Threads, 3.4GHz (4.6GHz Turbo), Cache 36MB, AM4, 100-100000926WOF');
    const c = cpuModelKey('Processador AMD Ryzen 7 5700X 3.4GHz (4.6GHz Turbo), 8-Cores 16-Threads, AM4, Sem Cooler, 100-100000926WOF');
    expect(a).toBe('amd ryzen 7 5700x');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it('tray/OEM fica separado da versão em caixa', () => {
    expect(cpuModelKey('Processador Intel Core i5-12400F Tray')).toBe('intel core i5 12400f tray');
  });
});

describe('só plataformas DDR4/DDR5', () => {
  it.each([
    ['Processador Intel Pentium G4560, 3.5GHz, Cache 3MB', 'LGA1151'],
    ['Processador Intel Celeron G5905, 3.5GHz', 'LGA1200'],
    ['Processador Intel Pentium Gold G6405, 4.1GHz', 'LGA1200'],
    ['Processador Intel Pentium Gold G7400, 3.7GHz', 'LGA1700'],
  ])('Pentium/Celeron pela família: %s → %s', (title, socket) => {
    expect(isCpu(title)).toBe(true);
    expect(extractCpuSpecs(title).socket).toBe(socket);
  });

  it.each([
    'Processador Intel Pentium G3260, 3.3GHz, Cache 3MB', // Haswell, DDR3
    'Processador Intel Pentium Dual Core G2020, 2.9GHz', // Ivy Bridge, DDR3
    'Processador Intel Celeron J4125 Quad Core', // de notebook/embarcado
    'Processador AMD Ryzen 5 6600H, 6 Núcleos', // série 6000 é de notebook
    'Processador Intel Core i5 650, 3.2GHz', // 1ª geração, DDR3
  ])('fora: %s', (title) => expect(isCpu(title)).toBe(false));
});
