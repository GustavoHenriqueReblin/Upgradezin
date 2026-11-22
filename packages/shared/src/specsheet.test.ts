import { describe, expect, it } from 'vitest';
import caseSheet from '../fixtures/sheets/case.html?raw';
import coolerSheet from '../fixtures/sheets/cooler.html?raw';
import gpuSheet from '../fixtures/sheets/gpu.html?raw';
import { parseSpecSheet } from './specsheet.ts';

/** Fichas técnicas reais (o HTML do campo da ficha, sem nada da loja). Ver fixtures/sheets/README.md. */
const SHEETS: Record<string, string> = { gpu: gpuSheet, case: caseSheet, cooler: coolerSheet };
const sheet = (name: string) => SHEETS[name]!;

describe('ficha técnica da página do produto', () => {
  it('placa de vídeo: comprimento é o maior lado de "Dimensões" (medida na linha seguinte) e o part number', () => {
    // "Conector de força: 1 x 8-pinos": sem 12V-2x6.
    expect(parseSpecSheet('gpu', sheet('gpu'))).toEqual({ specs: { gpuLength: 269, gpu16Pin: false }, mpn: '90-GA41ZZ-00UANF' });
  });
  it('gabinete: placa de vídeo e cooler máximos e radiadores (não confunde com ventoinhas)', () => {
    expect(parseSpecSheet('case', sheet('case')).specs).toEqual({ caseMaxGpu: 420, caseMaxCooler: 180, caseRadiators: [280, 360] });
  });
  it('cooler sem altura do dissipador: fica sem (a medida do fan não vale)', () => {
    expect(parseSpecSheet('cooler', sheet('cooler'))).toEqual({ specs: {}, mpn: 'RR-S4NA-17PA-R1' });
  });
  it('formas comuns de escrever', () => {
    expect(parseSpecSheet('cooler', '<p>- Dimensões (C x L x A): 120 x 73 x 155 mm</p>').specs.coolerHeight).toBe(155);
    expect(parseSpecSheet('cooler', '<p>Altura: 158 mm</p><p>Ventilador: 120 x 120 x 25 mm</p>').specs.coolerHeight).toBe(158);
    expect(parseSpecSheet('gpu', '<p>Dimensões: 30,5 x 12,6 x 6,1 cm</p><p>Conector: 1x 16 pinos (12V-2x6)</p>').specs).toEqual({ gpuLength: 305, gpu16Pin: true });
    expect(parseSpecSheet('case', '<p>Suporte para placa de vídeo: até 360 mm</p><p>Altura máxima do cooler: 165 mm</p>').specs).toEqual({ caseMaxGpu: 360, caseMaxCooler: 165 });
  });
  it('cooler com cada medida marcada pela letra: "104 (C) x 126 (L) x 159 (A) mm"', () => {
    expect(parseSpecSheet('cooler', '<p>Dimensões: 104 (C) x 126 (L) x 159 (A) mm</p>').specs.coolerHeight).toBe(159);
  });
  it('radiadores numa lista com barra: "radiador de 120/140/240/280/360 mm"', () => {
    const html = '<p>Refrigeração líquida:</p><p>Superior: radiador de 120/140/240/280/360 mm (opcional)</p><p>Traseira: radiador de 120 mm</p>';
    expect(parseSpecSheet('case', html).specs.caseRadiators).toEqual([120, 140, 240, 280, 360]);
  });

  it('placa de vídeo: "Tamanho do cartão: C=215 L=122 A=40 mm" (Gigabyte)', () => {
    expect(parseSpecSheet('gpu', '<p>Tamanho do cartão: C=215 L=122 A=40 mm</p><p>Conectores de energia: 8 pinos*1</p>').specs).toEqual({ gpuLength: 215, gpu16Pin: false });
  });

  it('gabinete: radiadores em lista abaixo do título ("- 240 mm", "- 2 x 140 mm" = 280)', () => {
    const html = '<p>Suporte do radiador (superior):</p><p>- 120 mm</p><p>- 2 x 140 mm</p><p>- 2 x 160 mm</p><p>Altura máxima do cooler da CPU:</p><p>- 360 mm</p>';
    expect(parseSpecSheet('case', html).specs.caseRadiators).toEqual([120, 280]); // 2 x 160 não é radiador comum; a seção acaba no próximo título
  });

  it('placa de vídeo: "15,5x11,5cm" (cm colado) e peso na mesma frase não viram comprimento', () => {
    // Como num anúncio real (nov/2026): antes saía 430 mm (o peso em gramas).
    const prose = '<p>Essa placa oferece dimensões de 15,5x11,5cm (CxL), pesando apenas 430g. Com 4GB GDDR5 e 128 bits.</p>';
    expect(parseSpecSheet('gpu', prose).specs.gpuLength).toBe(155);
    expect(parseSpecSheet('gpu', '<p>Dimensões:</p><p>• 15,5x11,5cm (CxL)</p>').specs.gpuLength).toBe(155);
    expect(parseSpecSheet('gpu', '<p>Dimensões: 26,9 cm x 13 cm</p>').specs.gpuLength).toBe(269);
  });

  it('placa de vídeo: "Board size" em inglês (não o "Box size" da caixa), cm sem unidade e tamanho do cartão em texto corrido', () => {
    // Como em anúncios reais (nov/2026).
    expect(parseSpecSheet('gpu', '<p>Box size: 426.5 x 213.5 x 103.5 mm</p><p>Board size: 331.9 x 127.1 x 60 mm</p>').specs.gpuLength).toBe(332);
    expect(parseSpecSheet('gpu', '<p>Dimensões: Dimensão do cartão 35 x 14 x 6,7</p>').specs.gpuLength).toBe(350);
    expect(parseSpecSheet('gpu', '<p>Dimensões: 26,9 x 13 x 4</p>').specs.gpuLength).toBe(269);
    const prose = '<p>Dois ventiladores de lâmina exclusivos de 90 mm, 3 tubos de calor e tamanho de cartão compacto de 200 mm</p>';
    expect(parseSpecSheet('gpu', prose).specs.gpuLength).toBe(200);
    expect(parseSpecSheet('gpu', '<p>Ventilador de 90 mm</p>').specs.gpuLength).toBeUndefined(); // só o ventilador: nada
  });

  it('placa de vídeo: "centímetros" por extenso, "Tamanho:" sozinho e L/W/H ("W =" é largura, não watts)', () => {
    // Como em anúncios reais (nov/2026).
    expect(parseSpecSheet('gpu', '<p>Dimensões: 17.4 x 12.1 x 3.9 centímetros</p>').specs.gpuLength).toBe(174);
    expect(parseSpecSheet('gpu', '<p>Tamanho: L = 152 W = 114 H = 36 mm</p>').specs.gpuLength).toBe(152);
    expect(parseSpecSheet('gpu', '<p>Tamanho: 233x120x44mm</p>').specs.gpuLength).toBe(233);
    expect(parseSpecSheet('gpu', '<p>Tamanho da memória: 8 GB</p><p>Consumo: 170 W</p>').specs.gpuLength).toBeUndefined();
  });
});
