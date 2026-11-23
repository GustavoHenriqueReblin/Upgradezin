import { describe, expect, it } from 'vitest';
import { fieldColumn, formatSheetValue, isMainFor, missingMain, sheetFields, SHEET_FIELDS } from './fields.ts';
import { readSheet } from './read.ts';
import { readTitle } from './title.ts';
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
    // "Interface: PCIe" sem versão vale mais que um "Sata de 2,5 polegadas" solto na mesma ficha (como na S3, nov/2026).
    expect(readSheet('ssd', lines('Formato:', 'M2 2280', 'Interface:', 'PCIe', 'Forma:', 'Sata de 2,5 polegadas'))).toMatchObject({ formFactor: 'M.2 2280', interface: 'NVMe PCIe' });
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

  it('formatos achados nas fichas lidas pela rotina (nov/2026)', () => {
    // Placa-mãe: máximo de memória em vários jeitos, "PCIEX16 4.0", "2*SATA3", M.2 com letra, rede pelo chip, chipset só no modelo.
    expect(readSheet('motherboard', lines('Memória: 4 x slots memória DIMM, Max. 128GB, DDR5', 'Máx. capacidade de memória do sistema: 96 GB'))).toMatchObject({ ramSlots: 4, ramMaxGb: 128 });
    expect(readSheet('motherboard', 'Memória: 4 x DDR5 DIMM sockets supporting up to 192 GB').ramMaxGb).toBe(192);
    expect(readSheet('motherboard', 'Portas de extensão : 1x PCIEX16 4.0').pcieX16).toBe('4.0');
    expect(readSheet('motherboard', 'PCI_E1 Gen PCIe 4.0 suporta até x16 (da CPU)').pcieX16).toBe('4.0');
    expect(readSheet('motherboard', 'Armazenamento: 2*SATA3').sataPorts).toBe(2);
    expect(readSheet('motherboard', lines('Slot M.2_A (chave M): PCIe 5.0 x4', 'Slot M.2_B (chave M): PCIe 5.0 x4', 'Slot M.2_C (chave M): PCIe 4.0 x2')).m2Slots).toBe(3);
    expect(readSheet('motherboard', 'Rede: Placa de rede REALTEK 8125BG integrada').lan).toBe('2.5 Gb');
    expect(readSheet('motherboard', 'Modelo: PRO-A620AM-B-EVO')).toMatchObject({ chipset: 'A620', socket: 'AM5' });
    // Placa de vídeo da S1: rótulo sem dois-pontos, valor na frase, clock "do núcleo", medida em polegadas e cm.
    expect(readSheet('gpu', lines('- Memória de Vídeo 12GB GDDR6', '- Interface de Memória 192 bits', 'Clock do Núcleo: 2587 MHz (Reference Card: 2572 MHz)'))).toMatchObject({ vramGb: 12, busBits: 192, boostMhz: 2587 });
    expect(readSheet('gpu', lines('Clock Gráfico', '2655MHz Extreme Performance', '2640MHz Boost')).boostMhz).toBe(2640);
    expect(readSheet('gpu', 'Dimensões 7,87 "x 4,84" x 1,496 "Polegada 20 x 12,3 x 3,8 centímetros PSU recomendado 650W').lengthMm).toBe(200);
    expect(readSheet('gpu', 'Dimensões: Dimensão do cartão 35 x 14 x 6,7').lengthMm).toBe(350);
    expect(readSheet('gpu', 'Equipada com 2560 CUDA CORES, 8GB DE MEMÓRIA GDDR6 e interface PCI EXPRESS 5.0').vramGb).toBe(8);
    // Memória: capacidade sem rótulo, "Densidade", frequência sem unidade.
    expect(readSheet('ram', lines('- 32 GB (2 x 16 GB)', '- Velocidade: 6000'))).toMatchObject({ capacityGb: 32, modules: 2, mhz: 6000 });
    expect(readSheet('ram', 'Densidade: 4GB').capacityGb).toBe(4);
    // Fonte: conectores numa linha só, com vírgula; padrão solto no texto.
    expect(readSheet('psu', '- Conectores: 1x 20+4 Pinos ATX, 2x 4+4 Pinos CPU, 2x Sata com 4 portas, 1x Molex com 4 portas, 2x 6+2 Pinos PCIe')).toMatchObject({ eps: 2, sata: 8, pcie8: 2 });
    expect(readSheet('psu', 'Fonte Pcyes Atx 500w Real Electro V2').standard).toBe('ATX');
    // Gabinete: medidas separadas, folgas em cm e com decimal, "Liquidação" (tradução de clearance), frente de plástico, ventoinhas na frase.
    expect(readSheet('case', lines('Dimensões:Largura: 200 mm', 'Altura: 370 mm', 'Comprimento: 435 mm', 'Ventoinhas:Dimensões: 120 x 120 x 25 mm')).dimensions).toBe('370 x 200 x 435');
    expect(readSheet('case', lines('Dimensões', '- Profundidade: 420 mm', '- Largura: 225 mm', '- Altura: 485 mm')).dimensions).toBe('485 x 225 x 420');
    expect(readSheet('case', lines('- Max. Altura Cooler: 15,0 cm', '- Max. Comprimento Placas Gráficas: 31,5 cm'))).toMatchObject({ maxCoolerMm: 150, maxGpuMm: 315 });
    expect(readSheet('case', lines('Altura Máxima do Cooler de CPU: 163,5 mm', 'Liquidação:Cooler de CPU: 161 MM')).maxCoolerMm).toBe(164);
    expect(readSheet('case', lines('Liquidação:Cooler de CPU: 161 MM', 'GPU: 350 mm (sem ventoinhas frontais e radiador)'))).toMatchObject({ maxCoolerMm: 161, maxGpuMm: 350 });
    expect(readSheet('case', 'Painel frontal:Plástico').front).toBe('Fechada');
    expect(readSheet('case', lines('Painel frontal com USB Tipo-C', 'Painel frontal em malha de alto desempenho')).front).toBe('Mesh');
    expect(readSheet('case', 'Inclui 3 ventoinhas HP140 PWM pré-instaladas').fansIncluded).toBe(3);
    expect(readSheet('case', 'GABINETE COOLER MASTER ELITE 301 (COM 3 FANS ARGB)').fansIncluded).toBe(3);
  });

  it('gabinete e water cooler: mais formatos das fichas da rotina (nov/2026, 2ª leva)', () => {
    // Frente: não pelo material (o vidro é da lateral); a frase sobre a frente vale.
    expect(readSheet('case', 'Materiais:Aço, plástico, vidro temperado').front).toBeUndefined();
    expect(readSheet('case', lines('Materiais: Aço, ABS', 'O modelo conta com painel frontal em mesh')).front).toBe('Mesh');
    expect(readSheet('case', '• Estilo do Painel: Malha Mesh de alto fluxo de ar').front).toBe('Mesh');
    // Dimensões: sem a da caixa, com "(C)" antes do número, com "*", na seção, numa linha só, "Comprimento (Profundidade)".
    expect(readSheet('case', '- Dimensões (C x L x A): 478 x 230 x 493 mm (Gabinete) / 555 x 293 x 535 mm (Caixa)').dimensions).toBe('478 x 230 x 493');
    expect(readSheet('case', lines('Dimensões:', '- (C x L x A): - 400 x 200 x 455 mm')).dimensions).toBe('400 x 200 x 455');
    expect(readSheet('case', lines('- informações dimensões: cubo design', 'dimensão embalagen: 435*340*490 mm', 'dimensão gabinete: 415*280*377 mm')).dimensions).toBe('415 x 280 x 377');
    expect(readSheet('case', lines('• Dimensões Físicas (C x L x A):', '• Com saliências: 434 mm x 218 mm x 414 mm')).dimensions).toBe('434 x 218 x 414');
    expect(readSheet('case', 'case form factor mid tower dimensions (wxhxd) 220 x 460 x 375 (mm) 8.7 x 18.1 x 14.8 (in)').dimensions).toBe('220 x 460 x 375');
    expect(readSheet('case', lines('Dimensões Físicas', '• Altura: 485 mm', '• Comprimento (Profundidade): 510 mm', '• Largura: 255 mm')).dimensions).toBe('485 x 255 x 510');
    expect(readSheet('case', 'Dimensões: 120 x 120 x 25 mm').dimensions).toBeUndefined();
    // Cooler até, sem "CPU" no rótulo; não as ventoinhas chamadas de cooler.
    expect(readSheet('case', '- Tamanho máximo do cooler: 157 mm').maxCoolerMm).toBe(157);
    expect(readSheet('case', '- Suporte para cooler: até 157 mm').maxCoolerMm).toBe(157);
    expect(readSheet('case', 'tamanho do cooler traseiro: 80 mm').maxCoolerMm).toBeUndefined();
    // Ventoinhas inclusas: as posições nas linhas de baixo somam; o total no rótulo vale sozinho.
    expect(readSheet('case', lines('Ventoinhas inclusas:Frente: 2 x 120 mm', 'Traseira: 1 x 140 mm', 'Ventoinhas suportadas:Frente: 4 x 120 mm')).fansIncluded).toBe(3);
    expect(readSheet('case', lines('Ventoinhas inclusas:Traseira: 1 × 120 mm ARGB PWM', 'Montagem lateral: 3 × 120 mm ARGB PWM reversas')).fansIncluded).toBe(4);
    expect(readSheet('case', lines('• Ventoinhas Inclusas: 3x Fans ARGB PWM de 120 mm', '– Lateral: 2x 120 mm ARGB PWM', '– Traseira: 1x 120 mm')).fansIncluded).toBe(3);
    expect(readSheet('case', 'Ventoinhas inclusas:Frente: 120 mm PWM ARGB x3').fansIncluded).toBe(3);
    expect(readSheet('case', 'Ventoinhas incluídas:3 x 120 mm').fansIncluded).toBe(3);
    // Linhas "incluso" de cada posição somam (texto repetido não conta duas vezes); "(3x pré-instalados)" vale mais que o suportado.
    expect(readSheet('case', lines('- Cooler traseiro: 1 x 120mm (INCLUSO)', '- Cooler Superior: 2 x 120mm (Não incluído)', '- Coolers frontais: 3 x 120mm (Incluso)')).fansIncluded).toBe(4);
    const khali = lines('- painel frontal: 3x Fans 120mm (3x pré-instalados)', '- painel traseiro: 1x Fan 120mm (1x pré-instalado)');
    expect(readSheet('case', `${khali}\n${khali}`).fansIncluded).toBe(4);
    expect(readSheet('case', '- Frontal: 3 x 120 mm, 3 x 140 mm (inclusas 3 ventoinhas CT120 de 120 x 120 x 25 mm)').fansIncluded).toBe(3);
    // A mesma informação em lugares diferentes: vale a maior, não a soma.
    expect(readSheet('case', lines('• Sistema: 3x Ventoinhas CF120 ARGB de 120 mm pré-instaladas (Frontais)', 'ITENS INCLUSOS', '• 3x Ventoinhas CF120 ARGB de 120 mm (Pré-instaladas no painel frontal)')).fansIncluded).toBe(3);
    expect(readSheet('case', lines('Conteúdo da embalagem:Parafuso', 'Manual', 'Gabinete', '4 x Ventoinhas')).fansIncluded).toBe(4);
    expect(readSheet('case', lines('- fans: suporte para 6 fans (fans não inclusos)', 'acompanha cooler: nao')).fansIncluded).toBe(0);
    // Water cooler: medidas com "mm" no meio, "(C)" antes do número, largura antes do comprimento, sem a palavra radiador.
    expect(readSheet('cooler', lines('Bomba: 3200 RPM', 'Tamanho do radiador: 277.5mm x 119.2mm x 27mm')).radiatorMm).toBe(240);
    expect(readSheet('cooler', lines('Bloco de água: Dimensões: (C) 85 x (L) 84,1 x (A) 53,5 mm', 'Radiador: Dimensões: (C) 277 x (L) 119,6 x (A) 27 mm')).radiatorMm).toBe(240);
    expect(readSheet('cooler', lines('Dimensões do radiador:143 x 315 x 30 mm', 'Ventoinha:Dimensão: 140 x 140 x 26 mm')).radiatorMm).toBe(280);
    expect(readSheet('cooler', lines('Comprimento da tubulação: 450mm', 'Dimensões (mm): 396 mm x 120 mm x 27 mm', 'Material do radiador: Alumínio')).radiatorMm).toBe(360);
    expect(readSheet('cooler', lines('Dimensões do radiador, incl. ventilador (A x L x P), (mm): 397 x 140 x 52', 'Especificações do radiador:', 'Dimensões (A x L x P), (mm) : 397 x 120 x 27')).radiatorMm).toBe(360);
    expect(readSheet('cooler', lines('Bomba: 2800 RPM', 'Dimensões do Radiador: 120×120×27mm')).radiatorMm).toBe(120);
    expect(readSheet('cooler', lines('Material do radiador:Alumínio', 'Dimensões do radiador:Comprimento: 275 mm')).radiatorMm).toBe(240);
  });

  it('placa-mãe, processador, placa de vídeo e fonte: mais formatos das fichas (nov/2026, 3ª leva)', () => {
    const mb = (...l: string[]) => readSheet('motherboard', lines(...l));
    // Formato pelo rótulo "Configuração"/"PCB", no próprio rótulo ou numa linha só.
    expect(mb('Configuração: M-ATX').formFactor).toBe('Micro-ATX');
    expect(mb('Informações do PCB: mATX').formFactor).toBe('Micro-ATX');
    expect(mb('Fator de forma Micro ATX: 9,6 pol. x 7,9 pol., 24,4 cm x 20,1 cm').formFactor).toBe('Micro-ATX');
    expect(mb('Chipset: B650', 'M-ATX').formFactor).toBe('Micro-ATX');
    expect(mb('- 1 x Conector de alimentação ATX de 24 pinos').formFactor).toBeUndefined(); // o conector não é o formato
    // SATA.
    expect(mb('Armazenamento:SATA 6Gb/s: 4').sataPorts).toBe(4);
    expect(mb('Número de conectores SATA III: 4').sataPorts).toBe(4);
    expect(mb('Portas SATA:', '2 slots M.2 e 4 interfaces de disco rígido SATA 6Gb/s, com suporte a RAID').sataPorts).toBe(4);
    expect(mb('Interface: SATA: 6 Gb/s').sataPorts).toBeUndefined(); // a velocidade não é a quantidade
    // PCIe x16 com a versão depois.
    expect(mb('Slots de Expansão: 1x PCIEx x16 3.0').pcieX16).toBe('3.0');
    expect(mb('Slots de expansão: 1*PCIEx16(5.0x16)').pcieX16).toBe('5.0');
    expect(mb('Slots de expansão: 1 x PCIe x16 5.0, 1 x PCIe x1 3.0').pcieX16).toBe('5.0');
    expect(mb('- 2 x slots PCI Express x16 (PCIE1: Gen4x16 mode; PCIE3: Gen3 modo x4)').pcieX16).toBe('4.0');
    expect(mb('PCI_E1: PCIe 5.0 de primeira geração suporta até x16 (da CPU).').pcieX16).toBe('5.0');
    expect(mb('Slot de Expansão: 1x PCI Express x16 slot').pcieX16).toBeUndefined(); // sem a versão: não chuta
    // Slots de memória e máximo.
    expect(mb('Memória:', 'Possui 4 slots para memória DDR5, que suportam até 192 GB de memória')).toMatchObject({ ramSlots: 4, ramMaxGb: 192 });
    expect(mb('Memória:', 'São fornecidos quatro soquetes de memória DDR5, que podem suportar até 192 GB de memória').ramSlots).toBe(4);
    expect(mb('Memory Support: 4 DIMMs, Dual Channel DDR5-6800+MHz(OC)').ramSlots).toBe(4);
    expect(mb('Memória: DDR4', 'Slots DIMM: 2').ramSlots).toBe(2);
    expect(mb('Memória Máxima (GB): 64').ramMaxGb).toBe(64);
    expect(mb('Memória: DDR5', 'Frequências suportadas: 4.800 / 5.200 / 6.400 (OC) / 6.800 (OC) / OC+ MHz').ramMaxMhz).toBe(6800);
    // M.2.
    expect(mb('1 x Tomada Ultra M.2, suporta M Key type 2242/2260/2280 M.2 SATA3 6.0 Gb/s e módulo M.2 PCI Express até Gen3 x4 (32 Gb/s)')).toMatchObject({ m2Slots: 1, m2Pcie: '3.0' });
    expect(mb('SSD: 1x slot M.2 4.0 (suporta apenas SSD de canal 2242/2280 PCIE X4/X2)').m2Pcie).toBe('4.0');
    expect(mb('M.2: 1 slot M.2 PCIe 3.0').m2Pcie).toBe('3.0');
    expect(mb('1 slot M.2_WIFI (apenas placa de rede CNVI)').m2Slots).toBeUndefined(); // o M.2 da placa de rede não conta
    // Rede pelo chip ou pela velocidade.
    expect(mb('LAN: Intel I219V negociação automática de 10/100/1000 Mb/s').lan).toBe('1 Gb');
    expect(mb('Lan: Realtek GbE LAN (1000 Mbit / 100 Mbit)').lan).toBe('1 Gb');
    expect(mb('LAN: Intel I226-V').lan).toBe('2.5 Gb');

    const cpu = (...l: string[]) => readSheet('cpu', lines(...l));
    expect(cpu('Soquete:1700').socket).toBe('LGA1700');
    expect(cpu('Frequencia de Operação: 3.8 GHz', 'Frequencia Max Turbo: 4.8 GHz')).toMatchObject({ baseGhz: 3.8, boostGhz: 4.8 });
    expect(cpu('P-core Max Turbo Frequency (GHz)³: Up to 5.3', 'E-Core Max Turbo Frequency (GHz)³: Up to 4.6').boostGhz).toBe(5.3);
    expect(cpu('Clock Max Turbo: 4.6 GHz').boostGhz).toBe(4.6);
    expect(cpu('Frequência Core Turbo:Até 4.90 Ghz').boostGhz).toBe(4.9);
    expect(cpu('Esconderijo: Cache inteligente Intel de 20 MB', 'Total do cache L2: 22 MB')).toMatchObject({ l3Mb: 20, l2Mb: 22 });
    expect(cpu('Tamanho do Cache Inteligente Intel (L3) [MB]: 33 MB').l3Mb).toBe(33);
    expect(cpu('Voltagem / TDP: 125W').tdpW).toBe(125);
    expect(cpu('Processor Base Power(W): 125', 'Maximum Turbo Power (W): 159').tdpW).toBe(125);
    expect(cpu('Nome da GPU: Intel UHD Graphics 770').igpu).toBe('Intel UHD Graphics 770');
    expect(cpu('Especificações da GPU : Nome da GPU: Gráficos Intel').igpu).toBe('Intel Graphics');

    const gpu = (...l: string[]) => readSheet('gpu', lines(...l));
    expect(gpu('Thermal Solution: 3 Fan', 'Minimum Power Supply Requirement: 800 watt')).toMatchObject({ fans: 3, psuW: 800 });

    const psu = (...l: string[]) => readSheet('psu', lines(...l));
    expect(psu('CPU/EPS 4+4 pinos x 2: 650 mm*2', 'PCI-E 16 pinos x 2: 700 mm*2', 'PCI-E 16 pinos para PCI-E 8 pinos x 2: 700 mm*2', 'PCI-E 6+2 pinos x 8: 650 mm+150 mm*4', 'SATA x 16: 650 mm+150 mm*4')).toMatchObject({ eps: 2, pcie16: 2, pcie8: 8, sata: 16 });
    expect(psu('PCI-e 6+2 Pinos x4 = 2x (500+120mm)').pcie8).toBe(4);
    expect(psu('Conectores de CPU EPS 12V (4+4 pinos) - 2', 'Conectores PCIe (6+2 pinos) - 3', 'Conectores SATA de 5 pinos - 9')).toMatchObject({ eps: 2, pcie8: 3, sata: 9 });
    expect(psu('Cabos/conectores full modular: - ATX (20+4Pin) Malha de Nylon', '- CPU (4+4Pin) x2 peças', '- GPU (GEN 5.1/12V-2x6) 1pç', '- GPU (PCI-e/6+2Pin) 2 cabos 4 conectores', '- SATA 6pçs: 3 cabos 9 conectores')).toMatchObject({ modular: 'Total', eps: 2, pcie16: 1, pcie8: 4, sata: 9 });
    expect(psu('3 x SATA com 4 conectores').sata).toBe(12); // continua multiplicando
    expect(psu('6 x SATA (3 cabos com 3 conectores cada: 500mm + 150mm + 150mm)').sata).toBe(6); // o 6 já são os conectores
    expect(psu('Modular:Semi').modular).toBe('Semi');
    expect(psu('Certificação Cybernetics:Platinum').efficiency).toBe('Cybenetics Platinum');
    expect(psu('Cybenetics Efficiency:Gold', 'Eficiência 80PLUS:Gold').efficiency).toBe('80 Plus Gold'); // os dois: vale o 80 Plus
    expect(psu('Certificado Cybenetics: Cybenetics Gold', 'Classificação 80 Plus: 80 Plus Gold (até 90%)').efficiency).toBe('80 Plus Gold'); // antes: "80 Plus White"
    expect(psu('Eficiência 80 plus: 80 Plus Platinum').efficiency).toBe('80 Plus Platinum');
  });

  it('gabinete, cooler e fonte: mais formatos das fichas (nov/2026, 4ª leva)', () => {
    const kase = (...l: string[]) => readSheet('case', lines(...l));
    // Lista de formatos uma por linha: "Micro ATX" não vira título de seção.
    expect(kase('Compatibilidade de Placa-mãe:', 'Mini ITX', 'Micro ATX', 'ATX', 'Suporte para placas mãe com conectores traseiros: Sim').mbFormats).toBe('ATX,Micro-ATX,Mini-ITX');
    // Rótulo no plural, e não o "ATX" do tipo.
    expect(kase('- Tipo: Mid Tower ATX', '- Placas-mãe: ATX, Micro-ATX, Mini-ITX').mbFormats).toBe('ATX,Micro-ATX,Mini-ITX');
    // Formatos no rótulo; a fonte ATX do valor não conta.
    expect(kase('Placas-mãe Micro-ATX / ITX: Fonte de alimentação padrão ATX').mbFormats).toBe('Micro-ATX,Mini-ITX');
    // Um formato por linha com sim/não.
    expect(kase('Compatibilidade com placas-mãe mATX: Sim', 'Compatibilidade com placas-mãe ATX: Sim', 'Compatibilidade com placas-mãe EATX: Não').mbFormats).toBe('ATX,Micro-ATX');
    // Placa de vídeo no plural; não o cooler da mesma frase.
    expect(kase('- Suporta placas de vídeo de até 325 mm (sem radiador frontal) .').maxGpuMm).toBe(325);
    expect(kase('O gabinete suporta placas de vídeo de grande porte, coolers a ar de até 168mm e radiadores de 360mm.').maxGpuMm).toBeUndefined();
    // Radiador em texto corrido: não a GPU da mesma frase.
    expect(kase('Suporte a Radiador (Water Cooler):', 'Topo: 120 / 240 / 360 mm', 'Ele oferece suporte para fans e radiadores em diversas localizações. Na parte superior, há suporte para radiadores de até 360mm. A compatibilidade com um cooler de CPU de 175mm e uma GPU de 420mm permite componentes de alta performance.').radiators).toBe('120,240,360');

    const cooler = (...l: string[]) => readSheet('cooler', lines(...l));
    // Ruído com "dB" no rótulo, os valores na linha seguinte, ou sem dois-pontos.
    expect(cooler('Radiador: 240 mm', 'Nível de ruído db(A): 28').noiseDba).toBe(28);
    expect(cooler('Radiador: 240 mm', 'Nível de ruído (dB(A)) @ 25 % / 50% /100% rpm:', '17,3 / 29,4 / 36,9').noiseDba).toBe(36.9);
    expect(cooler('Radiador: 240 mm', 'Nível de ruído 36.9 dBA ± 10%').noiseDba).toBe(36.9);
    // Medidas do radiador no lugar do comprimento, com "*".
    expect(cooler('Bomba: 3000 RPM', 'Radiador: Comprimento: 397*120*27mm').radiatorMm).toBe(360);
    expect(cooler('Water Cooler', 'Dimensões do radiador: 277*120*27').radiatorMm).toBe(240);

    const psu = (...l: string[]) => readSheet('psu', lines(...l));
    // Rótulo com número e a contagem "4x" depois.
    expect(psu('Conector 24 Pinos: 1x 24 pinos', 'Conector 4+4 Pinos: 2x 4+4 pinos', 'Conector PCIe 6+2 Pinos: 4x 6+2 pinos', 'Conectores SATA: 9x')).toMatchObject({ eps: 2, pcie8: 4, sata: 9 });
    expect(psu('Conector Placa-mãe 24 Pinos: 1x', 'Conector CPU 4+4 Pinos: 1x', 'Conector PCIe 6+2 Pinos: 3x')).toMatchObject({ eps: 1, pcie8: 3 });
    expect(psu('1 x CPU8Pinos x 1', '1 x CPU8(4+4)Pinos x 1').eps).toBe(2);
    // "4 SATA: 3 cabos": 3 cabos de 4.
    expect(psu('4 SATA: 3 cabos (550 mm + 100 mm + 100 mm + 100 mm)', '2 SATA+2MOLEX: 1 cabo (550 mm + 100 mm)').sata).toBe(14);
  });

  it('marca e modelo; sem nada reconhecido, nada (nunca chuta)', () => {
    expect(readSheet('ssd', lines('MARCA: LEXAR', 'MODELO: NQ100 256GB', 'P/N: LNQ100X256G-RNNNG'))).toEqual({ brand: 'Lexar', model: 'LNQ100X256G-RNNNG' });
    expect(readSheet('cpu', 'Garantia: 12 meses')).toEqual({});
    expect(readSheet('gpu', '')).toEqual({});
  });
});

