import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthConfig } from '../../config/env.js';
import { problemResponses } from '../../http/problem.js';
import { toUserDto } from '../users/users.schemas.js';
import {
  authResponseSchema,
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
} from './auth.schemas.js';
import type { AuthService, AuthSession } from './auth.service.js';

function toAuthResponse(session: AuthSession) {
  return {
    user: toUserDto(session.user),
    tokenType: 'Bearer' as const,
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
  };
}

export function authRoutes(auth: AuthService, config: AuthConfig): FastifyPluginAsyncZod {
  return async (app) => {
    // Brute-force protection: per-IP limit on every credential endpoint.
    const rateLimit = {
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.windowSeconds * 1000,
    };

    app.post(
      '/auth/register',
      {
        config: { rateLimit },
        schema: {
          tags: ['auth'],
          summary: 'Create a customer account and start a session',
          body: registerBodySchema,
          response: { 201: authResponseSchema, ...problemResponses(400, 409, 429) },
        },
      },
      async (request, reply) => {
        const session = await auth.register(request.body);
        return reply.status(201).send(toAuthResponse(session));
      },
    );

    app.post(
      '/auth/login',
      {
        config: { rateLimit },
        schema: {
          tags: ['auth'],
          summary: 'Exchange email and password for tokens',
          body: loginBodySchema,
          response: { 200: authResponseSchema, ...problemResponses(400, 401, 429) },
        },
      },
      async (request) => toAuthResponse(await auth.login(request.body)),
    );

    app.post(
      '/auth/refresh',
      {
        config: { rateLimit },
        schema: {
          tags: ['auth'],
          summary: 'Rotate a refresh token',
          description:
            'Returns a new access token and a new refresh token. The presented refresh token ' +
            'is consumed; presenting it again revokes the whole session.',
          body: refreshBodySchema,
          response: { 200: authResponseSchema, ...problemResponses(400, 401, 429) },
        },
      },
      async (request) => toAuthResponse(await auth.refresh(request.body.refreshToken)),
    );

    app.post(
      '/auth/logout',
      {
        config: { rateLimit },
        schema: {
          tags: ['auth'],
          summary: 'Revoke the session a refresh token belongs to',
          body: refreshBodySchema,
          response: { 204: z.null().describe('Session revoked'), ...problemResponses(400, 429) },
        },
      },
      async (request, reply) => {
        await auth.logout(request.body.refreshToken);
        return reply.status(204).send(null);
      },
    );
  };
}
