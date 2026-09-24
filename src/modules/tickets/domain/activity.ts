/** Kinds of entries in a ticket's append-only audit trail. */
export const ACTIVITY_TYPES = [
  'created',
  'updated',
  'status_changed',
  'assigned',
  'unassigned',
  'commented',
  'sla_breached',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
