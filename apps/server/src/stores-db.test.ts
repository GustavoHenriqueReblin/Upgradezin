import type { AdminStoreInput } from '@upgradezin/shared';
import { describe, expect, it } from 'vitest';
import { openDb } from './db/db.ts';
import { ACTIVE_STORES, adminStores, publicStores, saveStoreConfig, searchUrl, storeConfig, useStoreStorage, validateStoreInput } from './stores.ts';

const VALID: AdminStoreInput = {
  enabled: true,
  name: 'Loja Nova',
  url: 'https://www.nova.example/',
  search: '/procura?termo={q+}',
  categories: { psu: 'Hardware/Fontes', gpu: '' },
  sweep: { psu: '/hardware/fontes' },
  colors: '#FFC300, #e30613',
};

describe('validação da loja (admin)', () => {
  it('aceita e normaliza: origem sem barra, categoria em minúsculas, vazios ignorados, cores', () => {
    const r = validateStoreInput('s1', VALID);
    expect(r).toEqual({
      config: {
        id: 's1',
        enabled: true,
        name: 'Loja Nova',
        url: 'https://www.nova.example',
        search: '/procura?termo={q+}',
        categories: { psu: 'hardware/fontes' },
        sweep: { psu: '/hardware/fontes' },
        colors: ['#ffc300', '#e30613'],
      },
    });
  });

  it.each([
    ['nome vazio', { name: '  ' }, 'Nome'],
    ['site sem https', { url: 'http://www.nova.example' }, 'Site'],
    ['site com caminho', { url: 'https://www.nova.example/loja' }, 'Site'],
    ['site com usuário', { url: 'https://a:b@www.nova.example' }, 'Site'],
    ['site inválido', { url: 'nova' }, 'Site'],
    ['busca sem marcador', { search: '/busca?q=' }, 'Busca'],
    ['busca sem / no começo', { search: 'busca/{slug}' }, 'Busca'],
    ['busca para outra origem', { search: '//outro.example/{q}' }, 'Busca'],
    ['varredura para outra origem', { sweep: { psu: 'https://outro.example/x' } }, 'Varredura'],
    ['varredura sem /', { sweep: { psu: 'hardware/fontes' } }, 'Varredura'],
    ['cor inválida', { colors: 'vermelho' }, 'Cor'],
  ])('recusa %s', (_, patch, field) => {
    const r = validateStoreInput('s1', { ...VALID, ...patch } as AdminStoreInput);
    expect('errors' in r && r.errors.some((e) => e.startsWith(field))).toBe(true);
  });

  it('sem cor: vale a cor padrão da tela (lista vazia)', () => {
    const r = validateStoreInput('s1', { ...VALID, colors: '' });
    expect('config' in r && r.config.colors).toEqual([]);
  });
});

describe('lojas no banco', () => {
  it('primeira vez: copia as lojas do .env; depois o banco manda, mesmo com o .env diferente', () => {
    const db = openDb(':memory:');
    expect(useStoreStorage(db, '2026-11-20T00:00:00.000Z')).toBe(3);
    expect(ACTIVE_STORES).toEqual(['s1', 's2', 's3']);
    expect(storeConfig('s1')).toMatchObject({ name: 'Loja S1', url: 'https://www.s1.example', colors: ['#ff6500'] });

    process.env.STORE_S1_NAME = 'Mudou no .env';
    // "Reinício": não copia de novo, lê do banco.
    expect(useStoreStorage(db)).toBe(0);
    expect(storeConfig('s1').name).toBe('Loja S1');
    process.env.STORE_S1_NAME = 'Loja S1';
  });

  it('salvar no admin vale na hora (buscas, lista pública) e fica gravado', () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    const r = saveStoreConfig(db, 's2', { ...VALID, name: 'Loja Dois' }, '2026-11-21T10:00:00.000Z');
    expect('config' in r).toBe(true);
    expect(searchUrl('s2', 'psu', '750W')).toBe('https://www.nova.example/procura?termo=fonte+750W');
    expect(publicStores().find((s) => s.id === 's2')).toEqual({
      id: 's2',
      name: 'Loja Dois',
      search: 'https://www.nova.example/procura?termo={q+}',
      color: '#ffc300',
      colors: ['#ffc300', '#e30613'],
    });
    expect(adminStores(db).find((s) => s.id === 's2')).toMatchObject({ configured: true, name: 'Loja Dois', updatedAt: '2026-11-21T10:00:00.000Z' });
    // Outra instância lendo o mesmo banco vê o salvo.
    useStoreStorage(db);
    expect(storeConfig('s2').name).toBe('Loja Dois');
  });

  it('salvar com erro não muda nada', () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    const before = storeConfig('s3');
    expect(saveStoreConfig(db, 's3', { ...VALID, url: 'ftp://x' })).toHaveProperty('errors');
    expect(storeConfig('s3')).toEqual(before);
  });

  it('desligar tira a loja das buscas e da lista pública, mas guarda a configuração', () => {
    const db = openDb(':memory:');
    useStoreStorage(db);
    saveStoreConfig(db, 's3', { ...VALID, enabled: false });
    expect(ACTIVE_STORES).toEqual(['s1', 's2']);
    expect(publicStores().map((s) => s.id)).toEqual(['s1', 's2']);
    expect(() => storeConfig('s3')).toThrow();
    expect(adminStores(db).find((s) => s.id === 's3')).toMatchObject({ configured: true, enabled: false, name: 'Loja Nova' });
    saveStoreConfig(db, 's3', { ...VALID, enabled: true });
    expect(ACTIVE_STORES).toEqual(['s1', 's2', 's3']);
  });

  it('a lista ACTIVE_STORES é a mesma referência (quem guardou vê a mudança)', () => {
    const db = openDb(':memory:');
    const ref = ACTIVE_STORES;
    useStoreStorage(db);
    saveStoreConfig(db, 's1', { ...VALID, enabled: false });
    expect(ref).not.toContain('s1');
    expect(ref).toBe(ACTIVE_STORES);
  });
});
