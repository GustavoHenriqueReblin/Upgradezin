import { describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { openDb } from '../db/db.ts';
import { saveCollection } from '../prices/prices.ts';
import { BUILD_ID, getSharedBuild, newBuildId, saveSharedBuild, SharedBuildSchema } from './builds.ts';

const offer = (priceCash: number, collectedAt: string, patch: Partial<Offer> = {}): Offer => ({
  store: 's1',
  storeSku: '123',
  title: 'Memória Teste 8GB DDR4',
  url: 'https://www.s1.example/produto/123',
  priceCash,
  inStock: true,
  seller: 'S1',
  marketplace: false,
  openbox: false,
  specs: { memory: 'ddr4', ramCapacity: 8 },
  modelKey: 'ram:teste',
  collectedAt,
  ...patch,
});

const build = (o: Offer) => ({ ram: { key: 'ram:teste', title: o.title, specs: o.specs, offers: [o], qty: 2 } });

describe('montagem compartilhada', () => {
  it('grava e carrega todos os discos, incluindo os que a pessoa já tem', () => {
    const db = openDb(':memory:');
    const at = '2026-11-19T10:00:00.000Z';
    const disk = { ...build(offer(200, at)).ram, qty: undefined, key: 'ssd:teste', specs: { ssdInterface: 'sata' } };
    const id = saveSharedBuild(db, SharedBuildSchema.parse({
      ssd: disk, extraDrives: [{ ...disk, key: 'pc:ssd:0', current: true, offers: [] }],
    }));
    expect(getSharedBuild(db, id)?.build).toMatchObject({ ssd: { key: 'ssd:teste' }, extraDrives: [{ key: 'pc:ssd:0', current: true }] });
    expect(SharedBuildSchema.safeParse({ extraDrives: [] }).success).toBe(false);
    db.close();
  });
  it('código curto, só letras e números', () => {
    const id = newBuildId();
    expect(id).toHaveLength(8);
    expect(BUILD_ID.test(id)).toBe(true);
    expect(BUILD_ID.test('../etc')).toBe(false);
  });

  it('valida: recusa montagem vazia, link que não é https e quantidade fora da faixa', () => {
    expect(SharedBuildSchema.safeParse(build(offer(200, '2026-11-19T10:00:00.000Z'))).success).toBe(true);
    expect(SharedBuildSchema.safeParse({}).success).toBe(false);
    expect(SharedBuildSchema.safeParse(build(offer(200, '2026-11-19T10:00:00.000Z', { url: 'javascript:alert(1)' }))).success).toBe(false);
    expect(SharedBuildSchema.safeParse(build(offer(200, '2026-11-19T10:00:00.000Z', { image: 'http://x.example/a.png' }))).success).toBe(false);
    const b = build(offer(200, '2026-11-19T10:00:00.000Z'));
    expect(SharedBuildSchema.safeParse({ ram: { ...b.ram, qty: 9 } }).success).toBe(false);
  });

  it('salva e abre; ao abrir, troca a oferta pela mais recente do banco', () => {
    const db = openDb(':memory:');
    const data = SharedBuildSchema.parse(build(offer(200, '2026-11-19T10:00:00.000Z')));
    const id = saveSharedBuild(db, data, '2026-11-19T10:05:00.000Z');
    expect(getSharedBuild(db, id)).toMatchObject({ createdAt: '2026-11-19T10:05:00.000Z', build: { ram: { qty: 2, offers: [{ priceCash: 200 }] } } });

    // A rotina coletou o mesmo anúncio depois, com preço novo.
    saveCollection(db, {
      store: 's1',
      category: 'ram',
      offers: [offer(180, '2026-11-20T08:00:00.000Z')],
      at: '2026-11-20T08:00:00.000Z',
    });
    expect(getSharedBuild(db, id)?.build.ram?.offers[0]).toMatchObject({ priceCash: 180, collectedAt: '2026-11-20T08:00:00.000Z' });

    expect(getSharedBuild(db, 'naoexiste')).toBeNull();
  });
});
