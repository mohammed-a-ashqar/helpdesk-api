import type { TicketCategory } from '../domain/ticket.js';

/** An agent that could receive a ticket, with the data strategies need. */
export interface AgentWorkload {
  agentId: string;
  isActive: boolean;
  categories: readonly TicketCategory[];
  /** Tickets currently assigned to the agent in an active status. */
  openTickets: number;
}

export interface AssignableTicket {
  category: TicketCategory;
}

/**
 * Decides which agent should own a ticket. Implementations are pure so they
 * can be swapped (round robin, skills-based, ...) without touching the
 * services that call them.
 */
export interface AssignmentStrategy {
  readonly name: string;
  /** Returns the chosen agent id, or null when nobody is eligible. */
  selectAgent(ticket: AssignableTicket, candidates: readonly AgentWorkload[]): string | null;
}