describe('campos pelo título do anúncio', () => {
  it('fonte, placa-mãe, memória, processador, placa de vídeo e SSD (títulos reais, nov/2026)', () => {
    expect(readTitle('psu', 'Fonte ASRock Phantom Gaming, 750W, 80 Plus Gold, Cybenetics Platinum, Full Modular, ATX 3.1, PCIe 5.1, Preto, PG-750G')).toMatchObject({
      watts: 750,
      efficiency: '80 Plus Gold',
      modular: 'Total',
      standard: 'ATX 3.1',
    });
    expect(readTitle('psu', 'Fonte MSI MAG A650BN, 650W, 80 Plus Bronze')).not.toHaveProperty('modular');
    expect(readTitle('motherboard', 'Placa Mãe ASRock H510M-HDV/M.2, Chipset H510, Intel LGA 1200, mATX, DDR4, 90-MXBFT0-A0BAY1Z')).toMatchObject({
      chipset: 'H510',
      socket: 'LGA1200',
      formFactor: 'Micro-ATX',
      ramType: 'DDR4',
    });
    expect(readTitle('ram', 'Memoria Patriot Viper Venom, 8GB (1x8GB), DDR5, 6000MHz, C40, Preto, PVV58G600C40')).toMatchObject({ capacityGb: 8, modules: 1, type: 'DDR5', mhz: 6000, cl: 40 });
    expect(readTitle('cpu', 'Processador Amd Ryzen 7 5800x3d Am4 4.5ghz 8 Cores 16 Threads 100mb S/ Cooler S/ Vídeo')).toMatchObject({
      socket: 'AM4',
      architecture: 'Zen 3',
      cores: 8,
      threads: 16,
      igpu: 'Não',
    });
    // Um GHz sozinho pode ser base ou turbo: só com o par.
    expect(readTitle('cpu', 'Processador Amd Ryzen 7 5800x3d Am4 4.5ghz 8 Cores')).not.toHaveProperty('baseGhz');
    expect(readTitle('cpu', 'Processador AMD Ryzen 7 5800X3D, 3.4GHz (4.5GHz Turbo), 8-Cores 16-Threads, AM4, Sem Cooler, Sem vídeo')).toMatchObject({ baseGhz: 3.4, boostGhz: 4.5, igpu: 'Não' });
    expect(readTitle('cpu', 'Processador Intel Core i5-12400F, 2.5GHz (4.4GHz Turbo), LGA1700')).toMatchObject({ architecture: 'Alder Lake', igpu: 'Não', socket: 'LGA1700' });
    expect(readTitle('cpu', 'Processador AMD Ryzen 5 8600G, AM5')).toMatchObject({ architecture: 'Zen 4', igpu: 'Sim' });
    // "Cache 30MB": L3 na Intel; na AMD ("Cache 100MB" do 5800X3D) é L2 + L3, fica de fora.
    expect(readTitle('cpu', 'Processador Intel Core Ultra 5 250K, 4.2GHz (5.3GHz Turbo), Cache 30MB, 18 Núcleos, 18 Threads, LGA 1851, Com Vídeo Integrado - BX80768250K')).toMatchObject({
      l3Mb: 30,
      baseGhz: 4.2,
      cores: 18,
      architecture: 'Arrow Lake',
    });
    expect(readTitle('cpu', 'Processador AMD Ryzen 7 5800X3D, 8-Core, 16-Threads, 3.4GHz (4.5GHz Turbo), Cache 100MB, AM4')).not.toHaveProperty('l3Mb');
    expect(readSheet('cpu', 'Intel Smart Cache LLC: 30MB\nTotal L2 Cache: 30MB')).toMatchObject({ l3Mb: 30, l2Mb: 30 });
    expect(readTitle('gpu', 'Placa de Video Palit GeForce RTX 5060 White OC, 8GB, GDDR7, 128-bit, NE75060U19P1-GB2063M')).toMatchObject({
      chip: 'RTX 5060',
      vramGb: 8,
      memType: 'GDDR7',
      busBits: 128,
      tdpW: 145,
    });
    expect(readTitle('ssd', 'SSD Apacer AS2280F4, 1TB, M.2 2280, PCIe 5.0 NVMe, Leitura 12000MBs e Gravação 11800MBs, AP1TBAS2280F4-1')).toMatchObject({
      capacityGb: 1000,
      formFactor: 'M.2 2280',
      interface: 'NVMe PCIe 5.0',
      readMbs: 12000,
      writeMbs: 11800,
    });
    expect(readTitle('ssd', 'SSD Kingston A400, 480GB, SATA, Leitura 500MB/s, 2,5 polegadas')).toMatchObject({ formFactor: '2,5"', interface: 'SATA' });
  });

  it('gabinete e cooler; placas-mãe só com o formato no título (não pela torre)', () => {
    expect(readTitle('case', 'Gabinete Gamer Mid Tower, Vidro Temperado, ATX, Sem Fans')).toMatchObject({ formFactor: 'Mid Tower', mbFormats: 'ATX,Micro-ATX,Mini-ITX', fansIncluded: 0 });
    expect(readTitle('case', 'Gabinete Gamer Mid-Tower Vidro Temperado')).not.toHaveProperty('mbFormats');
    expect(readTitle('case', 'Gabinete Gamer Mini Tower, M-ATX, 3 Fans')).toMatchObject({ formFactor: 'Mini Tower', mbFormats: 'Micro-ATX,Mini-ITX', fansIncluded: 3 });
    expect(readTitle('cooler', 'Water Cooler Rise Mode Frost 360mm, AM5/AM4/LGA1700, TDP 250W')).toMatchObject({ type: 'water', radiatorMm: 360, tdpW: 250 });
    // O "360W" do código é "360 White", não TDP.
    expect(readTitle('cooler', 'Water Cooler Round5 Boreah White, ARGB, 360mm, Intel-AMD, R5-WC-BOREAH-360W-2254')).not.toHaveProperty('tdpW');
  });

  it('ventoinhas inclusas com a posição atrás de um rótulo (leitor da ficha)', () => {
    const text = [
      'Refrigeração: Frontal: 120 mm x 3 ou 140 mm x 2 (Incluso 3x Frost Fan de 120mm)',
      'superior: 120 mm x 2 (não incluso)',
      'Traseira: 120 mm x 1 (Incluso 1x fan frost de 120 mm)',
    ].join('\n');
    expect(readSheet('case', text).fansIncluded).toBe(4);
  });
});
