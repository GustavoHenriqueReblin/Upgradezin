import { describe, expect, it } from 'vitest';
import { extractMotherboardSpecs, isMotherboard, motherboardModelKey } from './motherboard.ts';

describe('extractMotherboardSpecs', () => {
  it.each([
    ['Placa-Mãe MSI B550 Gaming WiFi6E, AMD AM4, ATX, DDR4, Wi-Fi 6E, Bluetooth 5.3', { chipset: 'B550', socket: 'AM4', formFactor: 'atx', memory: 'ddr4', wifi: true }],
    ['Placa Mae Husky B550M K, DDR4, Socket AMD AM4, M-ATX, Chipset AMD B550, B550M-K-1P', { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' }],
    ['Placa Mãe Gigabyte B550M AORUS Elite AX, Chipset B550, AMD AM4, mATX, DDR4', { chipset: 'B550', formFactor: 'matx', wifi: true }],
    ['Placa Mãe Msi B550m-a Pro Am4 2xDDR4 Chipset Amd B550 Matx', { chipset: 'B550', socket: 'AM4', formFactor: 'matx', memory: 'ddr4' }],
    ['Placa-Mãe Colorful Battle-AX B550M-D PRO GAMING FROZEN V14, Chipset B550, AMD AM4, mAXT, DDR4', { chipset: 'B550', formFactor: 'matx' }],
    ['Placa Mãe ASUS ROG Strix X870E-E Gaming WiFi, AMD AM5, ATX, DDR5', { chipset: 'X870E', socket: 'AM5', formFactor: 'atx', memory: 'ddr5', wifi: true }],
    ['Placa Mãe Gigabyte B760M DS3H, Intel LGA 1700, mATX, DDR4', { chipset: 'B760', socket: 'LGA1700', memory: 'ddr4' }],
    ['Placa Mãe ASRock B650I Lightning WiFi, AM5', { chipset: 'B650', formFactor: 'mini-itx', memory: 'ddr5' }],
  ])('%s', (title, expected) => {
    expect(extractMotherboardSpecs(title)).toMatchObject(expected);
  });

  it('não confunde formato com chipset nem marca Wi-Fi à toa', () => {
    const s = extractMotherboardSpecs('Placa Mãe Asus Prime B550M-A, DDR4, Socket AM4');
    expect(s.wifi).toBeUndefined();
    expect(s.formFactor).toBe('matx');
  });
});

describe('isMotherboard', () => {
  it('aceita placa-mãe avulsa', () => expect(isMotherboard('Placa-Mãe MSI B550 Gaming Plus, AM4')).toBe(true));
  it.each([
    'Kit Upgrade, AMD Ryzen 5 5600 + Placa Mãe B550',
    'Placa Mãe B550 + Processador Ryzen 5 5600',
    'Processador AMD Ryzen 5 5600',
  ])('rejeita %s', (t) => expect(isMotherboard(t)).toBe(false));
});

describe('motherboardModelKey', () => {
  it('títulos de lojas diferentes caem na mesma chave', () => {
    const storeA = motherboardModelKey('Placa Mãe MSI B550M-A PRO, Chipset B550, AMD AM4, mATX, DDR4', 'MSI');
    const storeB = motherboardModelKey('Placa Mae Msi B550m-a Pro Am4 2xDDR4 Chipset Amd B550 Matx', 'MSI');
    expect(storeA).toBe('msi b550m a pro');
    expect(storeB).toBe(storeA);
  });
  it('mantém variantes com Wi-Fi separadas', () => {
    const ax = motherboardModelKey('Placa Mãe Gigabyte B550M AORUS Elite AX, Chipset B550', 'Gigabyte');
    const plainKey = motherboardModelKey('Placa Mãe Gigabyte B550M AORUS Elite, Chipset B550', 'Gigabyte');
    expect(ax).not.toBe(plainKey);
  });
  it('mantém "gaming" quando é parte do nome', () => {
    expect(motherboardModelKey('Placa Mae MSI B550 GAMING PLUS, DDR4, Socket AM4', 'MSI')).toBe('msi b550 gaming plus');
  });
});

describe('placa-mãe: conexão e aparência', () => {
  it('Wi-Fi implica Bluetooth (módulo combo); Bluetooth também vale sozinho', () => {
    expect(extractMotherboardSpecs('Placa-Mãe MSI B550 Gaming WiFi6E, AMD AM4, ATX, DDR4')).toMatchObject({ wifi: true, bluetooth: true });
    expect(extractMotherboardSpecs('Placa Mãe Asus Prime B550M-A, Bluetooth 5.2, DDR4')).toMatchObject({ bluetooth: true });
    expect(extractMotherboardSpecs('Placa Mãe Asus Prime B550M-A, DDR4, Socket AM4')).not.toHaveProperty('bluetooth');
  });
  it('branca e RGB', () => {
    expect(extractMotherboardSpecs('Placa Mãe Gigabyte B650M Aorus Elite AX Ice, ARGB, Branca')).toMatchObject({ white: true, rgb: true });
  });
  it('versão branca não se mistura com a preta', () => {
    const white = motherboardModelKey('Placa Mae MSI B760M Gaming Plus WiFi, Branca, DDR5', 'MSI');
    const black = motherboardModelKey('Placa Mae MSI B760M Gaming Plus WiFi, Preta, DDR5', 'MSI');
    expect(white).toBe(`${black} white`);
  });
});

describe('plataformas Intel anteriores', () => {
  it.each([
    ['Placa Mãe Gigabyte H510M H, Chipset H510, Intel LGA 1200, mATX, DDR4', { chipset: 'H510', socket: 'LGA1200', formFactor: 'matx', memory: 'ddr4' }],
    ['Placa Mae Asus Prime B560M-A, Socket LGA1200, Micro ATX', { chipset: 'B560', socket: 'LGA1200', memory: 'ddr4' }],
    ['Placa Mãe MSI B365M Pro-VH, Intel LGA 1151, mATX, DDR4', { chipset: 'B365', socket: 'LGA1151', memory: 'ddr4' }],
    ['Placa Mae Gigabyte Z390 Aorus Elite, ATX', { chipset: 'Z390', socket: 'LGA1151', memory: 'ddr4' }],
  ])('%s', (title, expected) => {
    expect(extractMotherboardSpecs(title)).toMatchObject(expected);
  });

  it('LGA1700 não deduz memória (tem placa DDR4 e DDR5)', () => {
    expect(extractMotherboardSpecs('Placa Mãe Gigabyte B760M DS3H, Intel LGA 1700, mATX')).not.toHaveProperty('memory');
  });

  it('sufixo D4/D5 do modelo indica a memória', () => {
    expect(extractMotherboardSpecs('Placa Mãe ASUS Prime B760M-A D4, Intel LGA 1700, mATX').memory).toBe('ddr4');
    expect(extractMotherboardSpecs('Placa Mae ASRock B760M-HDV/M.2 D5, LGA 1700').memory).toBe('ddr5');
    expect(extractMotherboardSpecs('Placa Mae B550 Clanm Amd Socket Am4  Ddr-4').memory).toBe('ddr4');
  });

  it('chipset com sufixo CM da ASRock', () => {
    expect(extractMotherboardSpecs('Placa Mãe ASRock H310CM-HDV, Intel LGA 1151, DDR4')).toMatchObject({ chipset: 'H310', socket: 'LGA1151' });
  });

  it('slots de memória: do título ou 2 na Mini-ITX', () => {
    expect(extractMotherboardSpecs('Placa Mãe PCyes B550 Am4 4xDDR4 (máx128GB) 4xusb3.2').memorySlots).toBe(4);
    expect(extractMotherboardSpecs('Placa Mae Msi B550m-a Pro Am4 2xDDR4 Chipset Amd B550 Matx').memorySlots).toBe(2);
    expect(extractMotherboardSpecs('Placa Mãe ASRock B650I Lightning WiFi, AM5').memorySlots).toBe(2);
    expect(extractMotherboardSpecs('Placa Mãe MSI B650 Gaming Plus WiFi, AM5, ATX')).not.toHaveProperty('memorySlots');
  });

  it('descarta placas sem plataforma identificada ou de workstation', () => {
    expect(isMotherboard('Placa Mae Gigabyte W790 AI TOP, DDR5, LGA4677, E-ATX, Chipset Intel W790')).toBe(false);
    expect(isMotherboard('Placa Mãe Genérica Gamer, DDR4, ATX')).toBe(false);
  });

  it('descarta placas DDR3 (fora do escopo)', () => {
    expect(isMotherboard('Placa Mae TGT H61-T, DDR3, LGA 1155, M-ATX, Chipset Intel H61')).toBe(false);
  });
});

describe('chipset A620A (variante da A620)', () => {
  it('"A620AM-K" e "Chipset A620A" contam como A620, no AM5', () => {
    for (const t of [
      'Placa Mãe Asus Prime A620AM-K, Chipset A620A, AMD AM5, MATX, DDR5, 90MB1GX0-M0EAY0',
      'Placa Mãe ASUS TUF GAMING A620AM-PLUS, AMD AM5 , m-ATX, DDR5 - 90MB1N30-M0EAY0',
      'Placa-Mãe ASRock A620AM Pro RS, Ryzen AM5 A620A, Micro ATX , DDR5 - 90-MXBSV0-A0UAYZ',
    ])
      expect(extractMotherboardSpecs(t)).toMatchObject({ chipset: 'A620', socket: 'AM5' });
  });
});
