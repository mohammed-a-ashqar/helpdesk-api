import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { escapeLike } from '../../db/sql.js';
import { tickets, type NewTicketRow, type TicketRow } from '../../db/schema.js';
import { offsetOf, type Page, type PageRequest } from '../../shared/pagination.js';
import type { TicketCategory, TicketPriority, TicketStatus } from './domain/ticket.js';

export const TICKET_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'priority',
  'resolutionDueAt',
] as const;
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];

export interface TicketSort {
  field: TicketSortField;
  direction: 'asc' | 'desc';
}

export interface TicketFilter {
  statuses?: readonly TicketStatus[] | undefined;
  priorities?: readonly TicketPriority[] | undefined;
  categories?: readonly TicketCategory[] | undefined;
  /** A user id, or null for unassigned tickets. */
  assigneeId?: string | null | undefined;
  requesterId?: string | undefined;
  /** Matches title/description (case-insensitive) or the ticket number. */
  q?: string | undefined;
}

export type TicketPatch = Partial<Omit<NewTicketRow, 'id' | 'number' | 'createdAt'>> & {
  updatedAt: Date;
};

const SORT_COLUMNS = {
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
  // Postgres orders enums by declaration order: low < medium < high < urgent.
  priority: tickets.priority,
  resolutionDueAt: tickets.resolutionDueAt,
} as const;

export class TicketsRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(input: NewTicketRow): Promise<TicketRow> {
    const [row] = await this.db.insert(tickets).values(input).returning();
    if (!row) throw new Error('Insert into tickets returned no row');
    return row;
  }

  async findById(id: string): Promise<TicketRow | undefined> {
    const [row] = await this.db.select().from(tickets).where(eq(tickets.id, id));
    return row;
  }

  /** Locks the row for the rest of the transaction (serializes concurrent changes). */
  async findByIdForUpdate(id: string): Promise<TicketRow | undefined> {
    const [row] = await this.db.select().from(tickets).where(eq(tickets.id, id)).for('update');
    return row;
  }

  async update(id: string, patch: TicketPatch): Promise<TicketRow> {
    const [row] = await this.db.update(tickets).set(patch).where(eq(tickets.id, id)).returning();
    if (!row) throw new Error(`Ticket ${id} disappeared during update`);
    return row;
  }

  async list(filter: TicketFilter, sort: TicketSort, page: PageRequest): Promise<Page<TicketRow>> {
    const where = and(...buildConditions(filter));
    const column = SORT_COLUMNS[sort.field];
    const order = sort.direction === 'asc' ? asc : desc;

    const [items, [totals]] = await Promise.all([
      this.db
        .select()
        .from(tickets)
        .where(where)
        .orderBy(order(column), order(tickets.number))
        .limit(page.pageSize)
        .offset(offsetOf(page)),
      this.db.select({ total: count() }).from(tickets).where(where),
    ]);
    return { items, total: totals?.total ?? 0 };
  }
}

function buildConditions(filter: TicketFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.statuses?.length) conditions.push(inArray(tickets.status, [...filter.statuses]));
  if (filter.priorities?.length) {
    conditions.push(inArray(tickets.priority, [...filter.priorities]));
  }
  if (filter.categories?.length) {
    conditions.push(inArray(tickets.category, [...filter.categories]));
  }
  if (filter.assigneeId === null) conditions.push(isNull(tickets.assigneeId));
  else if (filter.assigneeId) conditions.push(eq(tickets.assigneeId, filter.assigneeId));
  if (filter.requesterId) conditions.push(eq(tickets.requesterId, filter.requesterId));
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q)}%`;
    const alternatives = [ilike(tickets.title, pattern), ilike(tickets.description, pattern)];
    const number = /^#?(\d{1,9})$/.exec(filter.q)?.[1];
    if (number) alternatives.push(eq(tickets.number, Number(number)));
    const match = or(...alternatives);
    if (match) conditions.push(match);
  }
  return conditions;
}
