import { describe, expect, it } from 'vitest';
import { fieldColumn, formatSheetValue, isMainFor, missingMain, sheetFields, SHEET_FIELDS } from './fields.ts';
import { readSheet } from './read.ts';
import { norm, numberWith, pick, sheetDoc, sheetText, thousands } from './text.ts';

/** Fichas no formato das lojas (texto como a página traz, nov/2026). */
const lines = (...l: string[]) => l.join('\n');

describe('texto da ficha', () => {
  it('HTML vira linhas legíveis: parágrafos, itens, quebras e entidades; sem marcas registradas', () => {
    expect(sheetText('<p>Marca: <b>AMD</b></p><ul><li>Soquete: AM5</li></ul>Núcleos:&nbsp;8<br>Gr&aacute;ficos&#58; Radeon&trade;')).toBe(
      lines('Marca: AMD', 'Soquete: AM5', 'Núcleos: 8', 'Gráficos: Radeon'),
    );
    expect(sheetText('<tr><th>Marca:</th><td>MSI</td></tr><script>var x = 1;</script>')).toBe('Marca: MSI');
  });

  it('ficha escrita numa linha só ("Núcleos: 4- Nº de threads: 4") e com marcadores • viram uma linha por item', () => {
    expect(sheetText('<p>- Número de núcleos: 4- Nº de threads: 4- TDP: 65 W</p>')).toBe(lines('- Número de núcleos: 4', '- Nº de threads: 4', '- TDP: 65 W'));
    expect(sheetText('<p>Marca: PIXO • Linha: Slim • Modelo: HTQ</p>')).toBe(lines('Marca: PIXO', '• Linha: Slim', '• Modelo: HTQ'));
    expect(sheetText('<p>Wi-Fi 6 e PCI-E x16</p>')).toBe('Wi-Fi 6 e PCI-E x16'); // hífen sem espaço não separa
  });

  it('pares rótulo: valor; valor na linha de baixo; continuação; título de seção; rótulo dentro do valor', () => {
    const doc = sheetDoc(lines('Memória:', '- Tamanho máximo: 64 GB', 'Modelo:', 'Ryzen 5', 'Velocidade: 2x1R DDR5-5600', '2x2R DDR5-5600', 'Chipset', 'AMD B650', 'Desempenho: Leitura (Máx.): 2400 MB/s', 'Fator de forma:', 'M-ATX'));
    expect(doc.pairs).toEqual([
      { label: 'tamanho maximo', value: '64 gb', section: 'memoria' },
      { label: 'modelo', value: 'ryzen 5', section: 'memoria' },
      { label: 'velocidade', value: '2x1r ddr5-5600 | 2x2r ddr5-5600', section: 'memoria' },
      { label: 'chipset', value: 'amd b650', section: 'memoria' },
      { label: 'desempenho', value: 'leitura (max.): 2400 mb/s', section: 'chipset' },
      { label: 'leitura (max.)', value: '2400 mb/s', section: 'desempenho' },
      { label: 'fator de forma', value: 'm-atx', section: 'chipset' },
    ]);
  });

  it('números: unidade, decimal com vírgula, milhar; o primeiro rótulo da lista é o preferido', () => {
    expect(norm('  Frequência  Máx. ')).toBe('frequencia max.');
    expect(numberWith('até 4,6 ghz', /ghz/)).toBe(4.6);
    expect(numberWith('até 14.900 mb/s', /mb/, { thousands: true })).toBe(14900);
    expect(thousands('7,000')).toBe(7000);
    const doc = sheetDoc(lines('Frequência: 3.8GHz', 'Frequência base: 3.6 GHz'));
    expect(pick(doc, [/^frequencia base/, /^frequencia$/], (v) => numberWith(v, /ghz/))).toBe(3.6);
  });
});

