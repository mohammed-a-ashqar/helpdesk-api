import type { ActivityRow, TicketRow } from '../../db/schema.js';
import type { Repositories, UnitOfWork } from '../../db/unit-of-work.js';
import type { Actor } from '../../shared/actor.js';
import type { Clock } from '../../shared/clock.js';
import {
  publishAll,
  type DomainEvent,
  type DomainEventBus,
} from '../../shared/events/domain-events.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import type { Page, PageRequest } from '../../shared/pagination.js';
import {
  evaluateSla,
  firstResponseDueAt,
  resolutionDueAt,
  type SlaStatus,
} from '../sla/domain/sla-calculator.js';
import type { SlaPolicy } from '../sla/domain/sla-policy.js';
import { isStaff } from '../users/domain/role.js';
import type { TicketCategory, TicketPriority, TicketStatus } from './domain/ticket.js';
import { canViewTicket, transitionActorFor } from './domain/ticket-access.js';
import { transitionEffects } from './domain/ticket-lifecycle.js';
import { availableTransitions, checkTransition } from './domain/ticket-state-machine.js';
import type { TicketFilter, TicketPatch, TicketSort } from './tickets.repository.js';

export interface TicketView {
  ticket: TicketRow;
  sla: SlaStatus;
  /** Statuses the current caller may move the ticket to. */
  allowedTransitions: TicketStatus[];
}

export interface CreateTicketInput {
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
}

export interface UpdateTicketInput {
  title?: string | undefined;
  description?: string | undefined;
  category?: TicketCategory | undefined;
  priority?: TicketPriority | undefined;
}

