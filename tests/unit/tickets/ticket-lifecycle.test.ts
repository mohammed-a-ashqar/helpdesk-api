import { describe, expect, it } from 'vitest';
import { defaultSlaPolicy as policy } from '../../../src/config/sla.js';
import {
  transitionEffects,
  type LifecycleSnapshot,
} from '../../../src/modules/tickets/domain/ticket-lifecycle.js';
import { FakeClock } from '../../support/fake-clock.js';

const CREATED = new Date('2025-01-06T09:00:00.000Z');

function snapshot(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  return {
    priority: 'high',
    createdAt: CREATED,
    slaPausedAt: null,
    slaPausedSeconds: 0,
    ...overrides,
  };
}

describe('transitionEffects', () => {
  it('only changes the status when work starts', () => {
    const clock = new FakeClock(CREATED);
    expect(transitionEffects(snapshot(), 'in_progress', clock.now(), policy)).toEqual({
      status: 'in_progress',
    });
  });

  it('pauses the resolution clock while waiting on the customer', () => {
    const clock = new FakeClock(CREATED);
    clock.advance({ hours: 2 });

    expect(transitionEffects(snapshot(), 'waiting_on_customer', clock.now(), policy)).toEqual({
      status: 'waiting_on_customer',
      slaPausedAt: clock.now(),
    });
  });

  it('resumes the clock and pushes the due date by the paused time', () => {
    const pausedAt = new Date('2025-01-06T11:00:00.000Z');
    const clock = new FakeClock(pausedAt);
    clock.advance({ hours: 3 });

    const effects = transitionEffects(
      snapshot({ slaPausedAt: pausedAt, slaPausedSeconds: 600 }),
      'in_progress',
      clock.now(),
      policy,
    );

    expect(effects).toEqual({
      status: 'in_progress',
      slaPausedAt: null,
      slaPausedSeconds: 600 + 3 * 3600,
      // 09:00 + 8h target + 3h10m paused
      resolutionDueAt: new Date('2025-01-06T20:10:00.000Z'),
    });
  });

  it('stamps resolution and keeps an existing pause when resolving a waiting ticket', () => {
    const pausedAt = new Date('2025-01-06T11:00:00.000Z');
    const now = new Date('2025-01-06T12:00:00.000Z');

    expect(transitionEffects(snapshot({ slaPausedAt: pausedAt }), 'resolved', now, policy)).toEqual(
      { status: 'resolved', resolvedAt: now },
    );
  });

  it('pauses the clock when resolving an active ticket', () => {
    const now = new Date('2025-01-06T12:00:00.000Z');
    expect(transitionEffects(snapshot(), 'resolved', now, policy)).toEqual({
      status: 'resolved',
      resolvedAt: now,
      slaPausedAt: now,
    });
  });

  it('stamps closure', () => {
    const now = new Date('2025-01-07T12:00:00.000Z');
    const resolvedAt = new Date('2025-01-06T12:00:00.000Z');
    expect(transitionEffects(snapshot({ slaPausedAt: resolvedAt }), 'closed', now, policy)).toEqual(
      { status: 'closed', closedAt: now },
    );
  });

  it('clears resolution and resumes the clock on reopen', () => {
    const resolvedAt = new Date('2025-01-06T12:00:00.000Z');
    const now = new Date('2025-01-06T13:00:00.000Z');

    const effects = transitionEffects(snapshot({ slaPausedAt: resolvedAt }), 'open', now, policy);

    expect(effects).toMatchObject({
      status: 'open',
      resolvedAt: null,
      closedAt: null,
      slaPausedAt: null,
      slaPausedSeconds: 3600,
    });
  });
});
