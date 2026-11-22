import { describe, expect, it } from 'vitest';
import { gpuSignature, identifyProducts, productMpn, textHasCode, type IdentityItem } from './identity.ts';
import type { Specs, StoreId } from './types.ts';

/** Anúncio para os testes (títulos e códigos como nos reais, nov/2026). */
const item = (id: string, store: StoreId, title: string, p: { mpn?: string; url?: string; specs?: Specs; modelKey?: string; ean?: string } = {}): IdentityItem => ({
  id,
  store,
  title,
  url: p.url ?? `https://${store}.example/produto/${id}`,
  mpn: p.mpn,
  ean: p.ean,
  modelKey: p.modelKey ?? `k-${id}`,
  specs: p.specs ?? {},
});

/** Ids que ficaram com a mesma chave, em grupos ordenados. */
const together = (m: Map<string, string>) => {
  const g = new Map<string, string[]>();
  for (const [id, k] of m) g.set(k, [...(g.get(k) ?? []), id]);
  return [...g.values()].map((ids) => ids.sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));
};

describe('part number comparável', () => {
  it('normaliza e tira o "NAC" que uma loja põe no fim', () => {
    expect(productMpn('TUF-RTX5090-O32G-GAMING-NAC')).toBe('TUFRTX5090O32GGAMING');
    expect(productMpn('dual-rtx5060-8g')).toBe('DUALRTX50608G');
    expect(productMpn('AB1')).toBeUndefined(); // curto
  });

  it('código no texto: em palavras inteiras, sem marca de outra versão logo depois', () => {
    const w = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    expect(textHasCode(w('placa-de-video-asrock-rx-6400-90-ga3czz-00uanf'), '90GA3CZZ00UANF')).toBe(true);
    expect(textHasCode(w('Asus Dual RTX 3060 DUAL-RTX3060-O12G-V2'), 'DUALRTX3060O12G')).toBe(true); // revisão: mesmo produto
    expect(textHasCode(w('Placa Mãe Gigabyte B860M AORUS ELITE WIFI6E'), 'B860MAORUSELITE')).toBe(false); // outra versão
    expect(textHasCode(w('XB860MAORUSELITE'), 'B860MAORUSELITE')).toBe(false); // no meio da palavra
  });
});

describe('assinatura de placa de vídeo', () => {
  const sig = (title: string, specs: Specs = { gpuModel: 'RTX 5060', vram: 8 }) => gpuSignature({ title, specs });
  it('marca + chip + memória + linha (com o número logo depois) + OC + branca', () => {
    expect(sig('Placa de Vídeo Palit RTX 5060 Infinity 2 OC 8GB')).toBe('palit|rtx 5060|8|infinity2|oc|');
    expect(sig('Placa de Vídeo Palit RTX 5060 Infinity 3 OC 8GB')).toBe('palit|rtx 5060|8|infinity3|oc|');
    expect(sig('Placa de Vídeo MSI RTX 5060 Ventus 2X OC White 8GB')).toBe('msi|rtx 5060|8|2x+ventus|oc|white');
  });
  it('sem marca conhecida, sem linha ou sem chip: nenhuma', () => {
    expect(sig('Placa de Vídeo Kinology RX 580 Dual 8GB')).toBeUndefined();
    expect(sig('Placa de Vídeo Asus RTX 5060 8GB')).toBeUndefined();
    expect(sig('Placa de Vídeo Asus Dual', {})).toBeUndefined();
  });
});

