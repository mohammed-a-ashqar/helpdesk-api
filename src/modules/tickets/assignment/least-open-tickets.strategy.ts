import type { AgentWorkload, AssignableTicket, AssignmentStrategy } from './assignment-strategy.js';

/**
 * Picks the active agent covering the ticket's category who currently has
 * the fewest open tickets. Ties are broken by agent id so the outcome is
 * deterministic.
 */
export class LeastOpenTicketsStrategy implements AssignmentStrategy {
  readonly name = 'least-open-tickets';

  selectAgent(ticket: AssignableTicket, candidates: readonly AgentWorkload[]): string | null {
    const eligible = candidates.filter(
      (candidate) => candidate.isActive && candidate.categories.includes(ticket.category),
    );
    const [best] = eligible.sort(
      (a, b) => a.openTickets - b.openTickets || a.agentId.localeCompare(b.agentId),
    );
    return best?.agentId ?? null;
  }
}
