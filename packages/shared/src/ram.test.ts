import { describe, expect, it } from 'vitest';
import { extractRamSpecs, isRam, ramModelKey } from './ram.ts';

describe('isRam', () => {
  it('aceita memória de PC DDR4/DDR5', () => {
    expect(isRam('Memória RAM Kingston Fury Beast, 16GB, 3200MHz, DDR4, CL16, Preto - KF432C16BB/16')).toBe(true);
  });
  it.each([
    'Memória RAM para Notebook Husky, 8GB, 3200MHz, DDR4, CL19',
    'Memória Ram Para Notebook Kingston Fury Impact, 16GB, 3200Mhz, DDR4, CL20, Sodimm',
    'Memória PCYes 8GB, DDR3, 1600MHz, UDIMM',
    'Memória Kingston Server Premier 32GB DDR5 4800MHz ECC Registered',
  ])('rejeita %s', (t) => expect(isRam(t)).toBe(false));
});

describe('extractRamSpecs', () => {
  it('avulsa', () => {
    expect(extractRamSpecs('Memória RAM Kingston Fury Beast, 16GB, 3200MHz, DDR4, CL16, Preto')).toEqual({
      memory: 'ddr4',
      ramCapacity: 16,
      ramModules: 1,
      ramSpeed: 3200,
      ramLatency: 16,
    });
  });
  it('kit: capacidade total e pentes', () => {
    expect(extractRamSpecs('Memória RAM Kingston Fury Beast, RGB, 32GB (2x16GB), 5600MHz, DDR5, CL36, Branco')).toMatchObject({
      memory: 'ddr5',
      ramCapacity: 32,
      ramModules: 2,
      ramSpeed: 5600,
      ramLatency: 36,
    });
    expect(extractRamSpecs('Memória Corsair Vengeance Kit 2x8GB DDR4 3200MHz')).toMatchObject({ ramCapacity: 16, ramModules: 2 });
  });
  it('MT/s e "3200 Mhz"', () => {
    expect(extractRamSpecs('Memoria RAM Kingston Fury Beast, 16GB, 3200MT/s, DDR4').ramSpeed).toBe(3200);
    expect(extractRamSpecs('Memória XPG Spectrix D35G, 8GB, RGB, DDR4, 3200 Mhz, CL16').ramSpeed).toBe(3200);
  });
});

describe('ramModelKey', () => {
  it('mesma memória escrita de jeitos diferentes', () => {
    const a = ramModelKey('Memória RAM Kingston Fury Beast, 16GB, 3200MHz, DDR4, CL16, Preto - KF432C16BB/16', 'Kingston');
    const b = ramModelKey('Memoria Kingston Fury Beast 16GB DDR4 3200MHz Preta KF432C16BB/16', 'Kingston');
    expect(a).toBe('kingston beast fury 16gb 1x ddr4 3200');
    expect(b).toBe(a);
  });
  it('RGB, branca e kit são produtos diferentes', () => {
    const plain = ramModelKey('Memória RAM Kingston Fury Beast, 32GB (2x16GB), 5600MHz, DDR5', 'Kingston');
    const rgbWhite = ramModelKey('Memória RAM Kingston Fury Beast, RGB, 32GB (2x16GB), 5600MHz, DDR5, Branco', 'Kingston');
    const single = ramModelKey('Memória RAM Kingston Fury Beast, 32GB, 5600MHz, DDR5', 'Kingston');
    expect(rgbWhite).toBe(`${plain} rgb white`);
    expect(single).not.toBe(plain);
  });
});

describe('frequências altas', () => {
  it('lê kits DDR5 acima de 8000 MHz', () => {
    expect(extractRamSpecs('Memória RAM G.Skill Trident Z5 RGB, 32GB (2x16GB), 9000MHz, DDR5, CL42').ramSpeed).toBe(9000);
    expect(extractRamSpecs('Memória Corsair Dominator Titanium 48GB (2x24GB) DDR5 8800MT/s CL42').ramSpeed).toBe(8800);
  });
});
