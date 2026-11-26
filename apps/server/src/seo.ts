import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  budgetGpuScore, CATEGORY_DEFS, cpuNeeded, cpuScore, effectiveCash, ENABLED_CATEGORIES, gpuPerf, isOwnRetailOffer, normalizeListing,
  productPath, sheetRows, type CategoryId, type Offer, type ProductPage, type StoreId,
} from '@upgradezin/shared';
import type { Db } from './db/db.ts';
import { NOT_BROKEN } from './prices/page-errors.ts';
import { productPage } from './prices/product-page.ts';
import { COMPARISONS, GPU_GUIDE } from './seo-guides.ts';
import { html, pageHtml, publicBody, publicLink } from './seo-html.ts';

const DAY = 86_400_000;
const PAGE_SIZE = 48;
const SITEMAP_SIZE = 5000;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const when = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const urlset = (urls: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${html(url)}</loc></url>`).join('')}</urlset>`;
const link = (path: string, text: string) => `<a href="${html(path)}">${html(text)}</a>`;
const list = (links: string[]) => `<ul>${links.map((item) => `<li>${item}</li>`).join('')}</ul>`;

type Comparison = (typeof COMPARISONS)[keyof typeof COMPARISONS];
type CatalogItem = { key: string; title: string; category: CategoryId; model: string | null; vram: number | null };
type PublicOptions = { getDb: () => Db; stores: () => readonly StoreId[]; origin: string; template: string };

function catalogItems(db: Db, stores: readonly StoreId[]): CatalogItem[] {
  if (!stores.length) return [];
  return db.prepare(`
    WITH items AS (
      SELECT product_key AS key, title, category,
        COALESCE(json_extract(offer, '$.specs.gpuModel'), json_extract(offer, '$.specs.cpuModel')) AS model,
        json_extract(offer, '$.specs.vram') AS vram,
        row_number() OVER (PARTITION BY product_key ORDER BY last_seen_at DESC, id DESC) AS position
      FROM listings WHERE store IN (${stores.map(() => '?').join(',')}) AND product_key IS NOT NULL
        AND length(product_key) BETWEEN 1 AND 200 AND last_seen_at >= ? AND ${NOT_BROKEN}
    )
    SELECT key, title, category, model, vram FROM items WHERE position = 1 ORDER BY title COLLATE NOCASE, key
  `).all(...stores, new Date(Date.now() - 90 * DAY).toISOString()) as CatalogItem[];
}

function freshOffers(page: ProductPage, now: number): { offer: Offer; price: number; url: string }[] {
  const byStore = new Map<StoreId, { offer: Offer; price: number; url: string }>();
  for (const offer of page.offers) {
    const url = publicLink(offer.url);
    const price = Math.round(effectiveCash(offer, now) * 100) / 100;
    const at = Date.parse(offer.collectedAt);
    if (!url || !offer.inStock || !isOwnRetailOffer(offer) || !Number.isFinite(price) || price <= 0 || !(at >= now - DAY && at <= now)) continue;
    const previous = byStore.get(offer.store);
    if (!previous || price < previous.price) byStore.set(offer.store, { offer, price, url });
  }
  return [...byStore.values()].sort((a, b) => a.price - b.price);
}

function productContent(page: ProductPage, origin: string, related: string[]) {
  const now = Date.now();
  const offers = freshOffers(page, now);
  const best = offers[0];
  const category = CATEGORY_DEFS[page.category].name;
  const specs = sheetRows(page.category, page.values).filter((row) => row.informed);
  const description = `Compare ofertas e veja a ficha técnica de ${page.title}. Consulte o histórico de preços no Upgradezin.`;
  const image = publicLink(page.image);
  const knownPrices = page.offers.filter(isOwnRetailOffer).flatMap((offer) =>
    offer.history && Number.isFinite(offer.history.min30) && offer.history.min30 > 0 ? [offer.history.min30] : []);
  const canonical = origin + productPath(page.key);
  return {
    title: `${page.title} | Preço e ficha técnica`, description, canonical, client: true,
    noindex: page.key.startsWith('id:'),
    data: best ? {
      '@context': 'https://schema.org', '@type': 'Product', name: page.title, description, url: canonical,
      ...(image && { image }), ...(best.offer.brand && { brand: { '@type': 'Brand', name: best.offer.brand } }),
      offers: { '@type': 'AggregateOffer', priceCurrency: 'BRL', lowPrice: best.price, highPrice: offers.at(-1)!.price, offerCount: offers.length },
    } : undefined,
    body: publicBody(`
      <p>${link(`/catalogo/${page.category}`, category)}</p><h1>${html(page.title)}</h1>
      ${image ? `<img src="${html(image)}" alt="${html(page.title)}" width="160" height="160">` : ''}
      <h2>Preços e ofertas</h2>
      ${best ? `<p>Menor preço à vista nas ofertas conferidas nas últimas 24 horas <strong>${money.format(best.price)}</strong>.</p>
        ${list(offers.map(({ offer, price, url }) => `${link(url, `Ver oferta por ${money.format(price)}`)} · Conferida em ${when.format(Date.parse(offer.collectedAt))}`))}`
        : '<p>Sem ofertas recentes em estoque vendidas pela própria loja.</p>'}
      ${knownPrices.length ? `<p>Menor preço registrado em 30 dias ${money.format(Math.min(...knownPrices))}.</p>` : ''}
      ${specs.length ? `<h2>Ficha técnica</h2><dl>${specs.map(({ label, value }) => `<dt>${html(label)}</dt><dd>${html(value)}</dd>`).join('')}</dl>` : ''}
      ${related.length ? `<h2>Guias e comparativos</h2>${list(related)}` : ''}
    `),
  };
}

function comparisonBody(guide: Comparison, items: CatalogItem[], loadProduct: (key: string) => ProductPage | undefined) {
  const specs = guide.titles.map((title) => normalizeListing(guide.kind, title).specs);
  const scores = specs.map((spec, i) => guide.kind === 'cpu' ? cpuScore(spec) : gpuPerf({ gpuModel: guide.models[i] }));
  const rows: [string, (string | number | undefined)[]][] = [['Índice estimado em Full HD', scores]];
  if (guide.kind === 'gpu') {
    const gpus = guide.models.map((gpuModel, i) => ({ gpuModel, vram: 'vram' in guide ? guide.vram[i] : 8 }));
    rows.push(['Memória de vídeo', gpus.map(({ vram }) => `${vram} GB`)]);
    for (const [res, label] of [['1440p', 'Quad HD'], ['4k', '4K']] as const) {
      rows.push([`Índice estimado em ${label}`, gpus.map((gpu) => budgetGpuScore(gpu, res))]);
    }
  } else {
    rows.push(['Soquete', specs.map((spec) => spec.socket?.toUpperCase())]);
  }
  const matching = guide.models.map((model, i) => items.filter((item) =>
    item.category === guide.kind && item.model?.toLowerCase() === model.toLowerCase()
    && (!('vram' in guide) || item.vram === guide.vram[i])).slice(0, 4));
  const sample = matching.flatMap((products) => products.slice(0, 1));
  const params = new URLSearchParams(sample.map(({ key }) => ['peca', key]));
  const now = Date.now();
  const options = matching.map((items) => items.map((item) => {
    const page = loadProduct(item.key);
    const best = page && freshOffers(page, now)[0];
    return { item, best };
  }));
  rows.push(['Menor preço entre os modelos abaixo', options.map((products) => {
    const prices = products.flatMap(({ best }) => best ? [best.price] : []);
    return prices.length ? money.format(Math.min(...prices)) : 'Sem oferta recente';
  })]);
  return `
    <p>${html(guide.advice)}</p>
    <div class="public-table"><table><thead><tr><th scope="col">O que comparar</th>
      ${guide.titles.map((item) => `<th scope="col">${html(item)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, values]) => `<tr><th scope="row">${html(label)}</th>${values.map((value) => `<td>${html(value ?? 'Sem estimativa')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <h2>Como ler os índices</h2>
    <p>Os índices estimam desempenho relativo. A referência em Full HD vale 100 para o Ryzen 5 5600 entre processadores e para a RTX 3060 de 12 GB entre placas de vídeo.
      Os índices de Quad HD e 4K usam ajustes do motor de recomendações e servem para comparar as placas na mesma resolução.</p>
    <h2>Preços e modelos no catálogo</h2>
    <p>Os preços vêm de ofertas à vista em estoque conferidas nas últimas 24 horas. Cada peça tem seu próprio histórico e pode ter outras ofertas.</p>
    ${options.map((products, i) => `<h3>${html(guide.titles[i])}</h3>${products.length
      ? list(products.map(({ item, best }) => `${link(productPath(item.key), item.title)}${best
        ? ` · ${money.format(best.price)} · Conferida em ${when.format(Date.parse(best.offer.collectedAt))}` : ''}`))
      : '<p>Nenhum produto recente deste modelo no catálogo.</p>'}`).join('')}
    ${link(sample.length === 2 ? `/comparar?${params}` : '/comparar', 'Abrir comparador interativo')}
  `;
}

export function registerPublicPages(app: FastifyInstance, { getDb, stores, origin, template }: PublicOptions): void {
  let cached: { key: string; until: number; items: CatalogItem[] } | undefined;
  const catalog = () => {
    const active = stores();
    const key = active.join(',');
    if (!cached || cached.key !== key || cached.until < Date.now()) {
      cached = { key, until: Date.now() + 60_000, items: catalogItems(getDb(), active) };
    }
    return cached.items;
  };
  const compareLinks = Object.entries(COMPARISONS).map(([id, comparison]) => link(`/guias/${id}`, comparison.titles.join(' vs ')));
  const categories = () => {
    const available = new Set(catalog().map((item) => item.category));
    return available.size ? list(ENABLED_CATEGORIES.filter((id) => available.has(id)).map((id) => link(`/catalogo/${id}`, CATEGORY_DEFS[id].name)))
      : '<p>Consulte os guias de hardware enquanto o catálogo é atualizado.</p>';
  };
  const send = (reply: FastifyReply, page: Parameters<typeof pageHtml>[1]) => reply.type('text/html; charset=utf-8').send(pageHtml(template, page));
  const missing = (reply: FastifyReply) => send(reply.code(404), {
    title: 'Página não encontrada', description: 'Explore o catálogo do Upgradezin.', noindex: true,
    body: publicBody('<h1>Página não encontrada</h1><p>Veja outras peças no catálogo ou volte ao início.</p>'),
  });
  const info = (reply: FastifyReply, path: string, title: string, description: string, content: string) =>
    send(reply, { title, description, canonical: origin + path, body: publicBody(`<h1>${html(title)}</h1>${content}`) });

  app.get('/', (req, reply) => {
    const query = req.query as Record<string, unknown>;
    return send(reply, {
      title: 'Compare preços de hardware e monte seu PC', description: 'Compare peças, veja o histórico de preços e descubra o que vale trocar no seu PC.',
      canonical: origin + '/', client: true, noindex: !!query.categoria,
      body: publicBody(`<h1>Compare preços de hardware e monte seu PC</h1>
        <p>Veja ofertas no varejo brasileiro, fichas técnicas e comparações de desempenho para escolher o próximo upgrade.</p>
        <h2>Peças de computador</h2>${categories()}<h2>Guias de compra e desempenho</h2>${list([...compareLinks, link(GPU_GUIDE.path, GPU_GUIDE.title)])}`),
    });
  });
  app.get('/index.html', (_req, reply) => reply.redirect('/', 301));
  app.get('/produto/:key', (req, reply) => {
    const { key } = req.params as { key: string };
    const page = key.length <= 200 ? productPage(getDb(), key, stores()) : undefined;
    if (!page) return missing(reply);
    const model = page.category === 'cpu' ? page.offers[0]?.specs.cpuModel : page.offers[0]?.specs.gpuModel;
    const related = model ? Object.entries(COMPARISONS).filter(([, item]) =>
      item.kind === page.category && item.models.some((entry) => entry.toLowerCase() === model.toLowerCase()))
      .map(([id, item]) => link(`/guias/${id}`, item.titles.join(' vs '))) : [];
    return send(reply, productContent(page, origin, related));
  });
  app.get('/catalogo', (_req, reply) => info(reply, '/catalogo', 'Catálogo de hardware',
    'Explore peças de computador por categoria e compare preços, ofertas e fichas técnicas.', categories()));
  app.get('/catalogo/:category', (req, reply) => {
    const { category } = req.params as { category: CategoryId };
    const query = req.query as { pagina?: string };
    const page = query.pagina === undefined ? 1 : /^[1-9]\d{0,5}$/.test(query.pagina) ? Number(query.pagina) : 0;
    if (!ENABLED_CATEGORIES.includes(category) || !page) return missing(reply);
    const products = catalog().filter((item) => item.category === category);
    if (page > Math.max(1, Math.ceil(products.length / PAGE_SIZE)) || !products.length) return missing(reply);
    const path = (n: number) => `/catalogo/${category}${n > 1 ? `?pagina=${n}` : ''}`;
    const name = CATEGORY_DEFS[category].name;
    const links = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => link(productPath(item.key), item.title));
    return info(reply, path(page), `${name} | Preços e fichas${page > 1 ? ` | Página ${page}` : ''}`,
      `Encontre ${name.toLowerCase()} no catálogo do Upgradezin e consulte preços, histórico e ficha técnica.`,
      `<p>${link(`/?categoria=${category}`, 'Abrir busca com filtros')}</p>${list(links)}
      <nav aria-label="Páginas do catálogo">${page > 1 ? link(path(page - 1), 'Anterior') : ''}<span>Página ${page}</span>
      ${page * PAGE_SIZE < products.length ? link(path(page + 1), 'Próxima') : ''}</nav>`);
  });
  app.get('/guias', (_req, reply) => info(reply, '/guias', 'Guias de compra e comparativos de hardware',
    'Compare processadores, placas de vídeo e opções de upgrade para jogos.', list([...compareLinks, link(GPU_GUIDE.path, GPU_GUIDE.title)])));
  app.get('/guias/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const path = `/guias/${id}`;
    if (path === GPU_GUIDE.path) {
      const examples = ['RX 6600', 'RTX 4060', 'RX 7600'].map((model) => {
        const ratio = 100 / cpuNeeded(gpuPerf({ gpuModel: model })!, '1080p');
        return `<tr><th scope="row">${model}</th><td>${Math.round(ratio * 100)}%</td></tr>`;
      });
      return info(reply, path, GPU_GUIDE.title, 'Veja opções de placa de vídeo para o Ryzen 5 5600 em Full HD e como avaliar o equilíbrio do PC.', `
        <p>RX 6600, RTX 4060 e RX 7600 são pontos de partida para avaliar um upgrade em Full HD com o Ryzen 5 5600. Confirme a fonte e o espaço no gabinete antes de comprar.</p>
        <h2>Equilíbrio estimado em Full HD a 60 Hz</h2>
        <p>O índice divide o desempenho estimado do Ryzen pelo desempenho de CPU que cada GPU pede. Perto de 100% indica equilíbrio no modelo do Upgradezin.
          O jogo, a resolução e a taxa de atualização podem mudar o resultado.</p>
        <div class="public-table"><table><thead><tr><th scope="col">Placa de vídeo</th><th scope="col">Índice de equilíbrio</th></tr></thead>
        <tbody>${examples.join('')}</tbody></table></div>
        <p>${link('/gargalo', 'Analisar meu PC')} · ${link('/guias/rtx-4060-vs-rx-7600', 'Comparar RTX 4060 e RX 7600')} · ${link('/catalogo/gpu', 'Ver placas de vídeo')}</p>`);
    }
    const comparison = Object.hasOwn(COMPARISONS, id) ? COMPARISONS[id as keyof typeof COMPARISONS] : undefined;
    if (!comparison) return missing(reply);
    return info(reply, path, `${comparison.titles.join(' vs ')} | Qual escolher?`,
      `Compare ${comparison.titles.join(' e ')} em desempenho, ficha e opções de compra.`,
      comparisonBody(comparison, catalog(), (key) => productPage(getDb(), key, stores())));
  });
  const sitePaths = () => ['/', '/catalogo', '/guias', GPU_GUIDE.path, ...Object.keys(COMPARISONS).map((id) => `/guias/${id}`),
    ...[...new Set(catalog().map((item) => item.category))].filter((id) => ENABLED_CATEGORIES.includes(id)).map((id) => `/catalogo/${id}`)];
  const xml = (reply: FastifyReply, data: string) => reply.header('Cache-Control', 'public, max-age=300').type('application/xml; charset=utf-8').send(data);
  app.get('/sitemap.xml', (_req, reply) => {
    const children = ['/sitemap-paginas.xml', ...Array.from({ length: Math.ceil(catalog().length / SITEMAP_SIZE) }, (_, i) => `/sitemap-produtos-${i + 1}.xml`)];
    return xml(reply, `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children.map((path) => `<sitemap><loc>${html(origin + path)}</loc></sitemap>`).join('')}</sitemapindex>`);
  });
  app.get('/sitemap-paginas.xml', (_req, reply) => xml(reply, urlset(sitePaths().map((path) => origin + path))));
  app.get('/sitemap-produtos-:page.xml', (req, reply) => {
    const { page } = req.params as { page: string };
    const offset = /^[1-9]\d{0,5}$/.test(page) ? (Number(page) - 1) * SITEMAP_SIZE : -1;
    const items = catalog();
    if (offset < 0 || offset >= items.length) return missing(reply);
    return xml(reply, urlset(items.slice(offset, offset + SITEMAP_SIZE).map((item) => origin + productPath(item.key))));
  });
  app.get('/robots.txt', (_req, reply) => reply.type('text/plain; charset=utf-8').send(`User-agent: *\nDisallow: /api/admin/\n\nSitemap: ${origin}/sitemap.xml\n`));

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not-found' });
    const path = req.url.split('?')[0]!.replace(/\/$/, '');
    if (['/montagem', '/gargalo', '/orcamento', '/comparar', '/admin'].includes(path) || /^\/m\/[^/]+$/.test(path) || path.startsWith('/admin/')) {
      return reply.header('X-Robots-Tag', 'noindex').type('text/html; charset=utf-8').send(template);
    }
    return missing(reply);
  });
}
