import { describe, expect, it } from 'vitest';
import { SHEET_FIELDS, type CategoryId, type Offer, type StoreId } from '@upgradezin/shared';
import { getMeta, openDb, setMeta, type Db } from '../db/db.ts';
import { saveCollection } from './prices.ts';
import { catalogProducts, mergeSources, nextSheets, pageText, readerStamp, rereadSheets, savePage, sheetCounts, sheetCoverage, sheetQueueSizes, syncSheetTables } from './sheets.ts';

const offer = (store: StoreId, sku: string, inStock = true): Offer =>
  ({ store, storeSku: sku, title: `Produto ${sku}`, url: `https://${store}.example/${sku}`, priceCash: 100, inStock, specs: {}, modelKey: `m${store}${sku}`, collectedAt: '' }) as Offer;

/** Grava anúncios de uma categoria numa loja, vistos em `at`. */
function seen(db: Db, store: StoreId, category: CategoryId, offers: Offer[], at: string) {
  saveCollection(db, { store, category, offers, at });
}
const cols = (db: Db, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; type: string }[]).map((c) => `${c.name}:${c.type}`);

const NOW = '2026-11-21T12:00:00.000Z';
const SINCE = '2026-11-07T12:00:00.000Z';
const RAM_FULL = 'Marca: Kingston\nCapacidade: 16GB (2 x 8GB)\nTipo: DDR4\nFrequência: 3200 MHz\nLatência: CL16';

describe('tabelas de ficha por categoria', () => {
  it('uma coluna por campo, com o tipo do campo; campo novo vira coluna, campo que saiu é apagado', () => {
    const db = openDb(':memory:');
    syncSheetTables(db);
    expect(cols(db, 'sheet_cpu')).toEqual(expect.arrayContaining(['store:TEXT', 'store_sku:TEXT', 'brand:TEXT', 'socket:TEXT', 'cores:INTEGER', 'base_ghz:REAL', 'tdp_w:INTEGER']));
    expect(cols(db, 'sheet_gpu')).toContain('power16_pin:INTEGER');
    // Coluna que não está mais na lista (como se um campo tivesse saído) e campo que ainda não tem coluna.
    db.exec('ALTER TABLE sheet_ram ADD COLUMN voltagem REAL; ALTER TABLE sheet_ram DROP COLUMN cl');
    expect(syncSheetTables(db)).toEqual({ added: ['sheet_ram.cl'], dropped: ['sheet_ram.voltagem'] });
    expect(syncSheetTables(db)).toEqual({ added: [], dropped: [] });
  });

  it('guarda a página (texto e campos lidos); página sem ficha também fica guardada; ler de novo troca', () => {
    const db = openDb(':memory:');
    expect(savePage(db, { store: 's1', sku: '1', category: 'ram', text: RAM_FULL, at: NOW })).toEqual({ brand: 'Kingston', capacityGb: 16, modules: 2, type: 'DDR4', mhz: 3200, cl: 16, expo: false });
    expect(db.prepare('SELECT capacity_gb, modules, type, mhz, cl FROM sheet_ram WHERE store_sku = ?').get('1')).toEqual({ capacity_gb: 16, modules: 2, type: 'DDR4', mhz: 3200, cl: 16 });
    expect(pageText(db, 's1', '1')).toEqual({ text: RAM_FULL, at: NOW });
    expect(savePage(db, { store: 's1', sku: '2', category: 'ram', text: null })).toEqual({});
    expect(pageText(db, 's1', '2')?.text).toBeNull();
    savePage(db, { store: 's1', sku: '1', category: 'ram', text: 'Capacidade: 32GB' });
    expect(db.prepare('SELECT capacity_gb, type FROM sheet_ram WHERE store_sku = ?').get('1')).toEqual({ capacity_gb: 32, type: null });
    // Anúncio que mudou de categoria sai da tabela da antiga.
    savePage(db, { store: 's1', sku: '1', category: 'ssd', text: 'Capacidade: 1 TB' });
    expect(db.prepare("SELECT count(*) n FROM sheet_ram WHERE store_sku = '1'").get()).toEqual({ n: 0 });
    expect(sheetCounts(db).get('s1|ssd')).toBe(1);
  });

  it('o leitor ou os campos mudaram: relê as páginas guardadas (sem abrir de novo); igual, não relê', () => {
    const db = openDb(':memory:');
    savePage(db, { store: 's1', sku: '1', category: 'ram', text: RAM_FULL });
    expect(rereadSheets(db)).toBe(1); // primeira vez: sem marca guardada
    expect(getMeta(db, 'sheet-reader')).toBe(readerStamp());
    db.exec("UPDATE sheet_ram SET cl = NULL WHERE store_sku = '1'");
    expect(rereadSheets(db)).toBe(0);
    setMeta(db, 'sheet-reader', 'leitor antigo');
    expect(rereadSheets(db)).toBe(1);
    expect(db.prepare("SELECT cl FROM sheet_ram WHERE store_sku = '1'").get()).toEqual({ cl: 16 });
  });
});

