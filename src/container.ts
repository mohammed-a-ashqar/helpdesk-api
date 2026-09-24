import type { AppConfig } from './config/env.js';
import type { Database } from './db/client.js';
import { HealthService } from './modules/health/health.service.js';
import type { Clock } from './shared/clock.js';

export interface ContainerOptions {
  config: AppConfig;
  db: Database;
  clock: Clock;
}

/**
 * Composition root: the only place that knows how concrete classes are
 * wired together. Everything else receives its collaborators through
 * constructor parameters.
 */
export function createContainer({ db, clock }: ContainerOptions) {
  const health = new HealthService(db);

  return { clock, health };
}

export type Container = ReturnType<typeof createContainer>;
