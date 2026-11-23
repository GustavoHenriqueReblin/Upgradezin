import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Páginas reais recortadas (só itens escolhidos e campos lidos). Ver apps/server/fixtures/README.md. */
export const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, '../../fixtures', name), 'utf8');

export const COLLECTED_AT = '2026-01-01T00:00:00.000Z';

/**
 * Página N da lista de processadores da S1 (fixture s1-cpu.html, 6 páginas): os mesmos itens com o
 * código mudado pela página, para cada página trazer produtos diferentes (uma página que só repete o
 * que a volta já viu encerra a lista).
 */
export function s1CpuListPage(url: string): string {
  const page = new URL(url).searchParams.get('page_number') ?? '1';
  return fixture('s1-cpu.html').replace(/\\"code\\":(\d+)/g, (_m, code: string) => `\\"code\\":${code}${page.padStart(2, '0')}`);
}
