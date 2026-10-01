import type { TicketRow } from '../../../db/schema.js';
import type { Repositories } from '../../../db/unit-of-work.js';
import type { Clock } from '../../../shared/clock.js';
import type { DomainEvent } from '../../../shared/events/domain-events.js';
import { ConflictError, UnprocessableError } from '../../../shared/errors.js';
import { isStaff } from '../../users/domain/role.js';
import { isActiveStatus } from '../domain/ticket.js';
import type { AssignmentStrategy } from './assignment-strategy.js';

export interface AssignmentResult {
  ticket: TicketRow;
  events: DomainEvent[];
}

/**
 * Applies assignments inside a caller-owned transaction: validates the
 * assignee, updates the ticket, writes the audit entry and returns the
 * events to publish after commit.
 */
export class TicketAssigner {
  constructor(
    private readonly strategy: AssignmentStrategy,
    private readonly clock: Clock,
  ) {}

  /** Manual (re)assignment; `assigneeId: null` unassigns. */
  async assign(
    repos: Repositories,
    ticket: TicketRow,
    assigneeId: string | null,
    actorId: string,
  ): Promise<AssignmentResult> {
    assertAssignable(ticket);
    if (assigneeId !== null) {
      const assignee = await repos.users.findById(assigneeId);
      if (!assignee?.isActive || !isStaff(assignee.role)) {
        throw new UnprocessableError(
          'Tickets can only be assigned to active agents or admins.',
          'invalid-assignee',
        );
      }
    }
    return this.apply(repos, ticket, assigneeId, actorId, null);
  }

  /**
   * Lets the strategy pick an agent. Returns the ticket unchanged (and no
   * events) when nobody is eligible.
   */
  async autoAssign(
    repos: Repositories,
    ticket: TicketRow,
    actorId: string | null,
  ): Promise<AssignmentResult & { assigned: boolean }> {
    assertAssignable(ticket);
    const candidates = await repos.workloads.agentWorkloads(ticket.category);
    const agentId = this.strategy.selectAgent(ticket, candidates);
    if (agentId === null) {
      return { ticket, events: [], assigned: false };
    }
    return {
      ...(await this.apply(repos, ticket, agentId, actorId, this.strategy.name)),
      assigned: true,
    };
  }

  private async apply(
    repos: Repositories,
    ticket: TicketRow,
    assigneeId: string | null,
    actorId: string | null,
    strategy: string | null,
  ): Promise<AssignmentResult> {
    if (ticket.assigneeId === assigneeId) {
      return { ticket, events: [] };
    }
    const now = this.clock.now();
    const updated = await repos.tickets.update(ticket.id, { assigneeId, updatedAt: now });
    await repos.activities.record({
      ticketId: ticket.id,
      actorId,
      type: assigneeId === null ? 'unassigned' : 'assigned',
      data: { from: ticket.assigneeId, to: assigneeId, ...(strategy && { strategy }) },
      createdAt: now,
    });

    const events: DomainEvent[] =
      assigneeId === null
        ? []
        : [
            {
              name: 'ticket.assigned',
              payload: {
                ticketId: ticket.id,
                requesterId: ticket.requesterId,
                assigneeId,
                previousAssigneeId: ticket.assigneeId,
                assignedBy: actorId,
                strategy,
                occurredAt: now,
              },
            },
          ];
    return { ticket: updated, events };
  }
}

function assertAssignable(ticket: TicketRow): void {
  if (!isActiveStatus(ticket.status)) {
    throw new ConflictError(
      `A ${ticket.status} ticket cannot be (re)assigned.`,
      'ticket-not-assignable',
    );
  }
}
