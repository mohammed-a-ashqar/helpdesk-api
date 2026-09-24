import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database, DatabaseHandle } from '../../src/db/client.js';
import { MIGRATIONS_FOLDER } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';

export interface TestDatabase extends DatabaseHandle {
  /** Removes all rows so each test starts from an empty, migrated schema. */
  reset(): Promise<void>;
}

/**
 * Boots an in-memory Postgres (PGlite, compiled to WASM) and applies the
 * same migrations production uses. No database server is required.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: MIGRATIONS_FOLDER });
  const db: Database = pglite;

  return {
    db,
    close: () => client.close(),
    reset: async () => {
      await db.execute(
        sql`truncate table ticket_activities, ticket_comments, tickets, refresh_tokens, agent_categories, users restart identity cascade`,
      );
    },
  };
}
