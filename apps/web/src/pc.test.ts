import { describe, expect, it, vi } from 'vitest';
import { normalizeListing, parseCpuzReport } from '@upgradezin/shared';
import { analyzePc } from '@upgradezin/shared';
import amd from '../../../packages/shared/fixtures/cpuz/amd-am4-rx6600.txt?raw';
import intel from '../../../packages/shared/fixtures/cpuz/intel-lga1700-rtx4060ti.txt?raw';
import { buildTotals, checkCandidate, type BuildItem } from './build.ts';
import { applyPc, currentPc, forgetPcBuild, loadPc, readReportFile, savePc, validPc, withoutOwned, withoutPcItems } from './pc.ts';

const pc = parseCpuzReport(amd)!;
const file = (text: BlobPart, name = 'PC.txt') => new File([text], name, { type: 'text/plain' });

it('usa peças marcadas manualmente no diagnóstico e mantém as compras fora do perfil', () => {
  const mark = (key: string, part: NonNullable<typeof pc.cpu>): BuildItem => ({ key, ...part, current: true, offers: [] });
  const slots = { cpu: mark('cpu', pc.cpu!), gpu: mark('gpu', pc.gpu!), ram: { ...mark('ram', pc.ram!), qty: 2 } };
  const manual = currentPc(null, slots)!;
  expect(manual).toMatchObject({ source: 'manual', monitors: [], ram: { specs: { ramCapacity: pc.ram!.specs.ramCapacity! * 2 } } });
  expect(analyzePc(manual).balance.verdict).toBe(analyzePc(pc, {}).balance.verdict);
  expect(currentPc(null, forgetPcBuild(slots))).toBeNull();
  expect(currentPc(null, { cpu: { ...slots.cpu, current: undefined } })).toBeNull();
});

it('preserva os dados medidos e usa a peça marcada como Atual quando ela substitui a do relatório', () => {
  const imported = applyPc({}, pc);
  const manualGpu: BuildItem = { key: 'gpu:nova', title: 'Outra GPU', specs: { gpuModel: 'RTX 4060' }, current: true, offers: [] };
  const mixed = currentPc(pc, { ...imported, gpu: manualGpu })!;
  expect(mixed.gpu?.title).toBe('Outra GPU');
  expect(mixed.monitors).toEqual(pc.monitors);
  expect(mixed.drives).toEqual(pc.drives);
  expect(currentPc(pc, { ...imported, gpu: { ...manualGpu, current: undefined } })?.gpu).toEqual(pc.gpu);
  expect(forgetPcBuild({ ...imported, gpu: manualGpu })).toEqual({ gpu: { ...manualGpu, current: undefined } });
});

