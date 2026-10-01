import type { UnitOfWork } from '../../../db/unit-of-work.js';
import type { Actor } from '../../../shared/actor.js';
import { publishAll, type DomainEventBus } from '../../../shared/events/domain-events.js';
import { ConflictError, ForbiddenError } from '../../../shared/errors.js';
import { isStaff } from '../../users/domain/role.js';
import type { TicketsService, TicketView } from '../tickets.service.js';
import type { TicketAssigner } from './ticket-assigner.js';

/** Staff-facing assignment use cases. */
export class AssignmentService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tickets: TicketsService,
    private readonly assigner: TicketAssigner,
    private readonly events: DomainEventBus,
  ) {}

  async assign(actor: Actor, ticketId: string, assigneeId: string | null): Promise<TicketView> {
    assertStaff(actor);
    const result = await this.uow.transaction(async (repos) => {
      const ticket = await this.tickets.lockVisible(repos, actor, ticketId);
      return this.assigner.assign(repos, ticket, assigneeId, actor.userId);
    });
    await publishAll(this.events, result.events);
    return this.tickets.view(actor, result.ticket);
  }

  async autoAssign(actor: Actor, ticketId: string): Promise<TicketView> {
    assertStaff(actor);
    const result = await this.uow.transaction(async (repos) => {
      const ticket = await this.tickets.lockVisible(repos, actor, ticketId);
      const outcome = await this.assigner.autoAssign(repos, ticket, actor.userId);
      if (!outcome.assigned) {
        throw new ConflictError(
          `No active agent covers the "${ticket.category}" category.`,
          'no-eligible-agent',
        );
      }
      return outcome;
    });
    await publishAll(this.events, result.events);
    return this.tickets.view(actor, result.ticket);
  }
}

function assertStaff(actor: Actor): void {
  if (!isStaff(actor.role)) throw new ForbiddenError();
}
