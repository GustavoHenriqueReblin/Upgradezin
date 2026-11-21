import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import type { ServerStatus } from '@upgradezin/shared';
import type { Db } from '../db/db.ts';

export type { ServerStatus };

/** Só o nome do arquivo, em Windows ou Linux (o caminho da máquina não vai para a tela). */
export const baseName = (path: string): string => path.split(/[\\/]/).pop()!;

const startedAt = new Date();
const mb = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;
const sizeOf = (file: string) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

let commit: string | null | undefined;
/** Commit em que o servidor está (lido uma vez; null fora de um repositório git). */
function currentCommit(): string | null {
  if (commit === undefined) {
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim() || null;
    } catch {
      commit = null;
    }
  }
  return commit;
}

export function serverStatus(db: Db, info: { version: string; browserOpen: boolean; activeSessions: number }, now = Date.now()): ServerStatus {
  const file = (db.prepare("SELECT file FROM pragma_database_list WHERE name = 'main'").get() as { file: string } | undefined)?.file ?? '';
  const migration = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const mem = process.memoryUsage();
  return {
    version: info.version,
    commit: currentCommit(),
    startedAt: startedAt.toISOString(),
    uptimeS: Math.round((now - startedAt.getTime()) / 1000),
    node: process.version,
    memory: { rssMb: mb(mem.rss), heapMb: mb(mem.heapUsed), systemFreeMb: mb(freemem()), systemTotalMb: mb(totalmem()) },
    db: { file: file ? baseName(file) : ':memory:', sizeMb: mb(file ? sizeOf(file) : 0), walMb: mb(file ? sizeOf(`${file}-wal`) : 0), migration },
    browserOpen: info.browserOpen,
    activeSessions: info.activeSessions,
  };
}
