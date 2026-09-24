import type { TicketPriority, TicketStatus } from '../../tickets/domain/ticket.js';
import type { SlaPolicy } from './sla-policy.js';

/**
 * Pure SLA arithmetic. No I/O and no implicit "now": callers pass the
 * current time explicitly, which keeps every rule unit-testable.
 *
 * Rules:
 * - Both clocks start when the ticket is created.
 * - First response is met by the first public reply from staff; resolving
 *   the ticket also stops it if nobody replied.
 * - The resolution clock is paused while the ticket waits on the customer
 *   or sits in resolved/closed. Paused time is added to the due date.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

export interface SlaTimestamps {
  priority: TicketPriority;
  createdAt: Date;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  /** Set while the resolution clock is paused. */
  slaPausedAt: Date | null;
  /** Total seconds the resolution clock has been paused in finished pauses. */
  slaPausedSeconds: number;
}

export interface SlaTargetStatus {
  dueAt: Date;
  /** When the target stopped counting (met, or finished without a reply). */
  completedAt: Date | null;
  breached: boolean;
  atRisk: boolean;
  /** Seconds left (negative when overdue); frozen while completed or paused. */
  remainingSeconds: number;
}

export interface SlaStatus {
  firstResponse: SlaTargetStatus;
  resolution: SlaTargetStatus & { paused: boolean };
  breached: boolean;
  atRisk: boolean;
}

export function isResolutionClockRunning(status: TicketStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

export function firstResponseDueAt(
  createdAt: Date,
  priority: TicketPriority,
  policy: SlaPolicy,
): Date {
  return addMinutes(createdAt, policy.targets[priority].firstResponseMinutes);
}

export function resolutionDueAt(
  createdAt: Date,
  priority: TicketPriority,
  pausedSeconds: number,
  policy: SlaPolicy,
): Date {
  const due = addMinutes(createdAt, policy.targets[priority].resolutionMinutes);
  return new Date(due.getTime() + pausedSeconds * MS_PER_SECOND);
}

/** Adds the pause that just ended to the running total. */
export function accumulatePause(pausedAt: Date, pausedSeconds: number, resumedAt: Date): number {
  const elapsed = Math.max(0, resumedAt.getTime() - pausedAt.getTime());
  return pausedSeconds + Math.floor(elapsed / MS_PER_SECOND);
}

/** Width of the "at risk" window, in seconds, for a target of the given length. */
export function atRiskWindowSeconds(targetMinutes: number, policy: SlaPolicy): number {
  return Math.floor(targetMinutes * 60 * policy.atRiskRatio);
}

export function evaluateSla(ticket: SlaTimestamps, now: Date, policy: SlaPolicy): SlaStatus {
  const target = policy.targets[ticket.priority];

  const firstResponseCompletedAt = ticket.firstRespondedAt ?? ticket.resolvedAt;
  const firstResponse = evaluateTarget({
    dueAt: firstResponseDueAt(ticket.createdAt, ticket.priority, policy),
    completedAt: firstResponseCompletedAt,
    frozenAt: null,
    now,
    riskWindowSeconds: atRiskWindowSeconds(target.firstResponseMinutes, policy),
  });

  const paused = ticket.resolvedAt === null && ticket.slaPausedAt !== null;
  const resolution = evaluateTarget({
    dueAt: resolutionDueAt(ticket.createdAt, ticket.priority, ticket.slaPausedSeconds, policy),
    completedAt: ticket.resolvedAt,
    frozenAt: ticket.slaPausedAt,
    now,
    riskWindowSeconds: atRiskWindowSeconds(target.resolutionMinutes, policy),
  });

  return {
    firstResponse,
    resolution: { ...resolution, paused },
    breached: firstResponse.breached || resolution.breached,
    atRisk: firstResponse.atRisk || resolution.atRisk,
  };
}

function evaluateTarget(input: {
  dueAt: Date;
  completedAt: Date | null;
  frozenAt: Date | null;
  now: Date;
  riskWindowSeconds: number;
}): SlaTargetStatus {
  const reference = input.completedAt ?? input.frozenAt ?? input.now;
  const remainingSeconds = Math.floor(
    (input.dueAt.getTime() - reference.getTime()) / MS_PER_SECOND,
  );
  const breached = remainingSeconds < 0;
  const counting = input.completedAt === null && input.frozenAt === null;
  return {
    dueAt: input.dueAt,
    completedAt: input.completedAt,
    breached,
    atRisk: counting && !breached && remainingSeconds <= input.riskWindowSeconds,
    remainingSeconds,
  };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}
