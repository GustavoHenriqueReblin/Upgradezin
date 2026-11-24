import { afterEach, describe, expect, it } from 'vitest';
import type { Offer } from '@upgradezin/shared';
import { usePageLoader } from '../browser.ts';
import { openDb, type Db } from '../db/db.ts';
import { getDb } from '../db/instance.ts';
import { useBackoffStorage } from '../pace.ts';
import { useStoreStorage } from '../stores.ts';
import { saveCollection } from './prices.ts';
import { webPrompt } from '@upgradezin/shared';
import { listSheetProducts } from '../admin/sheets.ts';
import { catalogProducts, productSheet, savePage, setManualSheet, sheetCoverage } from './sheets.ts';
import { askNextNow, askWeb, clearWebPause, googlePage, googleUrl, webAnswers, webFillStatus, webQueue } from './web-fill.ts';

afterEach(() => {
  usePageLoader(null);
  clearWebPause();
});

/**
 * Página do Modo IA: o pedido no título e na caixa de busca, e a resposta em blocos (o JSON quebrado em
 * linhas, com aspas como entidade).
 */
const aiPage = (question: string, reply?: object) =>
  `<html><head><title>${question} - Pesquisa Google</title></head><body><textarea>${question}</textarea>` +
  `<script>var x = "não sou um robô";</script>` +
  (reply ? `<div><pre>${JSON.stringify(reply, null, 2).replace(/"/g, '&quot;').split('\n').join('</pre><pre>')}</pre></div>` : '<div>Não consegui encontrar.</div>') +
  '<div>As respostas da IA podem incluir erros.</div></body></html>';

describe('busca na web: página de resultados', () => {
  it('texto visível sem o título e a caixa de busca (que repetem o pedido); o JSON da resposta fica', () => {
    const { blocked, text } = googlePage(aiPage('PEDIDO {"produto":"X"}', { produto: 'X', altura_mm: 155, confianca: 'alta' }));
    expect(blocked).toBe(false);
    expect(text).not.toContain('PEDIDO');
    expect(text).toContain('"altura_mm": 155');
  });
  it('pedido de verificação: pelo endereço /sorry/ ou pelo aviso visível (não por um texto dentro de script)', () => {
    expect(googlePage('<html></html>', 'https://www.google.com/sorry/index?continue=x').blocked).toBe('verification');
    expect(googlePage('<html><body><div>Nossos sistemas detectaram tráfego incomum na sua rede.</div></body></html>').blocked).toBe('verification');
    expect(googlePage(aiPage('q')).blocked).toBe(false);
  });
  it('confirmação do Modo IA (com o pedido dentro da janela): reconhecida, e o pedido repetido não vira resposta', () => {
    const q = webPrompt('case', 'Gabinete Atx Msi Mag Pano 100r Pz ARGB Vidro Temperado Preto');
    const page = `<html><body><div>Continuar com esta pesquisa?</div><div>Consultas maliciosas podem resultar em ações não seguras ou nocivas.</div><div>${q}</div><div>Não</div><div>Sim, continuar</div></body></html>`;
    expect(googlePage(page)).toEqual({ blocked: 'confirmation', text: '' });
  });
  it('endereço do pedido: Modo IA', () => {
    expect(googleUrl('qual a altura?')).toBe('https://www.google.com/search?udm=50&hl=pt-BR&q=qual%20a%20altura%3F');
  });
});

