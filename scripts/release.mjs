#!/usr/bin/env node
// Nova versão: atualiza o "version" de todos os package.json e abre a seção no CHANGELOG.
//   pnpm release 0.2.0
// Depois: revisar o CHANGELOG, commitar, criar a tag e enviar (os comandos aparecem no fim).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['package.json', 'apps/server/package.json', 'apps/web/package.json', 'packages/shared/package.json'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const next = process.argv[2];
const current = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const parse = (v) => v.match(SEMVER).slice(1).map(Number);
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

if (!next || !SEMVER.test(next)) {
  console.error(`Uso: pnpm release <versão>   (ex. pnpm release 0.2.0; atual: ${current})`);
  process.exit(1);
}
if (!newer(next, current)) {
  console.error(`A versão nova (${next}) precisa ser maior que a atual (${current}).`);
  process.exit(1);
}

// Troca só o valor do campo, mantendo a formatação de cada arquivo.
for (const file of PACKAGES) {
  const path = resolve(root, file);
  const text = readFileSync(path, 'utf8');
  if (!/"version":\s*"[^"]*"/.test(text)) throw new Error(`${file} sem campo "version"`);
  writeFileSync(path, text.replace(/"version":\s*"[^"]*"/, `"version": "${next}"`));
}

// CHANGELOG: o que estava em "Não lançado" vira a versão nova, com a data de hoje.
const changelog = resolve(root, 'CHANGELOG.md');
const today = new Date().toISOString().slice(0, 10);
const log = readFileSync(changelog, 'utf8');
if (!log.includes('## [Não lançado]')) throw new Error('CHANGELOG.md sem a seção "## [Não lançado]"');
writeFileSync(changelog, log.replace('## [Não lançado]', `## [Não lançado]\n\n## [${next}] - ${today}`));

console.log(`Versão ${current} → ${next}. Revise o CHANGELOG.md e depois:`);
console.log(`  git commit -am "Release ${next}"`);
console.log(`  git tag -a v${next} -m "v${next}"`);
console.log('  git push --follow-tags');
