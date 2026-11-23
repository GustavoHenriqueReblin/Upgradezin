import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * goto da extensão (extension/control.js) numa aba que já estava numa página: até o documento novo
 * entrar, a aba responde com o anterior, já pronto. O script roda num contexto com um Chrome falso.
 */
const OLD = 'https://www.s2.example/hardware/placa-de-video';
const NEW = 'https://www.s2.example/hardware/memorias';

function fakeTab(steps: { status: 'loading' | 'complete'; url: string }[]) {
  // Cada chrome.tabs.get depois do update avança um passo (o último fica).
  let doc = { status: 'complete' as 'loading' | 'complete', url: OLD };
  let i = -1;
  const advance = () => {
    if (i >= 0 && i < steps.length) doc = steps[i]!;
    if (i >= 0) i++;
  };
  const location = { search: '', get href() { return doc.url; } };
  const ctx: Record<string, unknown> = {
    URLSearchParams,
    URL,
    setTimeout,
    console,
    location,
    document: {
      getElementById: () => ({ textContent: '' }),
      get readyState() { return doc.status === 'loading' ? 'interactive' : 'complete'; },
    },
    fetch: async () => ({ status: 204 }),
    chrome: {
      tabs: {
        get: async () => {
          advance();
          return { status: doc.status, url: doc.url, title: '' };
        },
        update: async () => {
          i = 0;
        },
      },
      scripting: {
        // O documento que responde ainda é o anterior enquanto a aba carrega.
        executeScript: async ({ func, args }: { func: (...a: unknown[]) => unknown; args?: unknown[] }) => [{ result: func(...(args ?? [])) }],
      },
    },
  };
  vm.createContext(ctx);
  const src = readFileSync(join(import.meta.dirname, '../extension/control.js'), 'utf8');
  vm.runInContext(`${src}\n;globalThis.__ops = ops;`, ctx);
  return ctx.__ops as { goto(a: { tabId: number; url: string; timeout: number }): Promise<{ loaded: boolean; url: string }> };
}

describe('extensão: goto numa aba já aberta', () => {
  it('espera o documento novo, em vez de ler o anterior (a categoria lida antes)', async () => {
    const ops = fakeTab([
      { status: 'complete', url: OLD },
      { status: 'complete', url: OLD },
      { status: 'loading', url: OLD },
      { status: 'loading', url: NEW },
      { status: 'complete', url: NEW },
    ]);
    const r = await ops.goto({ tabId: 1, url: NEW, timeout: 5000 });
    expect(r).toMatchObject({ loaded: true, url: NEW });
  });

  it('página nova que volta ao endereço antigo: aceita depois de ver carregar, sem esperar o tempo todo', async () => {
    const ops = fakeTab([
      { status: 'loading', url: OLD },
      { status: 'complete', url: OLD },
    ]);
    const t0 = Date.now();
    const r = await ops.goto({ tabId: 1, url: NEW, timeout: 5000 });
    expect(r).toMatchObject({ loaded: true, url: OLD });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