describe('campos por categoria', () => {
  it('coluna em snake_case; todo campo tem nome e tipo; principal condicional', () => {
    expect(fieldColumn('ramMaxGb')).toBe('ram_max_gb');
    expect(fieldColumn('power16Pin')).toBe('power16_pin');
    for (const fs of Object.values(SHEET_FIELDS)) for (const f of fs) expect(f.label && f.type).toBeTruthy();
    expect(sheetFields('cpu').slice(0, 2).map((f) => f.key)).toEqual(['brand', 'model']);
    const height = SHEET_FIELDS.cooler.find((f) => f.key === 'heightMm')!;
    expect(isMainFor(height, { type: 'ar' })).toBe(true);
    expect(isMainFor(height, { type: 'water' })).toBe(false);
    expect(missingMain('cooler', { type: 'water', radiatorMm: 360, tdpW: 250, noiseDba: 30, sockets: 'AM5' })).toEqual([]);
    expect(missingMain('cooler', { type: 'ar', tdpW: 250 })).toEqual(['heightMm', 'noiseDba', 'sockets']);
  });

  it('valor para mostrar com a unidade', () => {
    const f = (c: 'cpu' | 'ram' | 'gpu' | 'cooler', k: string) => SHEET_FIELDS[c].find((x) => x.key === k)!;
    expect(formatSheetValue(f('cpu', 'baseGhz'), 3.4)).toBe('3,4 GHz');
    expect(formatSheetValue(f('ram', 'cl'), 16)).toBe('CL16');
    expect(formatSheetValue(f('gpu', 'power16Pin'), false)).toBe('não');
    expect(formatSheetValue(f('cooler', 'sockets'), 'AM4,AM5')).toBe('AM4, AM5');
    expect(formatSheetValue(f('cpu', 'socket'), undefined)).toBe('');
  });
});

