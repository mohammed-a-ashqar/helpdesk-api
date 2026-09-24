export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'waiting_on_customer',
  'resolved',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Declared from lowest to highest so the database enum sorts by urgency. */
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Categories reflect a utility (electricity) service desk. */
export const TICKET_CATEGORIES = [
  'outage',
  'billing',
  'metering',
  'connection',
  'general',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Statuses in which the ticket still needs work from the service desk. */
export const ACTIVE_STATUSES: readonly TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_on_customer',
];

export function isActiveStatus(status: TicketStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
