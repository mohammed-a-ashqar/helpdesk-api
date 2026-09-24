import { describe, expect, it } from 'vitest';
import { defaultSlaPolicy as policy } from '../../../src/config/sla.js';
import {
  accumulatePause,
  atRiskWindowSeconds,
  evaluateSla,
  firstResponseDueAt,
  isResolutionClockRunning,
  resolutionDueAt,
  type SlaTimestamps,
} from '../../../src/modules/sla/domain/sla-calculator.js';
import { assertValidPolicy } from '../../../src/modules/sla/domain/sla-policy.js';
import { FakeClock } from '../../support/fake-clock.js';

const CREATED = new Date('2025-01-06T09:00:00.000Z');

function ticket(overrides: Partial<SlaTimestamps> = {}): SlaTimestamps {
  return {
    priority: 'high', // 1h first response, 8h resolution
    createdAt: CREATED,
    firstRespondedAt: null,
    resolvedAt: null,
    slaPausedAt: null,
    slaPausedSeconds: 0,
    ...overrides,
  };
}

describe('SLA due dates', () => {
  it('derives due dates from the priority targets', () => {
    expect(firstResponseDueAt(CREATED, 'urgent', policy).toISOString()).toBe(
      '2025-01-06T09:30:00.000Z',
    );
    expect(resolutionDueAt(CREATED, 'urgent', 0, policy).toISOString()).toBe(
      '2025-01-06T13:00:00.000Z',
    );
    expect(resolutionDueAt(CREATED, 'low', 0, policy).toISOString()).toBe(
      '2025-01-09T09:00:00.000Z',
    );
  });

  it('pushes the resolution due date by the time spent paused', () => {
    expect(resolutionDueAt(CREATED, 'high', 90 * 60, policy).toISOString()).toBe(
      '2025-01-06T18:30:00.000Z',
    );
  });

  it('accumulates pauses in whole seconds and never goes backwards', () => {
    const pausedAt = new Date('2025-01-06T10:00:00.000Z');
    expect(accumulatePause(pausedAt, 60, new Date('2025-01-06T10:30:00.900Z'))).toBe(60 + 1800);
    expect(accumulatePause(pausedAt, 60, new Date('2025-01-06T09:00:00.000Z'))).toBe(60);
  });

  it('only runs the resolution clock while the desk owns the ticket', () => {
    expect(isResolutionClockRunning('open')).toBe(true);
    expect(isResolutionClockRunning('in_progress')).toBe(true);
    expect(isResolutionClockRunning('waiting_on_customer')).toBe(false);
    expect(isResolutionClockRunning('resolved')).toBe(false);
    expect(isResolutionClockRunning('closed')).toBe(false);
  });

  it('computes the at-risk window as a share of the target', () => {
    expect(atRiskWindowSeconds(60, policy)).toBe(15 * 60);
  });
});

