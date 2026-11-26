import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { normalizeListing, productPath, type Offer, type StoreId } from '@upgradezin/shared';
import { openDb } from './db/db.ts';
import { saveCollection } from './prices/prices.ts';
import { registerPublicPages } from './seo.ts';
import { registerSecurity } from './security.ts';

const origin = 'https://upgradezin.com.br';
const template = '<!doctype html><html lang="pt-BR"><head><title>Upgradezin</title><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';

function setup() {
  const db = openDb(':memory:');
  const app = Fastify();
  registerSecurity(app);
  registerPublicPages(app, { getDb: () => db, stores: () => ['s1', 's2'], origin, template });
  const add = (key: string | null, store: StoreId, sku: string, title: string, priceCash: number, days = 0, extra: Partial<Offer> = {}) => {
    const at = new Date(Date.now() - days * 86_400_000).toISOString();
    const offer: Offer = { ...normalizeListing('gpu', title), title, store, storeSku: sku, inStock: true, priceCash, seller: store, marketplace: false, openbox: false,
      collectedAt: at, url: `https://${store}.example/${sku}`, ...extra };
    saveCollection(db, { store, category: 'gpu', offers: [offer], at });
    db.prepare('UPDATE listings SET product_key = ? WHERE store = ? AND store_sku = ?').run(key, store, sku);
  };
  return { db, app, add, close: async () => { await app.close(); db.close(); } };
}

it('entrega produto, ficha e preço no HTML inicial e protege o texto vindo do catálogo', async () => {
  const { app, add, close } = setup();
  try {
    const key = 'gpu:4060&8';
    const title = 'GeForce RTX 4060 8GB </script><script>alert(1)</script>';
    add(key, 's1', 'a', title, 1600);
    add(key, 's1', 'b', title, 1700);
    add(key, 's2', 'c', title, 1200, 2);
    add(key, 's2', 'd', title, 1100, 0, { marketplace: true });
    add(key, 's2', 'e', title, 1000, 0, { url: 'javascript:alert(1)' });
    add(key, 's3', 'f', title, 900);
    const response = await app.inject({ url: productPath(key), headers: { host: 'provisorio.example' } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`rel="canonical" href="${origin + productPath(key)}"`);
    expect(response.body).toContain('Ficha técnica');
    expect(response.body).toMatch(/<div id="root"><\/div><noscript>[\s\S]*Ficha técnica[\s\S]*<\/noscript>/);
    expect(response.body).toContain('&lt;/script&gt;');
    expect(response.body).not.toContain('<script>alert(1)');
    expect(response.body).not.toContain('javascript:');
    expect(response.body).toContain('type="module"');
    const data = JSON.parse(response.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!);
    expect(data).toMatchObject({ name: title, offers: { '@type': 'AggregateOffer', priceCurrency: 'BRL', lowPrice: 1600, highPrice: 1600, offerCount: 1 } });
    add('gpu:antiga', 's1', 'old', 'RTX 4060 8GB', 1450, 2);
    expect((await app.inject(productPath('gpu:antiga'))).body).not.toContain('application/ld+json');
  } finally { await close(); }
});

it('publica catálogo paginado, guias e sitemaps sem incluir URLs de sessão ou busca livre', async () => {
  const { app, add, close } = setup();
  try {
    for (let i = 1; i <= 49; i++) add(`gpu:${i}`, 's1', `a${i}`, `GeForce RTX 4060 8GB Modelo ${String(i).padStart(2, '0')}`, 1600);
    add('gpu:1', 's2', 'duplicate', 'GeForce RTX 4060 8GB Modelo 01', 1700);
    add('gpu:7600', 's1', 'rx', 'Radeon RX 7600 8GB', 1400);
    add('gpu:inactive', 's3', 'off', 'GeForce RTX 4060 8GB', 1600);
    add('gpu:old', 's1', 'old', 'Radeon RX 7600 8GB', 1400, 100);
    const home = await app.inject('/');
    expect(home.body).toContain('href="/catalogo/gpu"');
    expect(home.body).toMatch(/<div id="root"><\/div><noscript>[\s\S]*Guias de compra e desempenho[\s\S]*<\/noscript>/);
    const category = await app.inject('/catalogo/gpu');
    expect(category.body).toContain('href="/catalogo/gpu?pagina=2"');
    expect(category.body).not.toContain('type="module"');
    expect(category.body).toContain('<div id="root"><main');
    expect((await app.inject('/catalogo/gpu?pagina=2')).body).toContain('Modelo 49');
    expect((await app.inject('/catalogo/gpu?pagina=3')).statusCode).toBe(404);
    const guide = await app.inject('/guias/rtx-4060-vs-rx-7600');
    expect(guide.body).toContain('<td>110</td><td>112</td>');
    expect(guide.body).toContain('href="/comparar?peca=gpu%3A1&amp;peca=gpu%3A7600"');
    expect((await app.inject('/guias/ryzen-5-5600-vs-core-i5-12400f')).body).toMatch(/<td>100<\/td><td>\d+<\/td>/);
    expect((await app.inject('/guias/placa-de-video-para-ryzen-5-5600')).body).toContain('href="/gargalo"');
    expect((await app.inject('/sitemap.xml')).body).toContain(`${origin}/sitemap-produtos-1.xml`);
    const products = await app.inject('/sitemap-produtos-1.xml');
    expect(products.headers['content-type']).toContain('application/xml');
    expect(products.body.match(/<url>/g)).toHaveLength(50);
    expect(products.body).not.toMatch(/inactive|gpu%3Aold/);
    expect((await app.inject('/sitemap-produtos-2.xml')).statusCode).toBe(404);
    expect((await app.inject('/sitemap-paginas.xml')).body).toContain(`${origin}/guias/rtx-4060-vs-rx-7600`);
    const robots = await app.inject('/robots.txt');
    expect(robots.body).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(robots.body).not.toMatch(/^Disallow: \/api\/$/m);
    expect((await app.inject('/api/inexistente')).headers['x-robots-tag']).toBe('noindex');
    expect((await app.inject('/index.html')).headers.location).toBe('/');
    for (const path of ['/admin', '/m/abc', '/comparar?peca=gpu%3A1', '/orcamento']) {
      const response = await app.inject(path);
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-robots-tag']).toBe('noindex');
    }
    expect((await app.inject('/?categoria=gpu')).body).toContain('content="noindex"');
    for (const path of ['/produto/inexistente', '/guias/toString', '/inexistente', '/api/inexistente']) expect((await app.inject(path)).statusCode).toBe(404);
  } finally { await close(); }
});
