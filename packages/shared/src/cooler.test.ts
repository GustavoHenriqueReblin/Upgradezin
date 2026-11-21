import { describe, expect, it } from 'vitest';
import { coolerFits } from './compat.ts';
import { coolerModelKey, extractCoolerSpecs, isCooler } from './cooler.ts';

describe('Cooler', () => {
  it('reconhece cooler de processador e descarta ventoinha, kit, tela e notebook', () => {
    expect(isCooler('Air Cooler Para Processador Deepcool Ag400 G2 ARGB, 120mm, Intel-amd, Preto, R-ag400-bkammg2-g')).toBe(true);
    expect(isCooler('Cooler C3tech Para Processador Intel 115x/1200/1366 Gaming Fc-20bk')).toBe(true);
    expect(isCooler('Water Cooler MSI MAG Coreliquid A13, ARGB, 360mm, Intel e AMD, Preto - MAG CORELIQUID A13 360')).toBe(true);
    expect(isCooler('Ventoinha, Cooler Fan, Para Processador Intel, AMD, LED, RGB, Silencioso 120mm')).toBe(false);
    expect(isCooler('Placa Mãe MSI A520M-A PRO + Processador AMD Ryzen 5 5500F + Air Cooler MACH1 ARTIC')).toBe(false);
    expect(isCooler('Tela de Monitoramento Gamer Rise Mode Para Water cooler, Vision Screen, 2.1" IPS')).toBe(false);
    expect(isCooler('Cooler para Notebook Base com 4 Fans')).toBe(false);
    expect(isCooler('Cooler Fan para Gabinete 120mm ARGB')).toBe(false);
  });

  it('tipo, radiador, fabricantes, encaixes e TDP', () => {
    expect(extractCoolerSpecs('Water Cooler MSI MAG Coreliquid A13, ARGB, 360mm, Intel e AMD, Preto')).toEqual({ coolerType: 'water', radiator: 360, coolerBrands: ['intel', 'amd'] });
    expect(extractCoolerSpecs('Air Cooler Para Processador Deepcool Ag400 G2 ARGB, 120mm, Intel-amd, Preto')).toEqual({ coolerType: 'air', coolerBrands: ['intel', 'amd'] });
    expect(extractCoolerSpecs('Cooler Para Processador Cooler Master Standard I30, Intel, LGA 1156/1155/1151/1150 - RH-I30-26FK-R1')).toEqual({
      coolerType: 'air',
      coolerBrands: ['intel'],
      coolerSockets: ['LGA115X'],
    });
    expect(extractCoolerSpecs('Air Cooler Para Processador 115X 1200 1700 Am5 Am4 Rgb Caf104 Brx').coolerSockets).toEqual(['AM5', 'AM4', 'LGA1700', 'LGA1200', 'LGA115X']);
    expect(extractCoolerSpecs('Cooler Para Processador Redragon TYR, LED Azul, Intel e AMD, 120mm, PWM, FAN, 4 Heat Pipes, TDP 130W - CC-9104B').coolerTdp).toBe(130);
    expect(extractCoolerSpecs('Cooler Para Processador Cooler Master A30, AMD, 80mm').coolerBrands).toEqual(['amd']);
  });

  it('serve no encaixe? (AM5 usa a fixação do AM4; LGA1851 a do LGA1700)', () => {
    const intelAmd = extractCoolerSpecs('Air Cooler Para Processador Deepcool Ag400, 120mm, Intel-amd');
    expect(coolerFits(intelAmd, 'AM5')).toBe('ok');
    expect(coolerFits(intelAmd, 'LGA1700')).toBe('ok');
    const old = extractCoolerSpecs('Cooler Para Processador Cooler Master Standard I30, Intel, LGA 1156/1155/1151/1150');
    expect(coolerFits(old, 'LGA1700')).toBe('no');
    expect(coolerFits(old, 'LGA1200')).toBe('ok');
    expect(coolerFits(old, 'AM4')).toBe('no');
    expect(coolerFits(extractCoolerSpecs('Cooler Processador Amd Am4'), 'AM5')).toBe('ok');
    expect(coolerFits(extractCoolerSpecs('Cooler Para Processador Intel LGA 1700 12ª 13ª 14ª Geração'), 'LGA1851')).toBe('ok');
    expect(coolerFits(extractCoolerSpecs('Cooler Para Processador Gamemax Gamma 200, RGB'), 'AM4')).toBeUndefined();
  });

  it('chave de modelo separa cor e radiador', () => {
    const black = coolerModelKey('Water Cooler Husky Freezy, Iluminação ARGB, 240mm, AMD e Intel, Preto - HWT200PT', 'Husky');
    expect(coolerModelKey('Water Cooler Husky Freezy, ARGB, 240mm, AMD e Intel, Branco - HWT200BR', 'Husky')).not.toBe(black);
    expect(coolerModelKey('Water Cooler Husky Freezy, Iluminação ARGB, 360mm, AMD e Intel, Preto - HWT300PT', 'Husky')).not.toBe(black);
  });
});
