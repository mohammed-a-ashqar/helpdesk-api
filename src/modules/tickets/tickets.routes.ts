import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, bearerSecurity, type AuthGuards } from '../../http/auth-guard.js';
import { pageOf, toPageResponse } from '../../http/pagination.js';
import { problemResponses } from '../../http/problem.js';
import { z } from 'zod';
import {
  activitySchema,
  createTicketBodySchema,
  listTicketsQuerySchema,
  parseSort,
  ticketIdParamsSchema,
  ticketSchema,
  toActivityDto,
  toTicketDto,
  transitionBodySchema,
  updateTicketBodySchema,
} from './tickets.schemas.js';
import type { TicketsService } from './tickets.service.js';

export function ticketsRoutes(tickets: TicketsService, guards: AuthGuards): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/tickets',
      {
        onRequest: guards.authenticate,
        schema: {
          tags: ['tickets'],
          summary: 'Raise a ticket',
          description: 'SLA due dates are derived from the priority at creation time.',
          security: bearerSecurity,
          body: createTicketBodySchema,
          response: { 201: ticketSchema, ...problemResponses(400, 401) },
        },
      },
      async (request, reply) => {
        const view = await tickets.create(actorOf(request), request.body);
        return reply.status(201).send(toTicketDto(view));
      },
    );

    app.get(
      '/tickets',
      {
        onRequest: guards.authenticate,
        schema: {
          tags: ['tickets'],
          summary: 'List tickets',
          description:
            'Staff see every ticket; customers only their own (requester filters are ignored).',
          security: bearerSecurity,
          querystring: listTicketsQuerySchema,
          response: { 200: pageOf(ticketSchema), ...problemResponses(400, 401) },
        },
      },
      async (request) => {
        const actor = actorOf(request);
        const { page, pageSize, sort, status, priority, category, assigneeId, ...rest } =
          request.query;
        const result = await tickets.list(
          actor,
          {
            ...rest,
            statuses: status,
            priorities: priority,
            categories: category,
            assigneeId:
              assigneeId === 'me' ? actor.userId : assigneeId === 'none' ? null : assigneeId,
          },
          parseSort(sort),
          { page, pageSize },
        );
        return toPageResponse(result, { page, pageSize }, toTicketDto);
      },
    );

    app.get(
      '/tickets/:id',
      {
        onRequest: guards.authenticate,
        schema: {
          tags: ['tickets'],
          summary: 'Get a ticket with its SLA status',
          security: bearerSecurity,
          params: ticketIdParamsSchema,
          response: { 200: ticketSchema, ...problemResponses(400, 401, 404) },
        },
      },
      async (request) => toTicketDto(await tickets.get(actorOf(request), request.params.id)),
    );

    app.patch(
      '/tickets/:id',
      {
        onRequest: guards.requireRole('agent', 'admin'),
        schema: {
          tags: ['tickets'],
          summary: 'Edit title, description, category or priority (staff)',
          security: bearerSecurity,
          params: ticketIdParamsSchema,
          body: updateTicketBodySchema,
          response: { 200: ticketSchema, ...problemResponses(400, 401, 403, 404) },
        },
      },
      async (request) =>
        toTicketDto(await tickets.update(actorOf(request), request.params.id, request.body)),
    );

    app.post(
      '/tickets/:id/transitions',
      {
        onRequest: guards.authenticate,
        schema: {
          tags: ['tickets'],
          summary: 'Move a ticket through its lifecycle',
          description:
            'Illegal moves (e.g. open -> closed) return 409. Legal moves the caller may not ' +
            'perform return 403. Requesters may reopen or close their resolved tickets.',
          security: bearerSecurity,
          params: ticketIdParamsSchema,
          body: transitionBodySchema,
          response: { 200: ticketSchema, ...problemResponses(400, 401, 403, 404, 409) },
        },
      },
      async (request) =>
        toTicketDto(
          await tickets.transition(actorOf(request), request.params.id, request.body.status),
        ),
    );

    app.get(
      '/tickets/:id/activity',
      {
        onRequest: guards.requireRole('agent', 'admin'),
        schema: {
          tags: ['tickets'],
          summary: 'Audit trail of a ticket (staff)',
          security: bearerSecurity,
          params: ticketIdParamsSchema,
          response: { 200: z.array(activitySchema), ...problemResponses(400, 401, 403, 404) },
        },
      },
      async (request) =>
        (await tickets.activity(actorOf(request), request.params.id)).map(toActivityDto),
    );
  };
}
