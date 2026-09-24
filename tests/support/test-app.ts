import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { createContainer, type Container } from '../../src/container.js';
import { FakeClock } from './fake-clock.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

export function testConfig(): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, trustProxy: false },
    logLevel: 'silent',
    http: { corsOrigins: ['https://app.example.com'] },
    databaseUrl: 'postgres://unused:unused@localhost:5432/unused',
  };
}

export interface TestApp {
  app: FastifyInstance;
  container: Container;
  database: TestDatabase;
  clock: FakeClock;
  close(): Promise<void>;
}

/**
 * The real application wired against an in-process PGlite database and a
 * controllable clock. Requests go through `app.inject`, so no port is opened.
 */
export async function createTestApp(): Promise<TestApp> {
  const config = testConfig();
  const database = await createTestDatabase();
  const clock = new FakeClock();
  const container = createContainer({ config, db: database.db, clock });
  const app = await buildApp(config, container);
  await app.ready();

  return {
    app,
    container,
    database,
    clock,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
