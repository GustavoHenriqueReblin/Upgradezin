import { describe, expect, it } from 'vitest';
import { NOT_INFORMED, productPath, sheetRows } from './product.ts';
import { sheetFields } from './sheet/fields.ts';

describe('página do produto', () => {
  it('ficha: todos os campos da categoria, na ordem, com unidade; sem valor, "não informado"', () => {
    const rows = sheetRows('ram', { brand: 'Kingston', capacityGb: 16, mhz: 3200, cl: 16 });
    expect(rows.map((r) => r.key)).toEqual(sheetFields('ram').map((f) => f.key));
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Marca', 'Kingston'],
      ['Modelo', NOT_INFORMED],
      ['Capacidade', '16 GB'],
      ['Módulos', NOT_INFORMED],
      ['Tipo', NOT_INFORMED],
      ['Frequência', '3.200 MHz'],
      ['Latência', 'CL16'],
      ['XMP', 'não informado'],
      ['EXPO', 'não informado'],
    ]);
    expect(rows.filter((r) => r.informed).length).toBe(4);
    expect(sheetRows('gpu', { power16Pin: false }).find((r) => r.key === 'power16Pin')).toMatchObject({ value: 'não tem', informed: true });
  });

  it('endereço com a chave codificada', () => {
    expect(productPath('ssd:SDSSDA3N2T00G26')).toBe('/produto/ssd%3ASDSSDA3N2T00G26');
    expect(productPath('id:42')).toBe('/produto/id%3A42');
  });
});
