import type { TicketPriority } from '../../tickets/domain/ticket.js';

export interface SlaTarget {
  /** Time allowed until the first public reply from the service desk. */
  firstResponseMinutes: number;
  /** Working time allowed until the ticket is resolved (pauses excluded). */
  resolutionMinutes: number;
}

export interface SlaPolicy {
  targets: Readonly<Record<TicketPriority, SlaTarget>>;
  /**
   * A pending target is "at risk" once the remaining time drops to this
   * fraction of the whole target (0.25 = last quarter of the window).
   */
  atRiskRatio: number;
}

export function assertValidPolicy(policy: SlaPolicy): SlaPolicy {
  if (!(policy.atRiskRatio > 0 && policy.atRiskRatio < 1)) {
    throw new Error('SLA atRiskRatio must be between 0 and 1 (exclusive).');
  }
  for (const [priority, target] of Object.entries(policy.targets)) {
    if (target.firstResponseMinutes <= 0 || target.resolutionMinutes <= 0) {
      throw new Error(`SLA targets for "${priority}" must be positive.`);
    }
    if (target.firstResponseMinutes > target.resolutionMinutes) {
      throw new Error(`SLA first response for "${priority}" cannot exceed its resolution target.`);
    }
  }
  return policy;
}
