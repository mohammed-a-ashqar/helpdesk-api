import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf, bearerSecurity, type AuthGuards } from '../../../http/auth-guard.js';
import { problemResponses } from '../../../http/problem.js';
import { ticketIdParamsSchema, ticketSchema, toTicketDto } from '../tickets.schemas.js';
import type { AssignmentService } from './assignment.service.js';

const assignBodySchema = z.object({
  assigneeId: z.uuid().nullable().describe('An active agent or admin; null to unassign'),
});

export function assignmentRoutes(
  assignment: AssignmentService,
  guards: AuthGuards,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.put(
      '/tickets/:id/assignee',
      {
        onRequest: guards.requireRole('agent', 'admin'),
        schema: {
          tags: ['tickets'],
          summary: 'Assign or unassign a ticket (staff)',
          security: bearerSecurity,
          params: ticketIdParamsSchema,
          body: assignBodySchema,
          response: { 200: ticketSchema, ...problemResponses(400, 401, 403, 404, 409, 422) },
        },
      },
      async (request) =>
        toTicketDto(
          await assignment.assign(actorOf(request), request.params.id, request.body.assigneeId),
        ),
    );

    app.post(
      '/tickets/:id/auto-assign',
      {
        onRequest: guards.requireRole('agent', 'admin'),
        schema: {
          tags: ['tickets'],
          summary: 'Let the assignment strategy pick an agent (staff)',
          description:
            'Uses the configured strategy (least open tickets among active agents covering ' +
            'the ticket category). 409 when no agent is eligible.',
          security: bearerSecurity,
          params: ticketIdParamsSchema,
          response: { 200: ticketSchema, ...problemResponses(400, 401, 403, 404, 409) },
        },
      },
      async (request) =>
        toTicketDto(await assignment.autoAssign(actorOf(request), request.params.id)),
    );
  };
}
