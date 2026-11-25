import { createRequire } from 'node:module';

function loadSqlite(): typeof import('node:sqlite') {
  const emitWarning = process.emitWarning;
  // O módulo emite este aviso na primeira carga, sem um código próprio para filtrá-lo.
  process.emitWarning = (...args: unknown[]) => {
    if (args[0] === 'SQLite is an experimental feature and might change at any time' && args[1] === 'ExperimentalWarning') return;
    Reflect.apply(emitWarning, process, args);
  };
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
}

export const { DatabaseSync, backup } = loadSqlite();
export type DatabaseSync = import('node:sqlite').DatabaseSync;
