/**
 * Instala a extensão leitora no Chrome de cada loja (uma vez só; o perfil fica em data/chrome/<loja>).
 *   pnpm chrome-setup                 -> lojas s2 e s3
 *   pnpm chrome-setup --stores=s2
 *
 * Abre o Chrome da loja na página de extensões; você ativa o "Modo do desenvolvedor", clica em
 * "Carregar sem compactação" e escolhe a pasta da extensão. Depois o script confere se conectou.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import type { StoreId } from '@upgradezin/shared';
import { closeBrowser } from '../browser.ts';
import { EXTENSION_DIR, EXTENSION_ID, ensureExtBrowser, profileDir } from '../browser-ext.ts';
import { config } from '../config.ts';

const arg = process.argv.find((a) => a.startsWith('--stores='))?.slice('--stores='.length);
const stores = (arg ? arg.split(/[\s,]+/).filter(Boolean) : ['s2', 's3']) as StoreId[];

console.log(`Pasta da extensão: ${EXTENSION_DIR}`);
console.log(`ID esperado:       ${EXTENSION_ID}\n`);

for (const store of stores) {
  const dir = profileDir(store);
  mkdirSync(dir, { recursive: true });
  spawn(config.CHROME_PATH, [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'chrome://extensions'], { stdio: 'ignore', detached: true }).unref();
  console.log(`[${store}] Chrome aberto (perfil ${dir}). Nele:`);
}
console.log(`
  1. Ative "Modo do desenvolvedor" (canto superior direito).
  2. Clique em "Carregar sem compactação" e escolha a pasta:
     ${EXTENSION_DIR}
  3. Confira que aparece "Upgradezin Leitor" com o ID ${EXTENSION_ID}.
  4. Feche essa janela do Chrome.

Faça isso em cada janela aberta (uma por loja).`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question('\nQuando terminar e fechar as janelas, aperte Enter para conferir… ');
rl.close();

let ok = true;
for (const store of stores) {
  try {
    await ensureExtBrowser(store, ['--window-size=900,600']);
    console.log(`[${store}] extensão conectada.`);
  } catch (err) {
    ok = false;
    console.log(`[${store}] NÃO conectou: ${(err as Error).message}`);
  }
}
await closeBrowser();
console.log(ok ? '\nPronto: as lojas já podem ser lidas.' : '\nAlguma loja não conectou; rode de novo.');
process.exit(ok ? 0 : 1);
