import { describe, expect, it } from 'vitest';
import { gpuSignature, identifyProducts, productMpn, textHasCode, type IdentityItem } from './identity.ts';
import { extractCpuSpecs } from './cpu.ts';
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

  it('código só no endereço de um anúncio com outro part number: o endereço é de outro produto (página reaproveitada pela loja)', () => {
    const r = identifyProducts([
      item('t20', 's2', 'Cooler Para Processador Cooler Master Hyper T20 90mm Preto, RR-T20-20FK-R1', { mpn: 'RR-T20-20FK-R1' }),
      item('spec', 's3', 'Cooler para Processador Cooler Master Hyper 212 Spectrum, Intel-AMD, RGB, RR-212A-20PD-R1', {
        mpn: 'RR-212A-20PD-R1',
        url: 'https://s3.example/produto/15212/cooler-para-processador-cooler-master-hyper-t20-92mm-intel-amd-rr-t20-20fk-r1',
      }),
      item('spec2', 's2', 'Cooler Para Processador Cooler Master Hyper 212 Spectrum RGB, RR-212A-20PD-R1', { mpn: 'RR-212A-20PD-R1' }),
    ]);
    expect(together(r.exact)).toEqual([['spec', 'spec2'], ['t20']]);
    // Sem part number próprio, o código no endereço ainda junta.
    const s = identifyProducts([
      item('a', 's2', 'Cooler Master Hyper T20, RR-T20-20FK-R1', { mpn: 'RR-T20-20FK-R1' }),
      item('b', 's3', 'Cooler Master Hyper T20', { url: 'https://s3.example/produto/1/cooler-master-hyper-t20-rr-t20-20fk-r1' }),
    ]);
    expect(together(s.exact)).toEqual([['a', 'b']]);
    // Part number parecido (variante regional do mesmo código): o endereço com o código da outra loja junta.
    const v = identifyProducts([
      item('br', 's1', 'Fonte Xpg Kyber, 750w, 80 Plus Gold, Kyber750g-bkcbr', { mpn: 'KYBER750G-BKCBR' }),
      item('tw', 's1', 'Fonte Xpg Kyber, 750w, 80 Plus Gold, Kyber750g-bkctw', { mpn: 'KYBER750G-BKCTW' }),
      item('s3', 's3', 'Fonte XPG Kyber 750W Gold', { mpn: 'KYBER750G-BKCTW-X', url: 'https://s3.example/produto/1/fonte-xpg-kyber-750w-kyber750g-bkcbr' }),
    ]);
    expect(v.exact.get('s3')).toBe(v.exact.get('br'));
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

  it('processador: mesmo modelo e a descrição do título sem contradição é o mesmo produto, com ou sem part number e com códigos de embalagem diferentes', () => {
    const cpu = (id: string, store: StoreId, title: string, mpn?: string) => item(id, store, title, { mpn, specs: extractCpuSpecs(title) });
    const r = identifyProducts([
      cpu('pichau-pof', 's2', 'Processador AMD Ryzen 7 5800X3D, 8-Core, 16-Threads, 3.4GHz (4.5GHz Turbo), Cache 100MB, AM4, 100-100000651POF', '100-100000651POF'),
      cpu('kabum-pof', 's1', 'Processador AMD Ryzen 7 5800X3D, 3.4GHz (4.5GHz Max Turbo), Cache 100MB, 8 Núcleos, 16 Threads, AM4, Sem Vídeo Integrado - 100-100000651POF', '100-100000651POF'),
      cpu('pichau-wof', 's2', 'Processador AMD Ryzen 7 5800X3D, 8-Core, 16-Threads, 3.4GHz (4.5GHz Turbo), Cache 100MB, AM4, 100-100000651WOF', '100-100000651WOF'),
      cpu('tera-aniv', 's3', 'Processador AMD Ryzen 7 5800X3D Anniversary Edition, 3.4GHz (4.5GHz Turbo), 8-Cores 16-Threads, AM4, Sem Cooler, Sem vídeo'),
      cpu('tera', 's3', 'Processador AMD Ryzen 7 5800X3D, 3.4GHz (4.5GHz Turbo), 8-Cores 16-Threads, AM4, Sem Cooler, Sem vídeo'),
      cpu('outro', 's3', 'Processador AMD Ryzen 7 5800X, 3.8GHz (4.7GHz Turbo), 8-Cores 16-Threads, AM4, Sem Cooler, Sem vídeo'), // outro modelo
    ]);
    expect(together(r.exact)).toEqual([['kabum-pof', 'pichau-pof', 'pichau-wof', 'tera', 'tera-aniv'], ['outro']]);
    expect(r.exact.get('tera')).toBe('100100000651POF'); // a chave continua a do part number
  });

  it('processador: com e sem cooler do mesmo modelo ficam separados; clock diferente no título não junta', () => {
    const cpu = (id: string, store: StoreId, title: string, mpn?: string) => item(id, store, title, { mpn, specs: extractCpuSpecs(title) });
    const r = identifyProducts([
      cpu('box', 's1', 'Processador AMD Ryzen 5 5600, 3.5GHz (4.4GHz Max Turbo), AM4, Cooler Wraith Stealth - 100-100000927BOX', '100-100000927BOX'),
      cpu('sem', 's2', 'Processador AMD Ryzen 5 5600, 3.5GHz (4.4GHz Turbo), AM4, Sem Cooler, 100-100000927MPK', '100-100000927MPK'),
      cpu('box2', 's3', 'Processador AMD Ryzen 5 5600, 3.5GHz (4.4GHz Turbo), AM4, Com Cooler Wraith'),
      cpu('nao-diz', 's3', 'Processador AMD Ryzen 5 5600, 3.5GHz (4.4GHz Turbo), AM4'),
      cpu('clock', 's2', 'Processador AMD Ryzen 5 5600, 3.7GHz (4.6GHz Turbo), AM4, Sem Cooler'),
    ]);
    expect(together(r.exact)).toEqual([['box', 'box2', 'nao-diz'], ['clock'], ['sem']]); // o que não diz e não é tray vai com a box
  });

  it('processador: tray/OEM (no título ou no código) é outro produto da box; cooler diferente na caixa também', () => {
    const cpu = (id: string, store: StoreId, title: string, mpn?: string) => item(id, store, title, { mpn, specs: extractCpuSpecs(title) });
    const r = identifyProducts([
      cpu('box', 's2', 'Processador Intel Core i3-10100, 4-Core, 8-Threads, 3.6Ghz (4.3Ghz Turbo), Cache 6MB, LGA1200, BX8070110100', 'BX8070110100'),
      cpu('box2', 's3', 'Processador Intel Core i3 10100 3.60GHz (4.30GHz Turbo), 10ª Geração, 4-Cores 8-Threads, LGA 1200'),
      cpu('cm', 's1', 'Processador Intel Core i3-10100 3.6ghz Turbo 4.3ghz 6mbcache 4nucleos 8threads LGA 1200 S/ Cooler Cm8070104291317'),
      cpu('oem', 's1', 'Processador Intel Core i3-10100 LGA 1200 Oem'),
      cpu('stealth', 's3', 'Processador AMD Ryzen 7 7700 3.8GHz (5.3GHz Turbo), 8-Cores 16-Threads, AM5, Com Cooler AMD Wraith Stealth'),
      cpu('prism', 's3', 'Processador AMD Ryzen 7 7700 3.8GHz (5.3GHz Turbo), 8-Cores 16-Threads, AM5, Com Cooler AMD Wraith Prism'),
    ]);
    expect(together(r.exact)).toEqual([['box', 'box2'], ['cm', 'oem'], ['prism'], ['stealth']]);
  });
});

