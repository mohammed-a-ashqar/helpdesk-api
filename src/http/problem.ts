import { STATUS_CODES } from 'node:http';
import { z } from 'zod';
import type { ErrorDetail } from '../shared/errors.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 7807 "problem details" body returned for every error. */
export const problemSchema = z
  .object({
    type: z.string().describe('Stable identifier of the problem type'),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string().describe('Request path that produced the problem'),
    requestId: z.string(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('Field-level validation errors'),
  })
  .describe('RFC 7807 problem details');

export type Problem = z.infer<typeof problemSchema>;

export function problemType(code: string): string {
  return `urn:problem-type:${code}`;
}

export function buildProblem(input: {
  status: number;
  code: string;
  detail: string;
  instance: string;
  requestId: string;
  title?: string;
  errors?: ErrorDetail[] | undefined;
}): Problem {
  return {
    type: problemType(input.code),
    title: input.title ?? STATUS_CODES[input.status] ?? 'Error',
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    requestId: input.requestId,
    ...(input.errors ? { errors: input.errors } : {}),
  };
}

/** Documents error responses of a route in the OpenAPI spec. */
export function problemResponses<const S extends readonly number[]>(
  ...statuses: S
): Record<S[number], typeof problemSchema> {
  return Object.fromEntries(statuses.map((status) => [status, problemSchema])) as Record<
    S[number],
    typeof problemSchema
  >;
}
