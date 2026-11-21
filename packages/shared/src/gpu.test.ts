import { describe, expect, it } from 'vitest';
import { extractGpuModel as chipOf, isGpu as gpuTitle } from './gpu.ts';

describe('placas profissionais', () => {
  it('RTX 4000/4500/5000/6000 não são placas de jogos', () => {
    expect(chipOf('Placa de Vídeo PNY NVIDIA RTX 5000 Ada 32GB')).toBeUndefined();
    expect(gpuTitle('Placa de Video PNY Nvidia RTX 4500 Ada Generation 24GB GDDR6')).toBe(false);
    expect(chipOf('Placa de Vídeo Gigabyte RTX 5060 Ti 16GB')?.model).toBe('RTX 5060 Ti');
  });
});
import { extractGpuModel, extractGpuSpecs, gpuModelKey, gpuSeriesOf, isGpu } from './gpu.ts';

describe('extractGpuModel', () => {
  it.each([
    ['Placa de Vídeo Gigabyte RTX 5060 EAGLE MAX OC 8GB NVIDIA GeForce, 8GB GDDR7', 'nvidia', 'RTX 5060'],
    ['Placa De Vídeo Husky Alpha RTX 3060 TI, NVIDIA, 8GB, GDDR6', 'nvidia', 'RTX 3060 Ti'],
    ['Placa de Vídeo Asus RTX 4070 Ti Super 16GB', 'nvidia', 'RTX 4070 Ti Super'],
    ['Placa de Vídeo ASRock RX 7600 XT Challenger, 16GB', 'amd', 'RX 7600 XT'],
    ['Placa de Vídeo Sapphire Pulse RX 9060 XT 16GB GDDR6', 'amd', 'RX 9060 XT'],
    ['Placa de Vídeo Galax GeForce GTX 1660 Super 6GB', 'nvidia', 'GTX 1660 Super'],
    ['Placa de Vídeo Gt740 4gb GDDR5', 'nvidia', 'GT 740'],
    ['Placa de Vídeo Intel Arc B580 Limited Edition, 12GB', 'intel', 'Arc B580'],
  ])('%s', (title, maker, model) => {
    expect(extractGpuModel(title)).toEqual({ maker, model });
  });
});

describe('isGpu', () => {
  it('aceita placa de vídeo (inclusive título começando com "Gpu")', () => {
    expect(isGpu('Placa de Vídeo MSI RTX 5060 8G VENTUS 2X OC Geforce NVIDIA, 8GB, GDDR7')).toBe(true);
    expect(isGpu('Gpu Msi RTX 5070 Ti 16gb Gaming Trio Oc, Gddr7, 256-bits')).toBe(true);
  });
  it.each([
    'Suporte de Placa de Vídeo Rise Mode, ARGB, 500mm, Aura V1, Branco',
    'Suporte para GPU Rise Mode, ARGB, 500mm',
    'Cabo Extensor PCI Express Rise Mode Riser',
    'Placa de Captura Elgato HD60 X',
  ])('rejeita %s', (t) => expect(isGpu(t)).toBe(false));
});

describe('extractGpuSpecs', () => {
  it('VRAM, tipo de memória e low profile', () => {
    expect(extractGpuSpecs('Placa de Vídeo Gigabyte RTX 5060 EAGLE MAX OC 8GB NVIDIA GeForce, 8GB GDDR7, 128bit')).toMatchObject({ vram: 8, vramType: 'GDDR7' });
    expect(extractGpuSpecs('Placa de Vídeo RTX 3060 Windforce OC 12G (rev. 2.0) Gigabyte, GDDR6')).toMatchObject({ vram: 12, vramType: 'GDDR6' });
    expect(extractGpuSpecs('Placa de Vídeo MSI RTX 3050 Low Profile 6GB GDDR6').lowProfile).toBe(true);
  });
});

describe('gpuModelKey', () => {
  it('mesma placa escrita em ordens diferentes', () => {
    const a = gpuModelKey('Placa de Vídeo Gigabyte RTX 5060 EAGLE MAX OC 8GB NVIDIA GeForce, 8GB GDDR7, 128bit', 'Gigabyte');
    const b = gpuModelKey('Placa de Vídeo Gigabyte GeForce RTX 5060 Eagle Max OC, 8GB GDDR7, Ray Tracing', 'Gigabyte');
    expect(a).toBe('gigabyte rtx 5060 8gb eagle max oc');
    expect(b).toBe(a);
  });
  it('linhas diferentes do mesmo chip ficam separadas', () => {
    const ventus = gpuModelKey('Placa de Vídeo MSI RTX 5060 8G VENTUS 2X OC Geforce NVIDIA, 8GB', 'MSI');
    const shadow = gpuModelKey('Placa de Vídeo MSI RTX 5060 8G SHADOW 2X OC Geforce NVIDIA, 8GB', 'MSI');
    expect(ventus).not.toBe(shadow);
  });
});

describe('gpuSeriesOf', () => {
  it.each([
    ['RTX 5060 Ti', 'RTX 50'],
    ['RTX 4070 Super', 'RTX 40'],
    ['RTX 2060 Super', 'RTX 20'],
    ['GTX 1660 Super', 'GTX 16'],
    ['GTX 1050 Ti', 'GTX 10'],
    ['GTX 750 Ti', 'GT'],
    ['GT 730', 'GT'],
    ['RX 9060 XT', 'RX 9000'],
    ['RX 7900 XTX', 'RX 7000'],
    ['RX 580', 'RX 500'],
    ['Arc B580', 'Arc B'],
  ])('%s → %s', (model, series) => expect(gpuSeriesOf(model)).toBe(series));

  it('vem junto nas specs', () => {
    expect(extractGpuSpecs('Placa de Vídeo MSI RTX 5060 8G VENTUS 2X OC, 8GB GDDR7').gpuSeries).toBe('RTX 50');
  });
});
