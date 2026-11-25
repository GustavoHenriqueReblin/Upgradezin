import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('carrega o SQLite sem silenciar outros avisos do Node', () => {
  const moduleUrl = new URL('./sqlite.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module'], {
    input: `import { DatabaseSync } from ${JSON.stringify(moduleUrl)};
      const db = new DatabaseSync(':memory:');
      db.close();
      process.emitWarning('Aviso de teste', 'ExperimentalWarning');`,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '0' },
  });
  expect(child.status).toBe(0);
  expect(child.stderr).not.toContain('SQLite is an experimental feature');
  expect(child.stderr).toContain('ExperimentalWarning: Aviso de teste');
});