export class TicketsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly slaPolicy: SlaPolicy,
    private readonly events: DomainEventBus,
  ) {}

  async create(actor: Actor, input: CreateTicketInput): Promise<TicketView> {
    const now = this.clock.now();

    const ticket = await this.uow.transaction(async (repos) => {
      const created = await repos.tickets.create({
        ...input,
        requesterId: actor.userId,
        firstResponseDueAt: firstResponseDueAt(now, input.priority, this.slaPolicy),
        resolutionDueAt: resolutionDueAt(now, input.priority, 0, this.slaPolicy),
        createdAt: now,
        updatedAt: now,
      });
      await repos.activities.record({
        ticketId: created.id,
        actorId: actor.userId,
        type: 'created',
        data: { category: created.category, priority: created.priority },
        createdAt: now,
      });
      return created;
    });

    await this.events.publish('ticket.created', {
      ticketId: ticket.id,
      number: ticket.number,
      requesterId: ticket.requesterId,
      category: ticket.category,
      priority: ticket.priority,
      occurredAt: now,
    });
    return this.view(actor, ticket);
  }

  async get(actor: Actor, id: string): Promise<TicketView> {
    const ticket = await this.uow.repositories.tickets.findById(id);
    if (!ticket || !canViewTicket(actor, ticket)) {
      // 404 rather than 403 so customers cannot probe for other tickets.
      throw new NotFoundError('Ticket', id);
    }
    return this.view(actor, ticket);
  }

  async list(
    actor: Actor,
    filter: TicketFilter,
    sort: TicketSort,
    page: PageRequest,
  ): Promise<Page<TicketView>> {
    const scoped = isStaff(actor.role) ? filter : { ...filter, requesterId: actor.userId };
    const result = await this.uow.repositories.tickets.list(scoped, sort, page);
    return { total: result.total, items: result.items.map((ticket) => this.view(actor, ticket)) };
  }

  /** Staff edits. A priority change re-computes the SLA due dates. */
  async update(actor: Actor, id: string, input: UpdateTicketInput): Promise<TicketView> {
    if (!isStaff(actor.role)) throw new ForbiddenError();
    const now = this.clock.now();

    const ticket = await this.uow.transaction(async (repos) => {
      const current = await this.lockVisible(repos, actor, id);
      const changes = diff(current, input);
      if (Object.keys(changes).length === 0) return current;

      const patch: TicketPatch = { ...input, updatedAt: now };
      if (input.priority && input.priority !== current.priority) {
        Object.assign(patch, this.dueDatesFor(current, input.priority, now));
      }
      const updated = await repos.tickets.update(id, patch);
      await repos.activities.record({
        ticketId: id,
        actorId: actor.userId,
        type: 'updated',
        data: { changes },
        createdAt: now,
      });
      return updated;
    });
    return this.view(actor, ticket);
  }

  async transition(actor: Actor, id: string, to: TicketStatus): Promise<TicketView> {
    const { ticket, events } = await this.uow.transaction(async (repos) => {
      const current = await this.lockVisible(repos, actor, id);
      return this.applyTransition(repos, actor, current, to);
    });
    await publishAll(this.events, events);
    return this.view(actor, ticket);
  }

  /**
   * Validates a status change against the state machine and applies it
   * inside the caller's transaction. Returns the events to publish once the
   * transaction has committed.
   */
  async applyTransition(
    repos: Repositories,
    actor: Actor,
    ticket: TicketRow,
    to: TicketStatus,
  ): Promise<{ ticket: TicketRow; events: DomainEvent[] }> {
    const transitionActor = transitionActorFor(actor, ticket);
    const check = transitionActor
      ? checkTransition(ticket.status, to, transitionActor)
      : ({ allowed: false, reason: 'actor_not_permitted' } as const);

    if (!check.allowed) {
      if (check.reason === 'illegal_transition') {
        throw new ConflictError(
          `A ticket cannot move from ${ticket.status} to ${to}.`,
          'invalid-transition',
          'Invalid Status Transition',
        );
      }
      throw new ForbiddenError(`You are not allowed to move this ticket to ${to}.`);
    }

    const now = this.clock.now();
    const updated = await repos.tickets.update(ticket.id, {
      ...transitionEffects(ticket, to, now, this.slaPolicy),
      updatedAt: now,
    });
    await repos.activities.record({
      ticketId: ticket.id,
      actorId: actor.userId,
      type: 'status_changed',
      data: { from: ticket.status, to },
      createdAt: now,
    });

    return {
      ticket: updated,
      events: [
        {
          name: 'ticket.status_changed',
          payload: {
            ticketId: ticket.id,
            requesterId: ticket.requesterId,
            assigneeId: ticket.assigneeId,
            from: ticket.status,
            to,
            changedBy: actor.userId,
            occurredAt: now,
          },
        },
      ],
    };
  }

  /** The audit trail of a ticket (staff only). */
  async activity(actor: Actor, id: string): Promise<ActivityRow[]> {
    if (!isStaff(actor.role)) throw new ForbiddenError();
    const ticket = await this.uow.repositories.tickets.findById(id);
    if (!ticket) throw new NotFoundError('Ticket', id);
    return this.uow.repositories.activities.listForTicket(id);
  }

  view(actor: Actor, ticket: TicketRow): TicketView {
    const transitionActor = transitionActorFor(actor, ticket);
    return {
      ticket,
      sla: evaluateSla(ticket, this.clock.now(), this.slaPolicy),
      allowedTransitions: transitionActor
        ? availableTransitions(ticket.status, transitionActor)
        : [],
    };
  }

  /** Loads and row-locks a ticket the actor may see, inside a transaction. */
  async lockVisible(repos: Repositories, actor: Actor, id: string): Promise<TicketRow> {
    const ticket = await repos.tickets.findByIdForUpdate(id);
    if (!ticket || !canViewTicket(actor, ticket)) {
      throw new NotFoundError('Ticket', id);
    }
    return ticket;
  }

  private dueDatesFor(ticket: TicketRow, priority: TicketPriority, now: Date): TicketPatch {
    const firstDue = firstResponseDueAt(ticket.createdAt, priority, this.slaPolicy);
    const resolutionDue = resolutionDueAt(
      ticket.createdAt,
      priority,
      ticket.slaPausedSeconds,
      this.slaPolicy,
    );
    return {
      firstResponseDueAt: firstDue,
      resolutionDueAt: resolutionDue,
      // A breach that the new target no longer implies can be reported again.
      ...(firstDue > now && { firstResponseBreachedAt: null }),
      ...(resolutionDue > now && { resolutionBreachedAt: null }),
      updatedAt: now,
    };
  }
}

function diff(
  current: TicketRow,
  input: UpdateTicketInput,
): Record<string, { from: string; to: string }> {
  const changes: Record<string, { from: string; to: string }> = {};
  for (const key of ['title', 'description', 'category', 'priority'] as const) {
    const next = input[key];
    if (next !== undefined && next !== current[key]) {
      changes[key] = { from: current[key], to: next };
    }
  }
  return changes;
}
