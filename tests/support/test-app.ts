import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { defaultSlaPolicy } from '../../src/config/sla.js';
import { createContainer, type Container } from '../../src/container.js';
import { createLogger } from '../../src/logger.js';
import { FakeClock } from './fake-clock.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

export function testConfig(overrides: { authRateLimitMax?: number } = {}): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, trustProxy: false },
    logLevel: 'silent',
    http: { corsOrigins: ['https://app.example.com'] },
    databaseUrl: 'postgres://unused:unused@localhost:5432/unused',
    auth: {
      accessTokenSecret: 'integration-test-secret-with-more-than-32-chars',
      // Long-lived so tests that fast-forward the fake clock keep their sessions;
      // expiry itself is covered by the token service unit tests.
      accessTokenTtlSeconds: 30 * 24 * 3600,
      refreshTokenTtlSeconds: 14 * 24 * 3600,
      rateLimit: { max: overrides.authRateLimitMax ?? 1000, windowSeconds: 60 },
      // Cheap hashing keeps the suite fast; production uses the OWASP baseline.
      argon2: { memoryCost: 1024, timeCost: 1 },
    },
    sla: defaultSlaPolicy,
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
export async function createTestApp(
  overrides: Parameters<typeof testConfig>[0] = {},
): Promise<TestApp> {
  const config = testConfig(overrides);
  const database = await createTestDatabase();
  const clock = new FakeClock();
  const container = createContainer({
    config,
    db: database.db,
    clock,
    logger: createLogger(config),
  });
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
