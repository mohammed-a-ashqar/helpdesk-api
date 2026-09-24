import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Schema = typeof schema;

/**
 * Driver-agnostic database type. Production uses node-postgres, the test
 * suite uses PGlite (in-process Postgres); both satisfy this interface.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

/** Anything that can run queries: the database itself or an open transaction. */
export type DbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export interface DatabaseHandle {
  db: Database;
  close(): Promise<void>;
}

export function createPostgresDatabase(connectionString: string, poolSize = 10): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max: poolSize });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
