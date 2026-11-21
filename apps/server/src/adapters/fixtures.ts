import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Páginas reais recortadas (só itens escolhidos e campos lidos). Ver apps/server/fixtures/README.md. */
export const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, '../../fixtures', name), 'utf8');

export const COLLECTED_AT = '2026-01-01T00:00:00.000Z';