describe('evaluateSla', () => {
  it('reports a fresh ticket as pending, not at risk, not breached', () => {
    const clock = new FakeClock(CREATED);
    clock.advance({ minutes: 10 });

    const sla = evaluateSla(ticket(), clock.now(), policy);

    expect(sla.firstResponse).toMatchObject({ breached: false, atRisk: false, completedAt: null });
    expect(sla.firstResponse.remainingSeconds).toBe(50 * 60);
    expect(sla.resolution.paused).toBe(false);
    expect(sla.breached).toBe(false);
    expect(sla.atRisk).toBe(false);
  });

  it('flags first response at risk inside the last quarter of the window', () => {
    const clock = new FakeClock(CREATED);
    clock.advance({ minutes: 45 });

    const sla = evaluateSla(ticket(), clock.now(), policy);

    expect(sla.firstResponse.atRisk).toBe(true);
    expect(sla.atRisk).toBe(true);
    expect(sla.breached).toBe(false);
  });

  it('is not breached exactly at the due time, but is one second later', () => {
    const clock = new FakeClock(CREATED);
    clock.advance({ hours: 1 });
    expect(evaluateSla(ticket(), clock.now(), policy).firstResponse.breached).toBe(false);

    clock.advance({ seconds: 1 });
    const sla = evaluateSla(ticket(), clock.now(), policy);
    expect(sla.firstResponse.breached).toBe(true);
    expect(sla.firstResponse.atRisk).toBe(false);
    expect(sla.firstResponse.remainingSeconds).toBe(-1);
    expect(sla.breached).toBe(true);
  });

  it('stops the first-response clock at the first reply', () => {
    const respondedAt = new Date('2025-01-06T09:20:00.000Z');
    const clock = new FakeClock(CREATED);
    clock.advance({ hours: 5 });

    const sla = evaluateSla(ticket({ firstRespondedAt: respondedAt }), clock.now(), policy);

    expect(sla.firstResponse).toMatchObject({
      completedAt: respondedAt,
      breached: false,
      atRisk: false,
      remainingSeconds: 40 * 60,
    });
  });

  it('keeps a late first reply marked as breached', () => {
    const sla = evaluateSla(
      ticket({ firstRespondedAt: new Date('2025-01-06T10:30:00.000Z') }),
      new Date('2025-01-06T11:00:00.000Z'),
      policy,
    );
    expect(sla.firstResponse.breached).toBe(true);
  });

  it('freezes the resolution clock while paused', () => {
    const pausedAt = new Date('2025-01-06T16:00:00.000Z'); // 1h before the 8h deadline
    const clock = new FakeClock(pausedAt);
    clock.advance({ hours: 48 });

    const sla = evaluateSla(
      ticket({ firstRespondedAt: CREATED, slaPausedAt: pausedAt }),
      clock.now(),
      policy,
    );

    expect(sla.resolution).toMatchObject({
      paused: true,
      breached: false,
      atRisk: false,
      remainingSeconds: 60 * 60,
    });
  });

  it('honours accumulated pauses after the clock resumes', () => {
    // 8h target + 2h paused => due at 19:00.
    const clock = new FakeClock('2025-01-06T18:30:00.000Z');
    const sla = evaluateSla(
      ticket({ firstRespondedAt: CREATED, slaPausedSeconds: 2 * 3600 }),
      clock.now(),
      policy,
    );
    expect(sla.resolution.dueAt.toISOString()).toBe('2025-01-06T19:00:00.000Z');
    expect(sla.resolution.breached).toBe(false);
    expect(sla.resolution.atRisk).toBe(true);
  });

  it('judges a resolved ticket by its resolution time', () => {
    const resolvedAt = new Date('2025-01-06T18:00:00.000Z'); // 1h late
    const sla = evaluateSla(
      ticket({ firstRespondedAt: CREATED, resolvedAt, slaPausedAt: resolvedAt }),
      new Date('2025-02-01T00:00:00.000Z'),
      policy,
    );
    expect(sla.resolution).toMatchObject({
      completedAt: resolvedAt,
      paused: false,
      breached: true,
      atRisk: false,
    });
  });

  it('treats resolving without a reply as completing the first response', () => {
    const resolvedAt = new Date('2025-01-06T09:15:00.000Z');
    const sla = evaluateSla(
      ticket({ resolvedAt, slaPausedAt: resolvedAt }),
      new Date('2025-01-07T00:00:00.000Z'),
      policy,
    );
    expect(sla.firstResponse.completedAt).toEqual(resolvedAt);
    expect(sla.firstResponse.breached).toBe(false);
  });
});

describe('assertValidPolicy', () => {
  it('rejects ratios outside (0, 1)', () => {
    expect(() => assertValidPolicy({ ...policy, atRiskRatio: 1 })).toThrow(/atRiskRatio/);
  });

  it('rejects non-positive or inconsistent targets', () => {
    expect(() =>
      assertValidPolicy({
        ...policy,
        targets: { ...policy.targets, low: { firstResponseMinutes: 0, resolutionMinutes: 10 } },
      }),
    ).toThrow(/positive/);
    expect(() =>
      assertValidPolicy({
        ...policy,
        targets: { ...policy.targets, low: { firstResponseMinutes: 20, resolutionMinutes: 10 } },
      }),
    ).toThrow(/cannot exceed/);
  });
});
