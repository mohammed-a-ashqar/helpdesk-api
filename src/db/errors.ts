const UNIQUE_VIOLATION = '23505';

/** True when a query failed on a unique constraint (drivers may wrap the error). */
export function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ((current as Error & { code?: unknown }).code === UNIQUE_VIOLATION) {
      return true;
    }
  }
  return false;
}