describe('produtos, fila e cobertura', () => {
  it('junta as fontes na ordem dada: a primeira com o campo vale; faltam os principais sem valor', () => {
    const merged = mergeSources('ram', [
      { store: 's2', sku: 'b', at: NOW, hasSheet: true, values: { capacityGb: 16 } },
      { store: 's1', sku: 'a', at: NOW, hasSheet: true, values: { capacityGb: 32, type: 'DDR4' } },
    ]);
    expect(merged.values).toEqual({ capacityGb: 16, type: 'DDR4' });
    expect(merged.origin).toEqual({ capacityGb: { store: 's2', sku: 'b' }, type: { store: 's1', sku: 'a' } });
    expect(merged.missing).toEqual(['modules', 'mhz', 'cl']);
  });

  it('fila: só páginas não lidas de produto sem ficha completa, vistos nos últimos dias; em estoque e achado há menos tempo primeiro', () => {
    const db = openDb(':memory:');
    seen(db, 's2', 'ram', [offer('s2', 'antigo')], '2026-11-10T00:00:00.000Z');
    seen(db, 's2', 'cpu', [offer('s2', 'novo')], NOW);
    seen(db, 's2', 'gpu', [offer('s2', 'sem-estoque', false)], NOW);
    seen(db, 's2', 'ram', [offer('s2', 'completo'), offer('s2', 'incompleto')], '2026-11-15T00:00:00.000Z');
    seen(db, 's2', 'ssd', [offer('s2', 'fora')], '2026-10-01T00:00:00.000Z'); // não visto nos últimos 14 dias
    seen(db, 's1', 'ram', [offer('s1', 'outra-loja')], NOW);
    savePage(db, { store: 's2', sku: 'completo', category: 'ram', text: RAM_FULL });
    savePage(db, { store: 's2', sku: 'incompleto', category: 'ram', text: 'Capacidade: 8GB' }); // lida: não volta à fila
    expect(nextSheets(db, 's2', SINCE, 10)).toEqual([
      { sku: 'novo', category: 'cpu' },
      { sku: 'antigo', category: 'ram' },
      { sku: 'sem-estoque', category: 'gpu' },
    ]);
    expect(nextSheets(db, 's2', SINCE)).toEqual([{ sku: 'novo', category: 'cpu' }]); // uma por vez
    expect(sheetQueueSizes(db, SINCE)).toEqual(new Map([['s2', 3], ['s1', 1]]));
  });

  it('cobertura por categoria: completas, incompletas, não lidas, as que só a web completaria e os campos que mais faltam', () => {
    const db = openDb(':memory:');
    seen(db, 's1', 'ram', [offer('s1', 'a'), offer('s1', 'b'), offer('s1', 'c')], NOW);
    seen(db, 's2', 'ram', [offer('s2', 'd')], NOW);
    savePage(db, { store: 's1', sku: 'a', category: 'ram', text: RAM_FULL });
    savePage(db, { store: 's1', sku: 'b', category: 'ram', text: 'Capacidade: 8GB\nTipo: DDR5' });
    savePage(db, { store: 's2', sku: 'd', category: 'ram', text: null });
    const ram = sheetCoverage(db, SINCE).find((r) => r.category === 'ram')!;
    expect(ram).toMatchObject({ name: 'Memória RAM', products: 4, complete: 1, incomplete: 2, unread: 1, exhausted: 2, missing: { mhz: 2, cl: 2, capacityGb: 1 } });
    const states = Object.fromEntries(catalogProducts(db, 'ram', SINCE).map((p) => [p.listings[0]!.sku, p.state]));
    expect(states).toEqual({ a: 'complete', b: 'incomplete', c: 'unread', d: 'incomplete' });
  });

  it('remove potência máxima do esquema e dos valores antigos sem apagar o texto original', () => {
    const db = openDb(':memory:');
    syncSheetTables(db);
    savePage(db, { store: 's1', sku: 'a', category: 'cpu', text: 'TDP: 125 W\nMaximum Turbo Power: 253 W' });
    db.exec(`
      ALTER TABLE sheet_cpu ADD COLUMN max_power_w INTEGER;
      UPDATE sheet_cpu SET max_power_w = 253;
      INSERT INTO sheet_manual VALUES ('cpu:a', 'maxPowerW', 'cpu', '253', '2026-11-21');
      INSERT INTO sheet_web (product_key, field, category, title, question, status, store, asked_at)
        VALUES ('cpu:a', 'maxPowerW', 'cpu', '', '', 'ok', 's1', '2026-11-21');
    `);
    expect(syncSheetTables(db).dropped).toContain('sheet_cpu.max_power_w');
    expect(db.prepare('SELECT tdp_w FROM sheet_cpu').get()).toEqual({ tdp_w: 125 });
    expect(db.prepare('SELECT field FROM sheet_manual').all()).toEqual([]);
    expect(db.prepare('SELECT field FROM sheet_web').all()).toEqual([]);
    expect(pageText(db, 's1', 'a')?.text).toContain('253 W');
  });

  it('todas as categorias do registro têm tabela', () => {
    const db = openDb(':memory:');
    syncSheetTables(db);
    for (const c of Object.keys(SHEET_FIELDS)) expect(cols(db, `sheet_${c}`).length).toBeGreaterThan(2);
  });
});

