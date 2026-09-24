import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HealthService } from './health.service.js';

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number().int(),
  checks: z.object({ database: z.enum(['up', 'down']) }),
});

export function healthRoutes(health: HealthService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/health',
      {
        schema: {
          tags: ['health'],
          summary: 'Liveness and database readiness',
          response: { 200: healthSchema, 503: healthSchema },
        },
      },
      async (_request, reply) => {
        const report = await health.check();
        return reply.status(report.status === 'ok' ? 200 : 503).send(report);
      },
    );
  };
}