describe('leitor da ficha', () => {
  it('processador (tabela da S2)', () => {
    const t = lines('Marca: AMD', 'Modelo: 100-100000651POF', 'Soquete: AM4', 'Arquitetura: Zen 3', 'Núcleos: 8', 'Threads: 16', 'Frequência base: 3.4 GHz', 'Frequência Max Turbo: Até 4.5 GHz', 'Cache L2: 4 MB', 'Cache L3: 96 MB', 'Tipo de memória do sistema: DDR4', 'TDP Padrão: 105W');
    expect(readSheet('cpu', t)).toEqual({ brand: 'AMD', model: '100-100000651POF', socket: 'AM4', architecture: 'Zen 3', cores: 8, threads: 16, baseGhz: 3.4, boostGhz: 4.5, l2Mb: 4, l3Mb: 96, tdpW: 105, ramType: 'DDR4' });
  });

  it('processador Intel (núcleos P + E, frequência do performance-core, Smart Cache, sem vídeo)', () => {
    const t = lines('Socket: LGA 1700', 'Gráfico Integrado: Não possui', 'Frequência base (Performance-core): 2.1GHz (4.9GHz Turbo)', 'Intel Smart Cache: 25MB', 'Cores: 12 (8P+4E)', 'Threads: 20', 'Velocidade de memória: DDR5: 4800MHz', 'DDR4: 3200MHz', 'TDP: 125W');
    expect(readSheet('cpu', t)).toMatchObject({ socket: 'LGA1700', igpu: 'Não', baseGhz: 2.1, boostGhz: 4.9, l3Mb: 25, cores: 12, threads: 20, ramType: 'DDR4, DDR5', tdpW: 125 });
    expect(readSheet('cpu', lines('- Número de núcleos: 24', '- Frequência base do Performance-core: 3.2 GHz', '- Frequência base do Efficient-core: 2.4 GHz', '- Frequência turbo max: 6 GHz', '- Gráficos do processador: Gráficos UHD Intel 770'))).toMatchObject({
      cores: 24,
      baseGhz: 3.2,
      boostGhz: 6,
      igpu: 'UHD Graphics 770',
    });
  });

  it('placa-mãe (tabela da S2, com o valor em várias linhas)', () => {
    const t = lines(
      'Marca: Asus',
      'Modelo: PRIME-A520M-R',
      'CPU: Soquete AMD AM4 para processadores de desktop AMD Ryzen',
      'Chipset: AMD A520',
      'Memória: 2x slots DIMM, máx. 64 GB, DDR4 5100(OC)/ 4866(OC)/ 3200/ 2133, memória sem buffer',
      'Slots de expansão: 1x slot PCIe 3.0 x16 (compatível com modo x16);',
      '1x slot PCIe 3.0 x1',
      'Armazenamento: Suporta 1x slot M.2 e 4 portas SATA 6Gb/s',
      'Slot M.2 (Key M), tipo 2242/2260/2280 (suporta modos PCIe 3.0 x4 e SATA)',
      'Ethernet: 1 x Ethernet Realtek de 1 Gb',
      'Dimensões: M-ATX, 23,6 cm x 19,3 cm',
    );
    expect(readSheet('motherboard', t)).toEqual({
      brand: 'Asus',
      model: 'PRIME-A520M-R',
      chipset: 'A520',
      socket: 'AM4',
      formFactor: 'Micro-ATX',
      ramType: 'DDR4',
      ramSlots: 2,
      ramMaxGb: 64,
      ramMaxMhz: 5100,
      pcieX16: '3.0',
      m2Slots: 1,
      m2Pcie: '3.0',
      sataPorts: 4,
      lan: '1 Gb',
    });
  });

  it('placa-mãe: soquete pelo chipset quando a ficha não diz; LGA1718 é o AM5; Wi-Fi e Bluetooth', () => {
    expect(readSheet('motherboard', lines('Chipset: AMD B550', 'CPU: Suporta Ryzen 5000')).socket).toBe('AM4');
    expect(readSheet('motherboard', lines('Chipset: Intel B760')).socket).toBe('LGA1700');
    expect(readSheet('motherboard', lines('Soquete: LGA1718')).socket).toBe('AM5');
    expect(readSheet('motherboard', lines('Sem fio e Bluetooth: Wi-Fi 6 (802.11 ax)', 'Bluetooth v5.3'))).toMatchObject({ wifi: 'Wi-Fi 6', bluetooth: '5.3' });
  });

  it('placa de vídeo (vários formatos de medida e de clock)', () => {
    const t = lines('GPU: GeForce RTX 3060', 'Memória de vídeo: 12GB', 'Tipo de Memória: GDDR6', 'Interface de memória: 192-bit', 'Clock: Boost: 1777 MHz', 'PCI express: 4.0 16x', 'Conector: 1 x 8 pinos', 'Dimensões: 224,1 x 116,3 x 39,2 mm');
    expect(readSheet('gpu', t)).toMatchObject({ chip: 'RTX 3060', vramGb: 12, memType: 'GDDR6', busBits: 192, boostMhz: 1777, pcie: '4.0 x16', power16Pin: false, lengthMm: 224 });
    expect(readSheet('gpu', lines('Core Clock: Base：2295Mhz；Boost:2617Mhz', 'TDP: 380W', 'Fonte de alimentação recomendada: 850W', 'Conector de alimentação: 16pin', 'Product Size : 300.5*120*50mm'))).toMatchObject({
      baseMhz: 2295,
      boostMhz: 2617,
      tdpW: 380,
      psuW: 850,
      power16Pin: true,
      lengthMm: 301,
    });
    expect(readSheet('gpu', 'Dimensões: 30,5 x 12,6 x 6,1 cm').lengthMm).toBe(305);
    expect(readSheet('gpu', 'Card size: L=281 W=118 H=40 mm').lengthMm).toBe(281);
    expect(readSheet('gpu', '- OC mode : 1852 MHz (Boost Clock)').boostMhz).toBe(1852);
    // "Consumo de energia: 600W" é a fonte recomendada, não o consumo da placa.
    expect(readSheet('gpu', 'Consumo de energia: 600W')).toEqual({ psuW: 600 });
    expect(readSheet('gpu', 'Interface: PCI Express Gen 5 x16 (uses x8)').pcie).toBe('5.0 x8');
  });

  it('memória: kit (2 x 8 GB), tipo pelo PC4/PC5, latência em vários jeitos', () => {
    expect(readSheet('ram', lines('Capacidade: 16GB (2 x 8GB)', 'Frequência: 3600 MHz', 'Tipo de memória: DDR4', 'Latência: 16-20-20-38'))).toEqual({ capacityGb: 16, modules: 2, type: 'DDR4', mhz: 3600, cl: 16 });
    expect(readSheet('ram', lines('Capacidade: 16GB', 'Frequência: 5600MHz', 'Padrão: PC5-44800', 'Latência: CL46'))).toEqual({ capacityGb: 16, modules: 1, type: 'DDR5', mhz: 5600, cl: 46 });
    expect(readSheet('ram', lines('Quantidade de Memória: 16GB (2x8GB)', 'Velocidade: 3600Mhz CL17-21-21')).cl).toBe(17);
  });

  it('SSD: capacidade em TB, formato, interface, leitura e escrita (juntas ou separadas)', () => {
    expect(readSheet('ssd', lines('Fator de forma: M.2 2280', 'Interface: PCIe 4.0x4 NVMe', 'Capacidade: 2 TB', 'Leitura/escrita sequencial: 6.000/5.000 MB/s'))).toEqual({
      capacityGb: 2000,
      formFactor: 'M.2 2280',
      interface: 'NVMe PCIe 4.0',
      readMbs: 6000,
      writeMbs: 5000,
    });
    expect(readSheet('ssd', lines('Capacidade: 1 TB', 'Formato: 2.5"', 'Interface: SATA III 6.0Gb/s', 'Velocidade Sequencial de Leitura: Até 540 MB/s', 'Velocidade Sequencial de Escrita: Até 500 MB/s'))).toEqual({
      capacityGb: 1000,
      formFactor: '2,5"',
      interface: 'SATA',
      readMbs: 540,
      writeMbs: 500,
    });
    expect(readSheet('ssd', 'Especificações: Capacidade: 2TB').capacityGb).toBe(2000); // rótulo dentro do valor
  });

  it('fonte: potência, eficiência, modular, padrão e conectores (cabos com vários conectores, total)', () => {
    const t = lines(
      'Potência Nominal Total: 1050 Watts',
      'Padrão / Fator de Forma: ATX 3.1',
      'Certificações de Eficiência: 80 Plus Gold e Cybenetics Platinum',
      'Cabos: 100% Modular',
      '01 x Conector ATX 20+4 Pinos (Placa-mãe)',
      '02 x Conectores EPS 4+4 Pinos (Processador / CPU)',
      '01 x Conector PCIe 5.1 12V-2x6 / 12VHPWR (16 Pinos Nativo)',
      '03 x Cabos PCIe 6+2 Pinos (Com 2 conectores cada - Total: 6 conectores)',
      '03 x Cabos SATA (Com 4 conectores cada - Total: 12 conectores)',
    );
    expect(readSheet('psu', t)).toEqual({ watts: 1050, efficiency: '80 Plus Gold', modular: 'Total', standard: 'ATX 3.1', eps: 2, pcie8: 6, pcie16: 1, sata: 12 });
    const be = lines('Potência: 1000W', 'Tipo: ATX12V V3.1', 'Certificações: 80 PLUS Gold', 'Placa-mãe ATX ( 20+4 pinos ): 1', 'P4 +4 (CPU): 1', 'Cabos 12V-2x6: 1', 'PCI-e 6+2 pinos ( GPU ): 4', 'SATA: 6');
    expect(readSheet('psu', be)).toMatchObject({ standard: 'ATX 3.1', eps: 1, pcie16: 1, pcie8: 4, sata: 6 });
    expect(readSheet('psu', lines('Modular: Não', 'Formato: SFX'))).toEqual({ modular: 'Não', standard: 'SFX' });
    expect(readSheet('psu', 'Compatível: Atx 12v Ver.2.3').standard).toBe('ATX 2.3');
    expect(readSheet('psu', lines('2x PCIe (6+2 pinos) + PCIe (6+2 pinos) (600mm)', '3x SATA + SATA + SATA')).pcie8).toBe(4);
  });

  it('gabinete: formato, placas, folgas, dimensões, frente, ventoinhas e radiadores', () => {
    const t = lines(
      'Formato: Mid-Tower',
      'Placa mãe Suportada: Mini ITX / Micro ATX / ATX',
      'Ventoinhas suportadas: Superior: 2 x 120 mm',
      'Water cooler suportado: Superior: 240mm / 120mm',
      'Lado direito: 360mm / 240mm',
      'Comprimento máximo da VGA: 350 mm',
      'Altura máxima do cooler da CPU: 160 mm',
      'Painel frontal: Mesh',
      'Ventoinhas inclusas: 3 x 120 mm ARGB',
      'Dimensões: 226 x 535 x 560 mm',
    );
    expect(readSheet('case', t)).toEqual({
      formFactor: 'Mid Tower',
      mbFormats: 'ATX,Micro-ATX,Mini-ITX',
      maxGpuMm: 350,
      maxCoolerMm: 160,
      dimensions: '226 x 535 x 560',
      front: 'Mesh',
      fansIncluded: 3,
      fansMax: 2,
      radiators: '120,240,360',
    });
    expect(readSheet('case', lines('Ventoinhas inclusas: Não possui', 'Compatibilidade com Water Cooler - Topo (mm): 240'))).toMatchObject({ fansIncluded: 0, radiators: '240' });
    // Ventoinha traseira não é a altura do cooler.
    expect(readSheet('case', 'tamanho do cooler traseiro : 120 mm').maxCoolerMm).toBeUndefined();
  });

  it('cooler de ar: altura (marcada, pela ordem, ou a maior medida), TDP, ruído e soquetes', () => {
    const t = lines('Soquete: Intel: LGA1200/1151/1150/1155', 'AMD: AM4', 'Dimensões do dissipador: 131 x 76 x 155 mm', 'Dimensões da ventoinha: 120 x 120 x 25 mm', 'Ruído de operação: 25 dB(A)', 'TDP: 150W');
    expect(readSheet('cooler', t)).toEqual({ type: 'ar', heightMm: 155, tdpW: 150, noiseDba: 25, sockets: 'LGA1200,LGA1151,LGA1150,LGA1155,AM4' });
    expect(readSheet('cooler', 'Dimensões do Dissipador: 130 mm (L) x 92 mm (P) x 151 mm (A)').heightMm).toBe(151);
    expect(readSheet('cooler', lines('Dissipador de alumínio', 'Dimensões: 124 x 124 x 68 mm')).heightMm).toBe(68); // cooler baixo
  });

  it('water cooler: radiador pelo tamanho ou pelas medidas; não tem altura de cooler', () => {
    const t = lines('Radiador:', '- Dimensões do radiador: 402 x 120 x 27 mm', 'Bomba: Ruído: 20 dBA', 'Soquete Intel: LGA 1700/1851', 'Soquete AMD: AM5 / AM4');
    expect(readSheet('cooler', t)).toEqual({ type: 'water', radiatorMm: 360, noiseDba: 20, sockets: 'LGA1700,LGA1851,AM5,AM4' });
    expect(readSheet('cooler', lines('Radiador de 240mm em alumínio', 'Dimensões: 277 x 120 x 52 mm')).radiatorMm).toBe(240);
    expect(readSheet('cooler', lines('Radiador: Material: Alumínio', 'Dimensões: 317 (C) x 138 (L) x 38 (A) mm')).radiatorMm).toBe(280);
  });

  it('marca e modelo; sem nada reconhecido, nada (nunca chuta)', () => {
    expect(readSheet('ssd', lines('MARCA: LEXAR', 'MODELO: NQ100 256GB', 'P/N: LNQ100X256G-RNNNG'))).toEqual({ brand: 'Lexar', model: 'LNQ100X256G-RNNNG' });
    expect(readSheet('cpu', 'Garantia: 12 meses')).toEqual({});
    expect(readSheet('gpu', '')).toEqual({});
  });
});
