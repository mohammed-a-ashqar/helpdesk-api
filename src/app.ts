import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config/env.js';
import { APP_VERSION } from './config/version.js';
import type { Container } from './container.js';
import { registerErrorHandling } from './http/error-handler.js';
import { registerOpenApi } from './http/openapi.js';
import { registerSecurity } from './http/security.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuses a well-formed incoming X-Request-Id (for tracing) or makes a new one. */
function requestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

export async function buildApp(config: AppConfig, container: Container): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(config.env === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
        : {}),
    },
    genReqId: requestId,
    trustProxy: config.server.trustProxy,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);
  await registerSecurity(app, { corsOrigins: config.http.corsOrigins });
  await registerOpenApi(app, APP_VERSION);

  await app.register(healthRoutes(container.health));
  await app.register(authRoutes(container.auth, config.auth));
  await app.register(usersRoutes(container.users, container.guards));

  return app;
}
