import { config } from '../config.ts';
import { openDb, type Db } from './db.ts';

let db: Db | undefined;

/** Banco do servidor, aberto na primeira vez que alguém precisa. */
export function getDb(): Db {
  db ??= openDb(config.DB_PATH);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}
