import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/client.js';
import { agentCategories, tickets, users } from '../../../db/schema.js';
import { ACTIVE_STATUSES, type TicketCategory } from '../domain/ticket.js';
import type { AgentWorkload } from './assignment-strategy.js';

/** Reads the data assignment strategies decide on. */
export class WorkloadRepository {
  constructor(private readonly db: DbExecutor) {}

  /** Agents covering the category, with their categories and open-ticket counts. */
  async agentWorkloads(category: TicketCategory): Promise<AgentWorkload[]> {
    const agents = await this.db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .innerJoin(agentCategories, eq(agentCategories.userId, users.id))
      .where(and(eq(users.role, 'agent'), eq(agentCategories.category, category)));
    if (agents.length === 0) return [];

    const ids = agents.map((agent) => agent.id);
    const [categoryRows, loadRows] = await Promise.all([
      this.db.select().from(agentCategories).where(inArray(agentCategories.userId, ids)),
      this.db
        .select({ agentId: tickets.assigneeId, openTickets: count() })
        .from(tickets)
        .where(
          and(
            isNotNull(tickets.assigneeId),
            inArray(tickets.assigneeId, ids),
            inArray(tickets.status, [...ACTIVE_STATUSES]),
          ),
        )
        .groupBy(tickets.assigneeId),
    ]);

    return agents.map((agent) => ({
      agentId: agent.id,
      isActive: agent.isActive,
      categories: categoryRows.filter((row) => row.userId === agent.id).map((row) => row.category),
      openTickets: loadRows.find((row) => row.agentId === agent.id)?.openTickets ?? 0,
    }));
  }
}
