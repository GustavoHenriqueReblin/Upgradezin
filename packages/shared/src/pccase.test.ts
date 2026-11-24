import { describe, expect, it } from 'vitest';
import { caseFits, caseModelKey, extractCaseSpecs, isCase } from './pccase.ts';

describe('Gabinete', () => {
  it('reconhece gabinete e descarta tela de monitoramento e kit', () => {
    expect(isCase('Gabinete Gamer Corsair 4000D RS ARGB, Mid Tower, Lateral em Vidro, com 3x Fans RS ARGB, Preto - CC-9011296-WW')).toBe(true);
    expect(isCase('Tela de Monitoramento Gamer Smart Screen Support Rise Mode, 9.2" IPS, USB-C, Branco - RM-SCP-W')).toBe(false);
    expect(isCase('Gabinete Gamer + Fonte 500W + Placa-Mãe H610')).toBe(false);
  });

  it('maior placa que cabe (formato citado ou, sem ele, a torre), vidro e fans', () => {
    expect(extractCaseSpecs('Gabinete Gamer SQUAD QG200, Mini tower, Micro ATX e Mini ITX, Frontal e lateral em vidro, USB 3.0, Sem FANS - SGN200')).toEqual({
      caseTower: 'mini',
      caseFormFactor: 'matx',
      caseGlass: true,
      caseFans: 0,
    });
    expect(extractCaseSpecs('Gabinete Gamer Corsair 4000D RS ARGB, Mid Tower, Lateral em Vidro, com 3x Fans RS ARGB, Preto')).toEqual({
      caseTower: 'mid',
      caseFormFactor: 'atx',
      caseGlass: true,
      caseFans: 3,
    });
    expect(extractCaseSpecs('Gabinete Gamer Liketec Pinos E-ATX, Painel Frontal com Detalhes em Madeira, Preto').caseFormFactor).toBe('eatx');
    expect(extractCaseSpecs('Gabinete Gamer Redragon Wideload Lite, Mid Tower, ATX e M-ATX, Lateral e Frontal em Vidro Temperado').caseFormFactor).toBe('atx');
    expect(extractCaseSpecs('Gabinete Gamer Husky Dome 10, Micro-ATX, Lateral e Frontal em Vidro, Sem Fans, Preto').caseFormFactor).toBe('matx');
    expect(extractCaseSpecs('Gabinete Gamer Liketec Cygnus Dark, ATX,  8 Fans ARGB e Display LCD, Vidro Temperado').caseFans).toBe(8);
    expect(extractCaseSpecs('Gabinete Gamer Rise Mode X5 Glass, RGB, Lateral em Vidro Fumê, Sem FANs, Preto').caseFormFactor).toBeUndefined();
  });

  it('ventoinhas inclusas que as lojas chamam de "cooler" no título; o que o gabinete suporta não conta', () => {
    const fans = (t: string) => extractCaseSpecs(t).caseFans;
    expect(fans('Gabinete Gamer Fortrek Cruiser, Lateral Em Acrílico, Com 3 Coolers RGB, Branco - 80257')).toBe(3);
    expect(fans('Gabinete Gamer Bluecase Bg-052w Soul Pro - Lateral E Frontal Em Vidro - Usb 3.0 - 3 Cooler')).toBe(3);
    expect(fans('Gabinete Gamer, Evus, Ev-g15, Lateral Em Vidro Temperado, 3 Coolers Rgb Inclusos')).toBe(3);
    expect(fans('Gabinete Gamer XYZ, Mid Tower, Suporta 6 Coolers, Preto')).toBeUndefined();
    expect(fans('Gabinete Gamer XYZ, Mid Tower, Suporte para até 9 Fans')).toBeUndefined();
    expect(fans('Gabinete Gamer XYZ, Sem Fans, Preto')).toBe(0);
  });

  it('a placa cabe no gabinete?', () => {
    expect(caseFits('atx', 'matx')).toBe(true);
    expect(caseFits('matx', 'atx')).toBe(false);
    expect(caseFits('eatx', 'atx')).toBe(true);
    expect(caseFits(undefined, 'atx')).toBeUndefined();
  });

  it('o mesmo gabinete em outra cor é outro produto', () => {
    const black = caseModelKey('Gabinete Gamer Husky Dome 100, Mid Tower, ATX, Lateral e Frontal em Vidro, Sem FANs, Preto - HGN100PT', 'Husky');
    expect(caseModelKey('Gabinete Gamer Husky Dome 100, Mid Tower, ATX, Lateral e Frontal em Vidro, Sem FANs, Branco - HGN100BR', 'Husky')).not.toBe(black);
  });
});
