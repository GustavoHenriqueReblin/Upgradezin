import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Offer } from '@upgradezin/shared';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/db.ts';
import { ensureTerms, idOf, priceHistory, readResult, saveCollection } from '../prices/prices.ts';
import { Concurrency, Limiter } from '../security.ts';
import { ActivityLog, personOf } from './activity.ts';
import { applyMerge, Backups, MergeUploads, previewMerge } from './backup.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'uz-admin-'));

const offer = (sku: string, price: number, store: Offer['store'] = 's2'): Offer =>
  ({ store, storeSku: sku, title: `Placa ${sku}`, url: `https://x.example/${sku}`, priceCash: price, inStock: true, specs: {}, modelKey: `m${sku}`, collectedAt: '' }) as Offer;

describe('atividade', () => {
  it('apelido estável na mesma subida, sem o IP; guarda as últimas, mais recentes primeiro', () => {
    expect(personOf('1.2.3.4')).toBe(personOf('1.2.3.4'));
    expect(personOf('1.2.3.4')).not.toBe(personOf('1.2.3.5'));
    expect(personOf('1.2.3.4')).not.toContain('1.2.3');
    const log = new ActivityLog(2);
    const e = (term: string, ip: string) => log.record({ at: term, ip, category: 'gpu', terms: [term], stores: ['s1'], text: false, force: false });
    e('a', '1.1.1.1');
    e('b', '2.2.2.2');
    e('c', '1.1.1.1');
    expect(log.recent().map((r) => r.terms[0])).toEqual(['c', 'b']);
    expect(log.people()).toBe(2);
    expect(JSON.stringify(log.recent())).not.toContain('1.1.1.1');
  });

  it('limites: quem está no limite; conexões abertas no total', () => {
    const l = new Limiter(2, 60_000);
    l.take('a', 0);
    l.take('a', 1);
    l.take('b', 2);
    expect(l.atLimit(10)).toBe(1);
    expect(l.atLimit(70_000)).toBe(0); // janela passou
    const c = new Concurrency(3);
    c.acquire('x');
    c.acquire('x');
    c.acquire('y');
    expect(c.total()).toBe(3);
    c.release('x');
    expect(c.total()).toBe(2);
  });
});

describe('backups', () => {
  it('cria cópia comprimida que abre como banco, lista, acha pelo nome e apaga', async () => {
    const dir = tmp();
    const db = openDb(join(dir, 'app.db'));
    ensureTerms(db, [{ category: 'gpu', term: 'NVIDIA GeForce' }], 'seed');
    const backups = new Backups(join(dir, 'backups'));
    const b = await backups.create(db, 'manual');
    expect(b.name).toMatch(/^manual-\d{4}-\d{2}-\d{2}-\d{6}\.db\.gz$/);
    expect(backups.list().map((x) => x.name)).toEqual([b.name]);
    // O conteúdo é um banco SQLite de verdade, com os dados.
    const restored = join(dir, 'restaurado.db');
    writeFileSync(restored, gunzipSync(readFileSync(backups.path(b.name)!)));
    expect(openDb(restored).prepare('SELECT term FROM search_terms').all()).toEqual([{ term: 'NVIDIA GeForce' }]);
    expect(backups.remove(b.name)).toBe(true);
    expect(backups.list()).toEqual([]);
  });

  it('nome com caminho ou extensão errada não acha nada', () => {
    const backups = new Backups(tmp());
    for (const name of ['../app.db', '..\\app.db', 'a/b.db', 'x.txt', '.db', 'nao-existe.db']) expect(backups.path(name)).toBeNull();
    expect(backups.remove('../app.db')).toBe(false);
  });
});

describe('envio para merge', () => {
  it('aceita SQLite (.db ou .gz), recusa o resto, expira', () => {
    const dir = tmp();
    const src = join(dir, 'src.db');
    openDb(src).close();
    const raw = readFileSync(src);
    const up = new MergeUploads(join(dir, 'tmp'), 1000);
    const a = up.add(raw, 0);
    expect('id' in a && up.get(a.id, 10)).toBeTruthy();
    const g = up.add(gzipSync(raw), 0);
    expect('id' in g && readFileSync(up.get(g.id, 10)!).subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(up.add(Buffer.from('não é banco'), 0)).toEqual({ error: 'Não é um banco SQLite (.db ou .db.gz).' });
    expect(up.add(Buffer.from([0x1f, 0x8b, 1, 2, 3]), 0)).toEqual({ error: 'Arquivo .gz corrompido.' });
    expect('id' in a && up.get(a.id, 5000)).toBeNull(); // passou de 1 s
  });
});

describe('merge', () => {
  it('traz o que só a fonte tem: anúncios, histórico, termos, coletas; oferta mais recente vale; não duplica', () => {
    const dir = tmp();
    const target = openDb(join(dir, 'server.db'));
    const srcPath = join(dir, 'local.db');
    const source = openDb(srcPath);
    const T = { category: 'gpu' as const, term: 'NVIDIA GeForce' };

    // Servidor: anúncio 1 visto às 10h a R$ 1000.
    const tIds = ensureTerms(target, [T], 'seed');
    saveCollection(target, { store: 's2', category: 'gpu', termId: idOf(tIds, T), offers: [offer('1', 1000)], at: '2026-11-20T10:00:00.000Z', complete: true });
    // Local: o mesmo anúncio às 12h a R$ 900, um anúncio novo, e um termo que o servidor não tem.
    const sIds = ensureTerms(source, [T, { category: 'gpu', term: 'Zotac RTX 3050' }], 'seed');
    saveCollection(source, { store: 's2', category: 'gpu', termId: idOf(sIds, T), offers: [offer('1', 900), offer('2', 1500)], at: '2026-11-20T12:00:00.000Z', complete: true });
    source.close();

    expect(previewMerge(target, srcPath)).toEqual({ newListings: 1, newerListings: 1, newPricePoints: 2, newTerms: 1, newerRuns: 1, newerSheets: 0 });
    expect(applyMerge(target, srcPath)).toMatchObject({ newListings: 1, newPricePoints: 2 });

    const tId = idOf(ensureTerms(target, [T], 'seed'), T);
    const result = readResult(target, 's2', tId);
    expect(result.at).toBe('2026-11-20T12:00:00.000Z'); // coleta mais recente vale
    expect(result.offers.map((o) => [o.storeSku, o.priceCash]).sort()).toEqual([['1', 900], ['2', 1500]]);
    expect(priceHistory(target, 's2', '1').map((p) => p.priceCash)).toEqual([1000, 900]); // histórico das duas
    expect(target.prepare('SELECT count(*) AS n FROM search_terms').get()).toEqual({ n: 2 });
    // De novo: nada mais a trazer.
    expect(previewMerge(target, srcPath)).toEqual({ newListings: 0, newerListings: 0, newPricePoints: 0, newTerms: 0, newerRuns: 0, newerSheets: 0 });
  });

  it('banco em outra migração: recusa sem mexer', () => {
    const dir = tmp();
    const target = openDb(join(dir, 'server.db'));
    const srcPath = join(dir, 'old.db');
    const old = openDb(srcPath);
    old.exec('PRAGMA user_version = 3');
    old.close();
    expect(() => previewMerge(target, srcPath)).toThrow(/migração 3/);
    expect(() => applyMerge(target, srcPath)).toThrow(/migração 3/);
    // O ATTACH foi desfeito: dá para usar o banco normalmente.
    expect(target.prepare("SELECT count(*) AS n FROM pragma_database_list WHERE name = 'src'").get()).toEqual({ n: 0 });
  });
});
