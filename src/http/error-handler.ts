import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError, type ErrorDetail } from '../shared/errors.js';
import { buildProblem, PROBLEM_CONTENT_TYPE, type Problem } from './problem.js';

/**
 * Maps every error to an RFC 7807 problem document. Expected errors
 * (AppError, validation, 4xx from Fastify plugins) keep their message;
 * anything else becomes an opaque 500 and is logged with its stack.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const problem = toProblem(error, request);
    if (problem.status >= 500) {
      request.log.error({ err: error }, 'request failed');
    }
    return sendProblem(reply, problem);
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(
      reply,
      buildProblem({
        status: 404,
        code: 'route-not-found',
        detail: `Route ${request.method} ${request.url} does not exist.`,
        instance: request.url,
        requestId: request.id,
      }),
    ),
  );
}

function sendProblem(reply: FastifyReply, problem: Problem): FastifyReply {
  return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

function toProblem(error: FastifyError, request: FastifyRequest): Problem {
  const base = { instance: request.url.split('?')[0] ?? request.url, requestId: request.id };

  if (error instanceof AppError) {
    return buildProblem({
      ...base,
      status: error.status,
      code: error.code,
      title: error.title,
      detail: error.message,
      errors: error.errors,
    });
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const errors: ErrorDetail[] = error.validation.map((issue) => ({
      path: formatPath(error.validationContext, issue.instancePath),
      message: issue.message ?? 'Invalid value',
    }));
    return buildProblem({
      ...base,
      status: 400,
      code: 'validation-error',
      title: 'Validation Failed',
      detail: 'The request is invalid. See `errors` for details.',
      errors,
    });
  }

  if (!isResponseSerializationError(error) && isClientError(error.statusCode)) {
    return buildProblem({
      ...base,
      status: error.statusCode,
      code: error.statusCode === 429 ? 'rate-limited' : 'bad-request',
      detail: error.message,
    });
  }

  return buildProblem({
    ...base,
    status: 500,
    code: 'internal-error',
    detail: 'An unexpected error occurred.',
  });
}

function isClientError(status: number | undefined): status is number {
  return status !== undefined && status >= 400 && status < 500;
}

function formatPath(context: string | undefined, instancePath: string): string {
  const segments = instancePath.split('/').filter(Boolean);
  return [context, ...segments].filter(Boolean).join('.');
}
