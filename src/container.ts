import type { AppConfig } from './config/env.js';
import type { Database } from './db/client.js';
import { UnitOfWork } from './db/unit-of-work.js';
import { AuthService } from './modules/auth/auth.service.js';
import { Argon2PasswordHasher } from './modules/auth/password-hasher.js';
import { TokenService } from './modules/auth/token.service.js';
import { HealthService } from './modules/health/health.service.js';
import type { Clock } from './shared/clock.js';

export interface ContainerOptions {
  config: AppConfig;
  db: Database;
  clock: Clock;
}

const TOKEN_ISSUER = 'helpdesk-api';

/**
 * Composition root: the only place that knows how concrete classes are
 * wired together. Everything else receives its collaborators through
 * constructor parameters.
 */
export function createContainer({ config, db, clock }: ContainerOptions) {
  const uow = new UnitOfWork(db);

  const passwordHasher = new Argon2PasswordHasher(config.auth.argon2);
  const tokens = new TokenService(
    {
      accessTokenSecret: config.auth.accessTokenSecret,
      accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: config.auth.refreshTokenTtlSeconds,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_ISSUER,
    },
    clock,
  );

  return {
    clock,
    uow,
    tokens,
    passwordHasher,
    health: new HealthService(db),
    auth: new AuthService(uow, passwordHasher, tokens, clock),
  };
}

export type Container = ReturnType<typeof createContainer>;
