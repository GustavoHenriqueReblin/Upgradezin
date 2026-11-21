import { describe, expect, it } from 'vitest';
import { isFormTerm } from '@upgradezin/shared';
import { openDb } from './db/db.ts';
import { findSharedBuild, saveSharedBuild, SharedBuildSchema } from './builds/builds.ts';
import { clientIp, Concurrency, Limiter } from './security.ts';

describe('segurança', () => {
  it('limite por janela: conta só o que passou, libera quando a janela anda', () => {
    const l = new Limiter(2, 1000);
    expect([l.take('a', 0), l.take('a', 100), l.take('a', 200)]).toEqual([true, true, false]);
    expect(l.take('b', 200)).toBe(true); // outra pessoa
    expect(l.take('a', 1050)).toBe(true); // o primeiro saiu da janela
  });

  it('abertos ao mesmo tempo', () => {
    const c = new Concurrency(2);
    expect([c.acquire('a'), c.acquire('a'), c.acquire('a')]).toEqual([true, true, false]);
    c.release('a');
    expect(c.acquire('a')).toBe(true);
  });

  it('IP real do cloudflared só quando a conexão é local', () => {
    expect(clientIp({ ip: '127.0.0.1', headers: { 'cf-connecting-ip': '200.1.2.3' } })).toBe('200.1.2.3');
    expect(clientIp({ ip: '10.0.0.5', headers: { 'cf-connecting-ip': '200.1.2.3' } })).toBe('10.0.0.5');
    expect(clientIp({ ip: '127.0.0.1', headers: {} })).toBe('127.0.0.1');
  });

  it('busca aceita só os termos do formulário', () => {
    expect(isFormTerm('psu', '750W')).toBe(true);
    expect(isFormTerm('psu', '750w')).toBe(true);
    expect(isFormTerm('motherboard', 'DDR5')).toBe(true);
    expect(isFormTerm('psu', 'B550')).toBe(false); // termo de outra categoria
    expect(isFormTerm('psu', 'iphone 15')).toBe(false);
  });

  it('a mesma montagem compartilhada de novo reaproveita o link', () => {
    const db = openDb(':memory:');
    const data = SharedBuildSchema.parse({
      ram: {
        key: 'k',
        title: 'Memória Teste',
        specs: {},
        offers: [{ store: 's1', storeSku: '1', title: 't', url: 'https://www.s1.example/p/1', priceCash: 100, collectedAt: '2026-11-20T00:00:00.000Z' }],
      },
    });
    const id = saveSharedBuild(db, data);
    expect(findSharedBuild(db, data)).toBe(id);
    expect(saveSharedBuild(db, data)).toBe(id);
    const other = SharedBuildSchema.parse({ ...data, ram: { ...data.ram!, qty: 2 } });
    expect(saveSharedBuild(db, other)).not.toBe(id);
  });
});
