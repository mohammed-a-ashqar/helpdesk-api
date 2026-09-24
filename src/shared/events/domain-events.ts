import type {
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '../../modules/tickets/domain/ticket.js';
import type { EventBus } from './event-bus.js';

export type SlaTargetName = 'first_response' | 'resolution';

/** Everything the domain announces. Payloads are plain, serializable facts. */
export interface DomainEvents {
  'ticket.created': {
    ticketId: string;
    number: number;
    requesterId: string;
    category: TicketCategory;
    priority: TicketPriority;
    occurredAt: Date;
  };
  'ticket.assigned': {
    ticketId: string;
    requesterId: string;
    assigneeId: string;
    previousAssigneeId: string | null;
    /** Null when assigned automatically. */
    assignedBy: string | null;
    strategy: string | null;
    occurredAt: Date;
  };
  'ticket.status_changed': {
    ticketId: string;
    requesterId: string;
    assigneeId: string | null;
    from: TicketStatus;
    to: TicketStatus;
    changedBy: string;
    occurredAt: Date;
  };
  'sla.breached': {
    ticketId: string;
    assigneeId: string | null;
    target: SlaTargetName;
    dueAt: Date;
    occurredAt: Date;
  };
}

export type DomainEventBus = EventBus<DomainEvents>;

export type DomainEvent = {
  [K in keyof DomainEvents]: { name: K; payload: DomainEvents[K] };
}[keyof DomainEvents];

/**
 * Events are collected while a transaction runs and published only after it
 * commits, so listeners never see state that was rolled back.
 */
export async function publishAll(
  bus: DomainEventBus,
  events: readonly DomainEvent[],
): Promise<void> {
  for (const event of events) {
    await bus.publish(event.name, event.payload);
  }
}
