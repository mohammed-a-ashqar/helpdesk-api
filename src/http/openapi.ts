import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI 3 document generated from the zod route schemas, served as JSON at
 * /docs/json and through Swagger UI at /docs.
 */
export async function registerOpenApi(app: FastifyInstance, version: string): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Helpdesk API',
        description:
          'Service-desk ticketing: ticket lifecycle, SLA tracking, assignment and role-based access.',
        version,
      },
      tags: [
        { name: 'health', description: 'Liveness and readiness' },
        { name: 'auth', description: 'Registration, login and token rotation' },
        { name: 'users', description: 'Profiles and user administration' },
        { name: 'tickets', description: 'Tickets, lifecycle and assignment' },
        { name: 'comments', description: 'Public replies and internal notes' },
        { name: 'sla', description: 'Service-level monitoring' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}
