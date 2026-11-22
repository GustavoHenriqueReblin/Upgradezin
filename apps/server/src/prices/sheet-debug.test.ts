import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { usePageLoader } from '../browser.ts';
import { config } from '../config.ts';
import { useBackoffStorage } from '../pace.ts';
import { sheetOf } from './collect.ts';

const original = { DEBUG_DUMPS: config.DEBUG_DUMPS, DATA_DIR: config.DATA_DIR };
afterEach(() => {
  Object.assign(config, original);
  usePageLoader(null);
});

/** Página de produto da S1: a ficha (informações técnicas) e um marcador para achar a página inteira no arquivo. */
const page = (text: string) =>
  `<html><body><h1>PÁGINA INTEIRA</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product: { technicalInformation: { text } } } } })}</script></body></html>`;

function setup(debug: boolean, sheetText: string) {
  const dir = mkdtempSync(join(tmpdir(), 'uz-debug-'));
  Object.assign(config, { DEBUG_DUMPS: debug, DATA_DIR: dir });
  useBackoffStorage([], () => {});
  usePageLoader(async (_store, url) => ({ html: page(sheetText), url, title: '' }));
  return () => {
    try {
      return readdirSync(join(dir, 'debug')).map((f) => ({ name: f, html: readFileSync(join(dir, 'debug', f), 'utf8') }));
    } catch {
      return [];
    }
  };
}

const run = (sku: string) => sheetOf('s1', sku, 'gpu', new AbortController().signal, { origin: 'admin', force: true });

describe('ficha vazia: guarda a página para conferir (DEBUG_DUMPS)', () => {
  it('sem medida nenhuma: salva a página inteira em data/debug, com loja, categoria e código no nome', async () => {
    const files = setup(true, '<p>Garantia: 3 meses</p>');
    expect((await run('901'))!.specs).toEqual({});
    const [f] = files();
    expect(f!.name).toMatch(/-s1-ficha-gpu-901\.html$/);
    expect(f!.html).toContain('PÁGINA INTEIRA'); // a página toda, não só o campo da ficha
  });

  it('com medida: não salva', async () => {
    const files = setup(true, '<p>Dimensões: 250 x 120 x 40 mm</p>');
    expect((await run('902'))!.specs.gpuLength).toBe(250);
    expect(files()).toEqual([]);
  });

  it('DEBUG_DUMPS desligado (padrão): não salva nada', async () => {
    const files = setup(false, '<p>Garantia: 3 meses</p>');
    await run('903');
    expect(files()).toEqual([]);
  });
});
