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
});
