import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config/env.js';
import type { Database } from './db/client.js';
import { UnitOfWork } from './db/unit-of-work.js';
import { createAuthGuards } from './http/auth-guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { Argon2PasswordHasher } from './modules/auth/password-hasher.js';
import { TokenService } from './modules/auth/token.service.js';
import { HealthService } from './modules/health/health.service.js';
import { TicketsService } from './modules/tickets/tickets.service.js';
import { UsersService } from './modules/users/users.service.js';
import type { Clock } from './shared/clock.js';
import type { DomainEvents } from './shared/events/domain-events.js';
import { EventBus } from './shared/events/event-bus.js';

export interface ContainerOptions {
  config: AppConfig;
  db: Database;
  clock: Clock;
  logger: FastifyBaseLogger;
}

const TOKEN_ISSUER = 'helpdesk-api';

/**
 * Composition root: the only place that knows how concrete classes are
 * wired together. Everything else receives its collaborators through
 * constructor parameters.
 */
export function createContainer({ config, db, clock, logger }: ContainerOptions) {
  const uow = new UnitOfWork(db);
  const events = new EventBus<DomainEvents>((error, eventName) => {
    logger.error({ err: error, eventName }, 'domain event listener failed');
  });

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
    logger,
    uow,
    events,
    tokens,
    passwordHasher,
    guards: createAuthGuards(tokens, uow.repositories.users),
    health: new HealthService(db),
    auth: new AuthService(uow, passwordHasher, tokens, clock),
    users: new UsersService(uow, passwordHasher, clock),
    tickets: new TicketsService(uow, clock, config.sla, events),
  };
}

export type Container = ReturnType<typeof createContainer>;
