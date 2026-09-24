import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadConfig } from '../config/env.js';
import { MIGRATIONS_FOLDER } from './migrations.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  process.stdout.write('Migrations applied.\n');
} finally {
  await pool.end();
}