describe('busca na web: fila, resposta e o que entra na ficha', () => {
  /** Gabinete lido na S1, só a web completa (falta o tamanho). */
  function caseDb(): Db {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    const db = openDb(':memory:');
    const offer = { store: 's1', storeSku: '1', title: 'Gabinete Gamer Pichau XYZ, Preto, PXG-100A', url: 'https://www.s1.example/produto/1', priceCash: 300, inStock: true, specs: {}, modelKey: 'case:1', collectedAt: '' } as Offer;
    saveCollection(db, { store: 's1', category: 'case', offers: [offer], at: new Date().toISOString() });
    savePage(db, { store: 's1', sku: '1', category: 'case', text: 'Placas-mãe: ATX, Micro-ATX\nDimensões: 450 x 210 x 480 mm' });
    return db;
  }
  const signal = () => new AbortController().signal;

  it('completo com opcional vazio também vai à web, depois dos que falta campo principal; com tudo preenchido (ou "não tem"), não vai', () => {
    const db = caseDb();
    // Um segundo gabinete, completo (tamanho e placas-mãe), mas sem as medidas: entra na fila, depois do incompleto.
    const offer2 = { store: 's1', storeSku: '2', title: 'Gabinete Gamer Outro ABC, Mid Tower, ATX', url: 'https://www.s1.example/produto/2', priceCash: 300, inStock: true, specs: {}, modelKey: 'case:2', collectedAt: '' } as Offer;
    saveCollection(db, { store: 's1', category: 'case', offers: [offer2], at: new Date().toISOString() });
    savePage(db, { store: 's1', sku: '2', category: 'case', text: 'Tipo: Mid Tower\nPlacas-mãe: ATX, Micro-ATX' });
    expect(webQueue(db).map((q) => q.title)).toEqual(['Gabinete Gamer Pichau XYZ, Preto, PXG-100A', 'Gabinete Gamer Outro ABC, Mid Tower, ATX']);
  });

  it('um pedido por produto com o JSON da categoria; os valores entram na ficha como "web" e o produto sai da fila', async () => {
    const db = caseDb();
    const [q] = webQueue(db);
    expect(q).toMatchObject({ category: 'case' });
    expect(q!.fields).toEqual(expect.arrayContaining(['formFactor', 'mbFormats', 'maxGpuMm', 'radiators']));
    expect(q!.question).toContain('do gabinete Pichau XYZ PXG-100A');
    const urls: string[] = [];
    usePageLoader(async (_s, url) => (
      urls.push(url),
      { html: aiPage(q!.question, { produto: 'Pichau XYZ', tamanho: 'Mid Tower', placa_de_video_max_mm: 380, confianca: 'alta' }), url, title: '' }
    ));
    const r = await askWeb(db, q!, signal());
    expect(r).toMatchObject({ status: 'ok', confidence: 'high', store: 's1' });
    expect(r!.fields.filter((f) => f.value !== undefined)).toEqual([
      { field: 'formFactor', value: 'Mid Tower' },
      { field: 'maxGpuMm', value: 380 },
    ]);
    expect(urls[0]).toContain('google.com/search?udm=50');
    const sheet = productSheet(db, 's1', '1')!;
    expect(sheet.values.formFactor).toBe('Mid Tower');
    expect(sheet.origin.formFactor).toEqual({ store: 's1', sku: '1', from: 'web' });
    // A página vale mais que a web: o 450 x 210 x 480 lido dela continua; o que faltava vem da web.
    expect(sheet.values.dimensions).toBe('450 x 210 x 480');
    expect(sheet.values.maxGpuMm).toBe(380);
    expect(sheet.missing).toEqual([]);
    expect(webQueue(db)).toEqual([]);
    expect(webFillStatus(db)).toMatchObject({ answered: 2, queue: 0 });
    // Lista paginada dos já perguntados, com filtros.
    const list = webAnswers(db, { page: 1 });
    expect(list).toMatchObject({ total: 1, items: [{ key: q!.key, confidence: 'high', status: 'ok' }] });
    expect(list.items[0]!.answer).toContain('"tamanho":"Mid Tower"');
    expect(list.items[0]!.fields[0]).toEqual({ field: 'formFactor', value: 'Mid Tower' }); // na ordem da ficha
    expect(webAnswers(db, { status: 'none' }).total).toBe(0);
    expect(webAnswers(db, { category: 'cooler' }).total).toBe(0);
    expect(webAnswers(db, { q: 'pichau' }).total).toBe(1);
  });

  it('confiança baixa ou sem o JSON: guarda sem valor (não pergunta de novo) e o tamanho entra estimado', async () => {
    const db = caseDb();
    // Antes de perguntar: sem estimativa (a web ainda pode responder).
    expect(productSheet(db, 's1', '1')!.values.formFactor).toBeUndefined();
    const q = webQueue(db)[0]!;
    usePageLoader(async (_s, url) => ({ html: aiPage(q.question, { produto: 'X', tamanho: 'Mini Tower', confianca: 'baixa' }), url, title: '' }));
    expect(await askWeb(db, q, signal())).toMatchObject({ status: 'none', confidence: 'low' });
    const sheet = productSheet(db, 's1', '1')!;
    expect(sheet.values.formFactor).toBe('Mid Tower'); // a estimativa, não o "Mini Tower" de confiança baixa
    expect(sheet.origin.formFactor).toMatchObject({ from: 'estimate' });
    expect(webQueue(db)).toEqual([]);
    expect(webFillStatus(db)).toMatchObject({ answered: 0, empty: q.fields.length });
  });

  it('refazer: apaga as respostas do produto e pergunta de novo', async () => {
    const db = caseDb();
    const q = webQueue(db)[0]!;
    usePageLoader(async (_s, url) => ({ html: aiPage(q.question), url, title: '' }));
    expect(await askWeb(db, q, signal())).toMatchObject({ status: 'none' });
    expect(webQueue(db)).toEqual([]);
    expect(await askNextNow(db)).toBeNull(); // nada na fila
    usePageLoader(async (_s, url) => ({ html: aiPage(q.question, { produto: 'X', tamanho: 'Mid Tower', confianca: 'alta' }), url, title: '' }));
    expect(await askNextNow(db, q.key)).toMatchObject({ key: q.key, status: 'ok' });
    expect(productSheet(db, 's1', '1')!.origin.formFactor).toMatchObject({ from: 'web' });
  });

  it('o buscador pede verificação: pausa a busca na web, não guarda (a pergunta volta depois)', async () => {
    const db = caseDb();
    usePageLoader(async () => ({ html: '<html></html>', url: 'https://www.google.com/sorry/index', title: '' }));
    expect(await askWeb(db, webQueue(db)[0]!, signal())).toMatchObject({ status: 'blocked' });
    expect(webFillStatus(db)).toMatchObject({ pauseReason: 'verification' });
    expect(webFillStatus(db).pausedUntil).not.toBeNull();
    expect(webQueue(db)).toHaveLength(1);
  });

  it('o Modo IA pede confirmação da pesquisa: pausa com esse motivo, não guarda', async () => {
    const db = caseDb();
    const q = webQueue(db)[0]!;
    usePageLoader(async (_s, url) => ({ html: `<html><body><div>Continuar com esta pesquisa?</div><div>${q.question}</div></body></html>`, url, title: '' }));
    expect(await askWeb(db, q, signal())).toMatchObject({ status: 'blocked' });
    expect(webFillStatus(db)).toMatchObject({ pauseReason: 'confirmation', answered: 0, empty: 0 });
    expect(webQueue(db)).toHaveLength(1);
  });
});