describe('ficha completada pelo título e pelo padrão da categoria', () => {
  const page = (sku: string, values: Record<string, string | number>, hasSheet = true) => ({ store: 's3' as StoreId, sku, at: NOW, hasSheet, values });

  it('conta apenas a expansão de placa-mãe sustentada pelas fichas e preserva a correção manual', () => {
    const pages = [page('a', { ramSlots: 4, m2Slots: 2 }), page('b', { ramSlots: 2, m2Slots: 1 })];
    expect(mergeSources('motherboard', pages).values).toMatchObject({ ramSlots: 2, m2Slots: 1 });
    expect(mergeSources('motherboard', pages, [], undefined, { ramSlots: 4 }).values.ramSlots).toBe(4);
  });

  it('gabinete "Com Fans" sem o número: o padrão (0, "não tem") não vale, fica "não sei"; com o número, o título diz quantas', () => {
    const box = (sku: string) => ({ store: 's3' as StoreId, sku, at: NOW, hasSheet: true, values: { formFactor: 'Mid Tower', mbFormats: 'ATX' } });
    const t = (title: string) => [{ store: 's3' as StoreId, sku: '1', title }];
    expect(mergeSources('case', [box('1')], t('Gabinete Gamer Gamdias, Talos E1, Preto, Com Fans')).values.fansIncluded).toBeUndefined();
    expect(mergeSources('case', [box('1')], t('Gabinete Gamer Fortrek Cruiser, Com 3 Coolers RGB, Branco')).values.fansIncluded).toBe(3);
    expect(mergeSources('case', [box('1')], t('Gabinete Gamer Simples, Preto')).values.fansIncluded).toBe(0);
  });

  it('"não tem" da página cede para um valor de verdade do título (a página não fala de Wi-Fi, o título diz "Wifi7")', () => {
    const board = (sku: string, values: Record<string, string | number>) => ({ store: 's3' as StoreId, sku, at: NOW, hasSheet: true, values });
    const titles = [{ store: 's3' as StoreId, sku: '1', title: 'Placa Mãe Gigabyte X870M Aorus Elite Wifi7, DDR5, AM5' }];
    expect(mergeSources('motherboard', [board('1', { chipset: 'X870', wifi: 'Não', bluetooth: 'Não' })], titles).values).toMatchObject({ wifi: 'Wi-Fi 7', bluetooth: 'Não' });
    // Sem nada contra, o "não tem" fica.
    expect(mergeSources('motherboard', [board('1', { chipset: 'B650', wifi: 'Não' })], [{ store: 's3', sku: '1', title: 'Placa Mãe B650M' }]).values.wifi).toBe('Não');
    // À mão, o "não tem" vale contra tudo.
    expect(mergeSources('motherboard', [board('1', { chipset: 'X870' })], titles, undefined, { wifi: 'Não' }).values.wifi).toBe('Não');
  });

  it('o que a página não trouxe vem do título; a página vale mais; fonte sem "modular" na página nem no título: não modular', () => {
    const titles = [{ store: 's3' as StoreId, sku: '1', title: 'Fonte ASRock Phantom Gaming, 750W, 80 Plus Gold, Cybenetics Platinum, Full Modular, ATX 3.1, PCIe 5.1, Preto, PG-750G' }];
    const m = mergeSources('psu', [page('1', { efficiency: '80 Plus Gold', standard: 'ATX 3.1', eps: 2, pcie8: 3, sata: 9 })], titles);
    expect(m.values).toMatchObject({ watts: 750, modular: 'Total', efficiency: '80 Plus Gold', eps: 2 });
    expect(m.origin.watts).toEqual({ store: 's3', sku: '1', from: 'title' });
    expect(m.origin.efficiency).toEqual({ store: 's3', sku: '1' });
    expect(m.missing).toEqual([]);
    const plain = mergeSources('psu', [page('2', { watts: 500, eps: 1, pcie8: 2, sata: 4 })], [{ store: 's3', sku: '2', title: 'Fonte XYZ 500W 80 Plus Bronze ATX' }]);
    expect(plain.values.modular).toBe('Não');
    expect(plain.origin.modular).toEqual({ store: 's3', sku: '2', from: 'default' });
    expect(plain.missing).toEqual([]);
    // Só potência, eficiência e modular são principais; sem selo na página nem no título: sem certificação.
    const tfx = mergeSources('psu', [page('4', { watts: 500, standard: 'ATX' })], [{ store: 's3', sku: '4', title: 'Fonte BRX TFX 500W, Bivolt Manual, TFX500W MANUAL' }]);
    expect(tfx.values).toMatchObject({ efficiency: 'Sem certificação', modular: 'Não' });
    expect(tfx.missing).toEqual([]);
    // Sem página com ficha lida: sem padrão (a página ainda pode dizer).
    expect(mergeSources('psu', [], [{ store: 's3', sku: '3', title: 'Fonte XYZ 500W' }]).values.modular).toBeUndefined();
  });

  it('gabinete: só tamanho e placas-mãe são principais; sem ventoinhas na página nem no título, 0', () => {
    const m = mergeSources('case', [page('1', { mbFormats: 'ATX,Micro-ATX,Mini-ITX', maxGpuMm: 330 })], [{ store: 's3', sku: '1', title: 'Gabinete Gamer Rise Mode Galaxy, Mid Tower, Vidro Temperado, ATX, Preto' }]);
    expect(m.values).toMatchObject({ formFactor: 'Mid Tower', fansIncluded: 0 });
    expect(m.missing).toEqual([]);
  });

  it('a lista de produtos usa os títulos: o produto lido e incompleto fica completo pelo título', () => {
    const db = openDb(':memory:');
    const o = { ...offer('s3', '1'), title: 'Memória DDR5 Patriot Viper Venom, 8GB, 6000MHz, Preto, PVV58G600C40' };
    seen(db, 's3', 'ram', [o], NOW);
    savePage(db, { store: 's3', sku: '1', category: 'ram', text: 'Capacidade: 8GB\nFrequência: 6000 MHz\nLatência: CL40' });
    const [p] = catalogProducts(db, 'ram', SINCE);
    expect(p!.values.type).toBe('DDR5');
    expect(p!.state).toBe('complete');
  });
});
