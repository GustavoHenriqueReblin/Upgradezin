import { describe, expect, it } from 'vitest';
import { normalizeListing } from './categorize.ts';
import { isTextTerm, termMatches } from './terms.ts';
import type { CategoryId } from './types.ts';

const specs = (category: CategoryId, title: string) => normalizeListing(category, title).specs;

describe('termMatches: anúncio do banco que serve a um termo, pelas specs', () => {
  it('processador: encaixe e linha', () => {
    const x3d = specs('cpu', 'Processador AMD Ryzen 7 5800X3D, 8-Core, 16-Threads, 3.4GHz (4.5GHz Turbo), Cache 100MB, AM4');
    expect(termMatches('cpu', 'AM4', x3d)).toBe(true);
    expect(termMatches('cpu', 'am4', x3d)).toBe(true);
    expect(termMatches('cpu', 'Ryzen 7', x3d)).toBe(true);
    expect(termMatches('cpu', 'AM5', x3d)).toBe(false);
    expect(termMatches('cpu', 'Ryzen 5', x3d)).toBe(false);
  });
  it('fonte, placa-mãe, memória, SSD, cooler, gabinete e placa de vídeo', () => {
    expect(termMatches('psu', '750W', specs('psu', 'Fonte MSI MAG A750BN, 750W, 80 Plus Bronze'))).toBe(true);
    expect(termMatches('psu', '650W', specs('psu', 'Fonte MSI MAG A750BN, 750W, 80 Plus Bronze'))).toBe(false);
    const b550 = specs('motherboard', 'Placa-Mãe MSI B550 Gaming WiFi6E, AMD AM4, ATX, DDR4');
    expect(['AM4', 'B550', 'DDR4'].map((t) => termMatches('motherboard', t, b550))).toEqual([true, true, true]);
    expect(termMatches('motherboard', 'B650', b550)).toBe(false);
    const ram = specs('ram', 'Memória RAM Kingston Fury Beast, 16GB (2x8GB), 3200MHz, DDR4, CL16');
    expect(termMatches('ram', 'DDR4 16GB', ram)).toBe(true);
    expect(termMatches('ram', 'DDR4 32GB', ram)).toBe(false);
    expect(termMatches('ssd', 'SSD NVMe', specs('ssd', 'SSD Kingston NV3, 1TB, M.2 2280, PCIe 4.0 x4, NVMe'))).toBe(true);
    expect(termMatches('cooler', 'Water Cooler', specs('cooler', 'Water Cooler MSI MAG Coreliquid A13, 360mm, Intel e AMD'))).toBe(true);
    expect(termMatches('case', 'Gabinete', specs('case', 'Gabinete Gamer Corsair 4000D, Mid Tower, Lateral em Vidro'))).toBe(true);
    const gpu = specs('gpu', 'Placa de Vídeo Gigabyte RTX 4060 Eagle OC 8GB GDDR6');
    expect(termMatches('gpu', 'NVIDIA GeForce', gpu)).toBe(true);
    expect(termMatches('gpu', 'AMD Radeon', gpu)).toBe(false);
    expect(termMatches('gpu', 'placa de video', gpu)).toBe(true);
  });
});

describe('isTextTerm: texto livre que pode ir às lojas', () => {
  it('aceita nome de produto; recusa curto, longo ou com símbolos', () => {
    expect(isTextTerm('Zotac RTX 3050 Twin Edge OC')).toBe(true);
    expect(isTextTerm('ZT-A30510H-10L')).toBe(true);
    expect(isTextTerm('Placa-Mãe B550M/AC 2.0')).toBe(true);
    expect(isTextTerm('oc')).toBe(false);
    expect(isTextTerm('a'.repeat(61))).toBe(false);
    expect(isTextTerm('rtx, 3050')).toBe(false); // vírgula separa termos na API
    expect(isTextTerm('<script>')).toBe(false);
    expect(isTextTerm('-rtx 3050')).toBe(false);
  });
});