describe('importar o PC pelo relatório do CPU-Z', () => {
  it('lê o arquivo (UTF-8 e UTF-16) e recusa o que não é do CPU-Z', async () => {
    expect(await readReportFile(file(amd))).toMatchObject({ ok: true, pc: { cpu: { title: 'AMD Ryzen 7 5800X3D' } } });
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...intel].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect(await readReportFile(file(utf16))).toMatchObject({ ok: true, pc: { cpu: { specs: { cpuModel: '13400F' } } } });
    expect(await readReportFile(file('lista de compras'))).toEqual({ ok: false, reason: 'not-cpuz' });
  });

  it('as peças entram como "Atual", sem preço, e substituem as da montagem; a fonte fica', () => {
    const psu: BuildItem = { key: 'psu', title: 'Fonte 650W', specs: normalizeListing('psu', 'Fonte MSI MAG A650BN 650W 80 Plus Bronze').specs, offers: [] };
    const old: BuildItem = { key: 'x', title: 'Ryzen 5 5600', specs: normalizeListing('cpu', 'Processador AMD Ryzen 5 5600, AM4').specs, offers: [] };
    const b = applyPc({ cpu: old, psu }, pc);
    expect(Object.keys(b).sort()).toEqual(['cpu', 'extraDrives', 'gpu', 'motherboard', 'psu', 'ram', 'ssd']);
    expect(b.cpu).toMatchObject({ key: 'pc:cpu', title: 'AMD Ryzen 7 5800X3D', offers: [], current: true });
    expect(b.psu).toBe(psu);
    expect(buildTotals(b)).toMatchObject({ best: 0, parts: 1, current: 7 });
  });

  it('fonte informada na importação entra como "Atual"; sem ela, a da montagem fica', () => {
    const psu: BuildItem = { key: 'psu', title: 'Fonte 650W', specs: { watts: 650 }, offers: [] };
    const withPsu = applyPc({ psu }, { ...pc, psu: { title: 'Fonte Corsair 550W', brand: 'Corsair', specs: { watts: 550, activePfc: true } } });
    expect(withPsu.psu).toMatchObject({ key: 'pc:psu', title: 'Fonte Corsair 550W', current: true, specs: { watts: 550 } });
    expect(applyPc({ psu }, pc).psu).toBe(psu);
  });

  it('PC sem placa dedicada tira a placa "Atual" de antes, mas não a escolhida numa loja', () => {
    const noGpu = { ...pc, gpu: undefined };
    expect(applyPc(applyPc({}, pc), noGpu).gpu).toBeUndefined();
    const bought: BuildItem = { key: 'g', title: 'RTX 4060', specs: normalizeListing('gpu', 'Placa de vídeo RTX 4060 8GB').specs, offers: [] };
    expect(applyPc({ gpu: bought }, noGpu).gpu).toBe(bought);
  });

  it('com o PC atual na montagem, a busca de upgrade já sabe o que é compatível', () => {
    const b = applyPc({}, pc);
    expect(checkCandidate(b, 'cpu', normalizeListing('cpu', 'Processador AMD Ryzen 7 9700X, AM5').specs).status).toBe('error');
    expect(checkCandidate(b, 'cpu', normalizeListing('cpu', 'Processador AMD Ryzen 9 5950X, AM4').specs).status).not.toBe('error');
  });

  it('perfil guardado no navegador só volta com o formato esperado', () => {
    expect(validPc(JSON.parse(JSON.stringify(pc)))).not.toBeNull();
    expect(validPc({ ...pc, source: 'outro' })).toBeNull();
    expect(validPc({ ...pc, cpu: { title: 1, specs: {} } })).toBeNull();
    expect(validPc({ ...pc, cpu: { title: 'x'.repeat(5000), specs: {} } })).toBeNull();
    expect(validPc({ ...pc, drives: Array(100).fill(pc.drives[0]) })).toBeNull();
    expect(validPc('lixo')).toBeNull();
    expect(validPc(null)).toBeNull();
  });
});

it('guarda a data da importação e a mantém ao regravar o mesmo PC', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  try {
    const saved = savePc(pc, 1_700_000_000_000);
    expect(saved.importedAt).toBe(1_700_000_000_000);
    expect(loadPc()?.importedAt).toBe(1_700_000_000_000);
    expect(savePc({ ...saved, psu: undefined }, 1_800_000_000_000).importedAt).toBe(1_700_000_000_000);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('importar o CPU-Z tira da montagem as peças marcadas como Já tenho e mantém as compradas', () => {
  const owned = (key: string, current?: true): BuildItem => ({ key, title: key, specs: {}, offers: [], ...(current && { current }) });
  const build = { cpu: owned('cpu:1', true), gpu: owned('gpu:nova'), ssd: owned('ssd:a', true), extraDrives: [owned('ssd:b'), owned('ssd:c', true)] };
  const next = withoutOwned(build);
  expect(next.cpu).toBeUndefined();
  expect(next.gpu?.key).toBe('gpu:nova');
  expect([next.ssd?.key, ...(next.extraDrives ?? []).map((d) => d.key)]).toEqual(['ssd:b']);
});

it('ao abrir, tira as peças que versões antigas copiavam do CPU-Z para a montagem', () => {
  const imported = { ...applyPc({}, pc), case: { key: 'case:novo', title: 'Gabinete novo', specs: {}, offers: [] } };
  const clean = withoutPcItems(imported);
  expect(clean.case?.key).toBe('case:novo');
  expect(clean.gpu).toBeUndefined();
  expect(clean.cpu).toBeUndefined();
  expect(clean.ssd).toBeUndefined();
});
