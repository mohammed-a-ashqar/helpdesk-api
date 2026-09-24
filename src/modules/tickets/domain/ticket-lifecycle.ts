import {
  accumulatePause,
  isResolutionClockRunning,
  resolutionDueAt,
} from '../../sla/domain/sla-calculator.js';
import type { SlaPolicy } from '../../sla/domain/sla-policy.js';
import type { TicketPriority, TicketStatus } from './ticket.js';

export interface LifecycleSnapshot {
  priority: TicketPriority;
  createdAt: Date;
  slaPausedAt: Date | null;
  slaPausedSeconds: number;
}

export interface LifecycleChanges {
  status: TicketStatus;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  slaPausedAt?: Date | null;
  slaPausedSeconds?: number;
  resolutionDueAt?: Date;
}

/**
 * Side effects of entering a status (timestamps and SLA clock), computed
 * purely. Legality of the move is the state machine's job, not this one's.
 */
export function transitionEffects(
  ticket: LifecycleSnapshot,
  to: TicketStatus,
  now: Date,
  policy: SlaPolicy,
): LifecycleChanges {
  const changes: LifecycleChanges = { status: to };

  if (isResolutionClockRunning(to)) {
    if (ticket.slaPausedAt) {
      const pausedSeconds = accumulatePause(ticket.slaPausedAt, ticket.slaPausedSeconds, now);
      changes.slaPausedAt = null;
      changes.slaPausedSeconds = pausedSeconds;
      changes.resolutionDueAt = resolutionDueAt(
        ticket.createdAt,
        ticket.priority,
        pausedSeconds,
        policy,
      );
    }
  } else if (!ticket.slaPausedAt) {
    changes.slaPausedAt = now;
  }

  if (to === 'resolved') changes.resolvedAt = now;
  if (to === 'closed') changes.closedAt = now;
  if (to === 'open') {
    // Reopened: the earlier resolution no longer counts.
    changes.resolvedAt = null;
    changes.closedAt = null;
  }
  return changes;
}
