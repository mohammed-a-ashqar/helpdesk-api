import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableError,
} from '../../../src/shared/errors.js';

describe('application errors', () => {
  it.each([
    [new UnauthorizedError(), 401, 'unauthorized'],
    [new ForbiddenError(), 403, 'forbidden'],
    [new NotFoundError('Ticket', 'abc'), 404, 'not-found'],
    [new ConflictError('Already exists.'), 409, 'conflict'],
    [new UnprocessableError('Nope.'), 422, 'unprocessable'],
  ])('%s maps to HTTP %i', (error, status, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });

  it('builds a readable not-found message', () => {
    expect(new NotFoundError('Ticket', 'abc').message).toBe('Ticket abc not found.');
    expect(new NotFoundError('User').message).toBe('User not found.');
  });

  it('keeps the subclass name', () => {
    expect(new ConflictError('x').name).toBe('ConflictError');
  });
});