describe('precisa de você: a web não achou o que falta; preenchido à mão', () => {
  it('fica no filtro "precisa de você" e na cobertura; à mão, completa e vale mais que a página', async () => {
    useStoreStorage(getDb());
    useBackoffStorage([], () => {});
    const db = openDb(':memory:');
    const offer = { store: 's1', storeSku: '1', title: 'Gabinete Gamer Pichau XYZ, Preto, PXG-100A', url: 'https://www.s1.example/produto/1', priceCash: 300, inStock: true, specs: {}, modelKey: 'case:1', collectedAt: '' } as Offer;
    const now = new Date().toISOString();
    saveCollection(db, { store: 's1', category: 'case', offers: [offer], at: now });
    savePage(db, { store: 's1', sku: '1', category: 'case', text: 'Dimensões: 450 x 210 x 480 mm' });
    const q = webQueue(db)[0]!;
    usePageLoader(async (_s, url) => ({ html: aiPage(q.question, { produto: 'X', confianca: 'media' }), url, title: '' }));
    expect(await askWeb(db, q, new AbortController().signal)).toMatchObject({ status: 'none' });
    const since = new Date(Date.now() - 86_400_000).toISOString();
    // O tamanho entrou estimado; as placas-mãe, não: só uma pessoa completa.
    const [p] = catalogProducts(db, 'case', since);
    expect(p).toMatchObject({ state: 'incomplete', missing: ['mbFormats'], needsHuman: true });
    expect(sheetCoverage(db, since).find((r) => r.category === 'case')).toMatchObject({ needsHuman: 1 });
    expect(listSheetProducts(db, { category: 'case', state: 'manual' }).total).toBe(1);
    expect(listSheetProducts(db, { state: 'manual' })).toMatchObject({ total: 1, items: [{ category: 'case' }] }); // todas as categorias
    expect(webQueue(db)).toEqual([]); // não pergunta de novo sozinho
    // À mão: validado como na web (lista normalizada); valor fora do formato é recusado.
    expect(setManualSheet(db, p!.key, 'case', { mbFormats: 'atx, matx', maxGpuMm: 'grande', dimensions: '460 x 210 x 480' })).toEqual({ errors: ['maxGpuMm'] });
    const after = productSheet(db, 's1', '1')!;
    expect(after.values).toMatchObject({ mbFormats: 'ATX,Micro-ATX', dimensions: '460 x 210 x 480' });
    expect(after.origin.mbFormats).toMatchObject({ from: 'manual' });
    expect(after.origin.dimensions).toMatchObject({ from: 'manual' }); // vale mais que a página (450 x 210 x 480)
    expect(after.missing).toEqual([]);
    // Completa, mas com opcionais vazios que a web já foi perguntada: continua na revisão (quanto mais dado, melhor).
    expect(listSheetProducts(db, { category: 'case', state: 'manual' }).total).toBe(1);
    const [done] = catalogProducts(db, 'case', since);
    expect(done).toMatchObject({ state: 'complete', needsHuman: true });
    expect(done!.gaps).toContain('maxGpuMm');
    // null apaga: volta o da página.
    setManualSheet(db, p!.key, 'case', { dimensions: null });
    expect(productSheet(db, 's1', '1')!.values.dimensions).toBe('450 x 210 x 480');
  });
});
