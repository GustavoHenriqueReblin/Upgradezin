/**
 * Confere as páginas de ficha vazia guardadas com DEBUG_DUMPS (data/debug/*-ficha-*.html): roda o
 * leitor da loja e o da ficha em cada uma e mostra o que saiu, para achar o que falta no leitor.
 *   pnpm sheet-dumps <pasta> [loja] [categoria] [--text]      (na pasta apps/server)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpecSheet, type CategoryId } from '@upgradezin/shared';
import { s1SheetFromHtml } from '../adapters/s1.ts';
import { s2SheetFromHtml } from '../adapters/s2.ts';
import { s3SheetFromHtml } from '../adapters/s3.ts';

const [dir, store, category] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const showText = process.argv.includes('--text');
const READ = { s1: s1SheetFromHtml, s2: s2SheetFromHtml, s3: s3SheetFromHtml } as const;
const strip = (h: string) => h.replace(/<br\s*\/?>/gi, ' | ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const counts = new Map<string, number>();
for (const f of readdirSync(dir!).filter((x) => x.endsWith('.html'))) {
  const m = f.match(/-(s[123])-ficha-([a-z]+)-(.+)\.html$/);
  if (!m || (store && m[1] !== store) || (category && m[2] !== category)) continue;
  const [, st, cat, sku] = m as unknown as [string, keyof typeof READ, CategoryId, string];
  const html = readFileSync(join(dir!, f), 'utf8');
  const sheet = READ[st](html);
  const parsed = sheet ? parseSpecSheet(cat, sheet) : null;
  const kind = !sheet ? 'sem bloco' : Object.keys(parsed!.specs).length ? 'LÊ AGORA' : 'bloco sem medida';
  counts.set(`${st} ${cat} ${kind}`, (counts.get(`${st} ${cat} ${kind}`) ?? 0) + 1);
  const title = html.match(/<title>([^<]*)/)?.[1]?.slice(0, 70) ?? '';
  console.log(`\n== ${st} ${cat} ${sku} [${kind}] ${title}`);
  if (parsed && Object.keys(parsed.specs).length) console.log('   specs:', JSON.stringify(parsed.specs));
  if (showText && sheet) console.log('   ' + strip(sheet).slice(0, 1500));
}
console.log('\n=== resumo');
for (const [k, n] of [...counts].sort()) console.log(`${String(n).padStart(4)}  ${k}`);
