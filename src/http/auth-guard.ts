import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { TokenService } from '../modules/auth/token.service.js';
import type { Role } from '../modules/users/domain/role.js';
import type { UsersRepository } from '../modules/users/users.repository.js';
import type { Actor } from '../shared/actor.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guard; null on public routes. */
    actor: Actor | null;
  }
}

export interface AuthGuards {
  /** Requires a valid bearer token belonging to an active user. */
  authenticate: onRequestAsyncHookHandler;
  /** Requires authentication and one of the given roles. */
  requireRole(...roles: Role[]): onRequestAsyncHookHandler;
}

export function createAuthGuards(tokens: TokenService, users: UsersRepository): AuthGuards {
  async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match?.[1]) {
      throw new UnauthorizedError('A bearer access token is required.');
    }
    const claims = await tokens.verifyAccessToken(match[1]);

    // Re-read the user so deactivation and role changes apply immediately,
    // not only once the (short-lived) access token expires.
    const user = await users.findById(claims.userId);
    if (!user?.isActive) {
      throw new UnauthorizedError('The account is disabled or no longer exists.');
    }
    request.actor = { userId: user.id, role: user.role };
  }

  return {
    authenticate,
    requireRole(...roles) {
      return async function requireRole(request, reply) {
        await authenticate(request, reply);
        if (!request.actor || !roles.includes(request.actor.role)) {
          throw new ForbiddenError();
        }
      };
    },
  };
}

/** The authenticated actor of a guarded route. */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new UnauthorizedError();
  }
  return request.actor;
}

export const bearerSecurity = [{ bearerAuth: [] }];