describe('mesmo produto em lojas diferentes', () => {
  const gpu = { gpuModel: 'RTX 5070 Ti', vram: 16 };

  it('mesmo part number (o "NAC" de uma loja não atrapalha) vira um produto', () => {
    const r = identifyProducts([
      item('a', 's2', 'Placa de Video Asus GeForce RTX 5090 TUF Gaming OC', { mpn: 'TUF-RTX5090-O32G-GAMING-NAC' }),
      item('b', 's3', 'Placa de Vídeo Asus TUF Gaming NVIDIA GeForce RTX 5090 OC', { mpn: 'TUF-RTX5090-O32G-GAMING' }),
      item('c', 's1', 'Placa de Vídeo Zotac RTX 5090 Solid', { mpn: 'ZT-B50900J-10P' }),
    ]);
    expect(together(r.exact)).toEqual([['a', 'b'], ['c']]);
    expect(r.exact.get('a')).toBe('TUFRTX5090O32GGAMING'); // chave: o part number
  });

  it('código interno numa loja e nome comercial no título dela: acha o código da outra loja no título ou no endereço', () => {
    const r = identifyProducts([
      item('s1x', 's1', 'Placa de Vídeo ASUS TUF RTX 5070 Ti O16G GAMING NVIDIA', { mpn: '90YV0MD0-M0NA00', specs: gpu, url: 'https://s1.example/produto/1/placa-de-video-asus-tuf-rtx5070ti-o16g-gaming' }),
      item('s3x', 's3', 'Placa de Vídeo Asus TUF Gaming RTX 5070 Ti OC, 16GB, TUF-RTX5070TI-O16G-GAMING', { mpn: 'TUF-RTX5070TI-O16G-GAMING', specs: gpu }),
    ]);
    expect(together(r.exact)).toEqual([['s1x', 's3x']]);
  });

  it('branca e preta com o mesmo código no começo ficam separadas', () => {
    const r = identifyProducts([
      item('p', 's1', 'Memória Corsair Vengeance 32GB Preta', { mpn: 'CMK32GX4M2E3200C16' }),
      item('w', 's3', 'Memória Corsair Vengeance 32GB Branca, CMK32GX4M2E3200C16W', { mpn: 'CMK32GX4M2E3200C16W' }),
    ]);
    expect(together(r.group)).toEqual([['p'], ['w']]);
  });

  it('mesmo código na mesma loja para produtos diferentes (título cortado): código ambíguo, não junta', () => {
    const r = identifyProducts([
      item('i5', 's1', 'Processador Intel Core i5-14600KF', { mpn: 'BX8071514', specs: { cpuModel: '14600KF' } }),
      item('i7', 's1', 'Processador Intel Core i7-14700KF', { mpn: 'BX8071514', specs: { cpuModel: '14700KF' } }),
      item('x', 's2', 'Processador Intel Core i7-14700KF', { mpn: 'BX8071514', specs: { cpuModel: '14700KF' } }),
    ]);
    expect(new Set([r.exact.get('i5'), r.exact.get('i7')]).size).toBe(2); // chaves únicas mesmo com o mesmo código
    expect(r.exact.get('i5')).not.toBe(r.exact.get('x'));
  });

  it('specs contraditórias (DDR4 × DDR5) não juntam nem pela chave do título', () => {
    const r = identifyProducts([
      item('d5', 's1', 'Placa-Mãe Gigabyte B760M DS3H DDR5', { modelKey: 'gigabyte b760m ds3h', specs: { memory: 'ddr5' } }),
      item('d4', 's3', 'Placa Mãe Gigabyte B760M DS3H DDR4', { modelKey: 'gigabyte b760m ds3h', specs: { memory: 'ddr4' } }),
    ]);
    expect(together(r.group)).toEqual([['d4'], ['d5']]);
  });

  it('grupo: a mesma placa sem código numa loja junta pela assinatura; outra linha ou outra quantidade de ventoinhas, não', () => {
    const r = identifyProducts([
      item('s2', 's2', 'Placa de Video ASRock Intel ARC B570 Challenger OC, 10GB, 90-GA5KZZ-00UANF', { mpn: '90-GA5KZZ-00UANF', specs: { gpuModel: 'Arc B570', vram: 10 } }),
      item('s3', 's3', 'Placa De Vídeo ASRock Intel Arc B570 Challenger OC, 10GB, GDDR6', { specs: { gpuModel: 'Arc B570', vram: 10 } }),
      item('i2', 's1', 'Placa de Video Palit RTX 5060 8GB Infinity 2 OC', { modelKey: 'palit rtx 5060 infinity oc', specs: { gpuModel: 'RTX 5060', vram: 8 } }),
      item('i3', 's1', 'Placa de Video Palit RTX 5060 8GB Infinity 3 OC', { modelKey: 'palit rtx 5060 infinity oc', specs: { gpuModel: 'RTX 5060', vram: 8 } }),
    ]);
    expect(together(r.group)).toEqual([['i2'], ['i3'], ['s2', 's3']]);
    // A ficha só passa no nível exato (mesmo código): a da s2 não vale para a s3 sem código.
    expect(r.exact.get('s2')).not.toBe(r.exact.get('s3'));
  });

  it('grupo: mesmo EAN ou mesma chave do título (sem contradição) juntam', () => {
    const r = identifyProducts([
      item('a', 's1', 'Fonte MSI MAG A750BN 750W', { ean: '123', modelKey: 'msi a750bn 750' }),
      item('b', 's2', 'Fonte MSI A750BN', { ean: '123', modelKey: 'outra' }),
      item('c', 's3', 'Fonte MSI MAG A750BN, 750W', { modelKey: 'msi a750bn 750' }),
    ]);
    expect(together(r.group)).toEqual([['a', 'b', 'c']]);
  });
});
