import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export interface SecurityOptions {
  /** Allowed browser origins. Empty disables CORS entirely. */
  corsOrigins: readonly string[];
}

export async function registerSecurity(
  app: FastifyInstance,
  options: SecurityOptions,
): Promise<void> {
  await app.register(helmet);

  await app.register(cors, {
    origin: options.corsOrigins.length > 0 ? [...options.corsOrigins] : false,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['x-request-id'],
  });

  // Limits are opted into per route (see the auth routes) rather than global.
  await app.register(rateLimit, { global: false });
}
