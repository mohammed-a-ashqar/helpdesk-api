import type { Clock } from '../../src/shared/clock.js';

/** A controllable clock for deterministic time-based tests. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2025-01-06T09:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(value: Date | string): void {
    this.current = new Date(value);
  }

  advance({
    minutes = 0,
    hours = 0,
    seconds = 0,
  }: {
    minutes?: number;
    hours?: number;
    seconds?: number;
  }): void {
    this.current = new Date(
      this.current.getTime() + ((hours * 60 + minutes) * 60 + seconds) * 1000,
    );
  }
}
