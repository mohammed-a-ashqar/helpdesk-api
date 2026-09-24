/**
 * Source of "now". Everything time-sensitive (SLA due dates, token expiry,
 * audit timestamps) asks a Clock instead of calling `new Date()` directly,
 * so tests can control time precisely.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
