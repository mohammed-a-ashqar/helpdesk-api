import type { TicketStatus } from './ticket.js';

/**
 * Who is attempting a transition, relative to the ticket:
 * - `staff`: an agent or admin working the ticket
 * - `requester`: the customer who opened the ticket
 */
export type TransitionActor = 'staff' | 'requester';

interface TransitionRule {
  readonly to: TicketStatus;
  readonly allowedActors: readonly TransitionActor[];
}

/**
 * The complete lifecycle; anything not listed here is illegal.
 * Main path: open -> in_progress -> waiting_on_customer -> resolved -> closed,
 * with shortcuts (in_progress -> resolved, waiting_on_customer -> in_progress)
 * and a reopen path (resolved -> open).
 */
const TRANSITIONS: Readonly<Record<TicketStatus, readonly TransitionRule[]>> = {
  open: [{ to: 'in_progress', allowedActors: ['staff'] }],
  in_progress: [
    { to: 'waiting_on_customer', allowedActors: ['staff'] },
    { to: 'resolved', allowedActors: ['staff'] },
  ],
  waiting_on_customer: [
    // A customer reply hands the ticket back to the desk.
    { to: 'in_progress', allowedActors: ['staff', 'requester'] },
    { to: 'resolved', allowedActors: ['staff'] },
  ],
  resolved: [
    { to: 'closed', allowedActors: ['staff', 'requester'] },
    // Reopen: the fix did not work.
    { to: 'open', allowedActors: ['staff', 'requester'] },
  ],
  closed: [],
};

export type TransitionCheck =
  { allowed: true } | { allowed: false; reason: 'illegal_transition' | 'actor_not_permitted' };

/** Is `from -> to` part of the lifecycle at all (ignoring who asks)? */
export function isLegalTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].some((rule) => rule.to === to);
}

export function checkTransition(
  from: TicketStatus,
  to: TicketStatus,
  actor: TransitionActor,
): TransitionCheck {
  const rule = TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (!rule) {
    return { allowed: false, reason: 'illegal_transition' };
  }
  if (!rule.allowedActors.includes(actor)) {
    return { allowed: false, reason: 'actor_not_permitted' };
  }
  return { allowed: true };
}

/** Statuses the given actor may move the ticket to next. */
export function availableTransitions(from: TicketStatus, actor: TransitionActor): TicketStatus[] {
  return TRANSITIONS[from]
    .filter((rule) => rule.allowedActors.includes(actor))
    .map((rule) => rule.to);
}

export function isTerminal(status: TicketStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
