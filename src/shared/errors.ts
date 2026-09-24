export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Base class for errors that are safe to expose to API clients. The HTTP
 * layer turns them into RFC 7807 problem documents; anything that is not an
 * AppError is treated as an unexpected 500 and its message is hidden.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    detail: string,
    readonly errors?: ErrorDetail[],
  ) {
    super(detail);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(detail: string, errors?: ErrorDetail[]) {
    super(400, 'bad-request', 'Bad Request', detail, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Authentication is required to access this resource.') {
    super(401, 'unauthorized', 'Unauthorized', detail);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'You do not have permission to perform this action.') {
    super(403, 'forbidden', 'Forbidden', detail);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      404,
      'not-found',
      'Not Found',
      id === undefined ? `${resource} not found.` : `${resource} ${id} not found.`,
    );
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, code = 'conflict', title = 'Conflict') {
    super(409, code, title, detail);
  }
}

export class UnprocessableError extends AppError {
  constructor(detail: string, code = 'unprocessable', title = 'Unprocessable Content') {
    super(422, code, title, detail);
  }
}
