import { and, asc, count, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { escapeLike } from '../../db/sql.js';
import { agentCategories, users, type UserRow } from '../../db/schema.js';
import { offsetOf, type Page, type PageRequest } from '../../shared/pagination.js';
import { ConflictError } from '../../shared/errors.js';
import type { TicketCategory } from '../tickets/domain/ticket.js';
import type { Role } from './domain/role.js';

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}

export interface UserFilter {
  role?: Role | undefined;
  isActive?: boolean | undefined;
  /** Case-insensitive match on name or email. */
  q?: string | undefined;
}

export type UserPatch = Partial<Pick<UserRow, 'name' | 'role' | 'isActive'>> & { updatedAt: Date };

export class UsersRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email));
    return row;
  }

  /** @throws ConflictError when the email is already registered. */
  async create(input: NewUser): Promise<UserRow> {
    try {
      const [row] = await this.db.insert(users).values(input).returning();
      if (!row) throw new Error('Insert into users returned no row');
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('An account with this email already exists.', 'email-taken');
      }
      throw error;
    }
  }

  async update(id: string, patch: UserPatch): Promise<UserRow | undefined> {
    const [row] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    return row;
  }

  async list(filter: UserFilter, pagination: PageRequest): Promise<Page<UserRow>> {
    const conditions: SQL[] = [];
    if (filter.role) conditions.push(eq(users.role, filter.role));
    if (filter.isActive !== undefined) conditions.push(eq(users.isActive, filter.isActive));
    if (filter.q) {
      const pattern = `%${escapeLike(filter.q)}%`;
      const match = or(ilike(users.name, pattern), ilike(users.email, pattern));
      if (match) conditions.push(match);
    }
    const where = and(...conditions);

    const [items, [totals]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(asc(users.name), asc(users.id))
        .limit(pagination.pageSize)
        .offset(offsetOf(pagination)),
      this.db.select({ total: count() }).from(users).where(where),
    ]);
    return { items, total: totals?.total ?? 0 };
  }

  async categoriesFor(userIds: readonly string[]): Promise<Map<string, TicketCategory[]>> {
    const result = new Map<string, TicketCategory[]>(userIds.map((id) => [id, []]));
    if (userIds.length === 0) return result;
    const rows = await this.db
      .select()
      .from(agentCategories)
      .where(inArray(agentCategories.userId, [...userIds]))
      .orderBy(asc(agentCategories.category));
    for (const row of rows) {
      result.get(row.userId)?.push(row.category);
    }
    return result;
  }

  async replaceCategories(userId: string, categories: readonly TicketCategory[]): Promise<void> {
    await this.db.delete(agentCategories).where(eq(agentCategories.userId, userId));
    if (categories.length > 0) {
      await this.db
        .insert(agentCategories)
        .values([...new Set(categories)].map((category) => ({ userId, category })));
    }
  }
}
