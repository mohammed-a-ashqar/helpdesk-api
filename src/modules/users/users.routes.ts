import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf, bearerSecurity, type AuthGuards } from '../../http/auth-guard.js';
import { pageOf, toPageResponse } from '../../http/pagination.js';
import { problemResponses } from '../../http/problem.js';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  toUserDto,
  updateUserBodySchema,
  userIdParamsSchema,
  userSchema,
} from './users.schemas.js';
import type { UsersService, UserView } from './users.service.js';

const present = ({ user, categories }: UserView) => toUserDto(user, categories);

export function usersRoutes(users: UsersService, guards: AuthGuards): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/users/me',
      {
        onRequest: guards.authenticate,
        schema: {
          tags: ['users'],
          summary: 'The authenticated user',
          security: bearerSecurity,
          response: { 200: userSchema, ...problemResponses(401) },
        },
      },
      async (request) => present(await users.get(actorOf(request).userId)),
    );

    app.get(
      '/users',
      {
        onRequest: guards.requireRole('admin'),
        schema: {
          tags: ['users'],
          summary: 'List users (admin)',
          security: bearerSecurity,
          querystring: listUsersQuerySchema,
          response: { 200: pageOf(userSchema), ...problemResponses(400, 401, 403) },
        },
      },
      async (request) => {
        const { page, pageSize, ...filter } = request.query;
        const result = await users.list(filter, { page, pageSize });
        return toPageResponse(result, { page, pageSize }, present);
      },
    );

    app.post(
      '/users',
      {
        onRequest: guards.requireRole('admin'),
        schema: {
          tags: ['users'],
          summary: 'Create a user with any role (admin)',
          security: bearerSecurity,
          body: createUserBodySchema,
          response: { 201: userSchema, ...problemResponses(400, 401, 403, 409, 422) },
        },
      },
      async (request, reply) => reply.status(201).send(present(await users.create(request.body))),
    );

    app.patch(
      '/users/:id',
      {
        onRequest: guards.requireRole('admin'),
        schema: {
          tags: ['users'],
          summary: 'Update role, status, name or categories (admin)',
          description: 'Deactivating a user also revokes all of their refresh tokens.',
          security: bearerSecurity,
          params: userIdParamsSchema,
          body: updateUserBodySchema,
          response: { 200: userSchema, ...problemResponses(400, 401, 403, 404, 409, 422) },
        },
      },
      async (request) =>
        present(await users.update(actorOf(request), request.params.id, request.body)),
    );
  };
}
