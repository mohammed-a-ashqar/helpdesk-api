import type { UserRow } from '../../db/schema.js';
import type { UnitOfWork } from '../../db/unit-of-work.js';
import type { Actor } from '../../shared/actor.js';
import type { Clock } from '../../shared/clock.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors.js';
import type { Page, PageRequest } from '../../shared/pagination.js';
import type { PasswordHasher } from '../auth/password-hasher.js';
import type { TicketCategory } from '../tickets/domain/ticket.js';
import { isStaff, type Role } from './domain/role.js';
import type { UserFilter } from './users.repository.js';

export interface UserView {
  user: UserRow;
  categories: TicketCategory[];
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
  categories: TicketCategory[];
}

export interface UpdateUserInput {
  name?: string | undefined;
  role?: Role | undefined;
  isActive?: boolean | undefined;
  categories?: TicketCategory[] | undefined;
}

export class UsersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
  ) {}

  async get(id: string): Promise<UserView> {
    const { users } = this.uow.repositories;
    const user = await users.findById(id);
    if (!user) throw new NotFoundError('User', id);
    const categories = await users.categoriesFor([id]);
    return { user, categories: categories.get(id) ?? [] };
  }

  async list(filter: UserFilter, pagination: PageRequest): Promise<Page<UserView>> {
    const { users } = this.uow.repositories;
    const page = await users.list(filter, pagination);
    const categories = await users.categoriesFor(page.items.map((user) => user.id));
    return {
      total: page.total,
      items: page.items.map((user) => ({ user, categories: categories.get(user.id) ?? [] })),
    };
  }

  /** Admin-provisioned accounts (agents and admins cannot self-register). */
  async create(input: CreateUserInput): Promise<UserView> {
    assertCategoriesAllowed(input.role, input.categories);
    const passwordHash = await this.hasher.hash(input.password);

    return this.uow.transaction(async (repos) => {
      const user = await repos.users.create({
        email: input.email.trim().toLowerCase(),
        name: input.name,
        passwordHash,
        role: input.role,
      });
      await repos.users.replaceCategories(user.id, input.categories);
      return { user, categories: [...new Set(input.categories)].sort() };
    });
  }

  async update(actor: Actor, id: string, input: UpdateUserInput): Promise<UserView> {
    if (actor.userId === id && (input.role !== undefined || input.isActive === false)) {
      // Prevents an admin from locking themselves (and possibly everyone) out.
      throw new ConflictError(
        'You cannot change your own role or deactivate your own account.',
        'cannot-modify-self',
      );
    }

    return this.uow.transaction(async (repos) => {
      const existing = await repos.users.findById(id);
      if (!existing) throw new NotFoundError('User', id);

      const role = input.role ?? existing.role;
      const now = this.clock.now();
      const current = (await repos.users.categoriesFor([id])).get(id) ?? [];
      const categories = role === 'customer' ? [] : (input.categories ?? current);
      assertCategoriesAllowed(role, input.categories ?? []);

      const user = await repos.users.update(id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        updatedAt: now,
      });
      if (!user) throw new NotFoundError('User', id);

      await repos.users.replaceCategories(id, categories);
      if (input.isActive === false) {
        await repos.refreshTokens.revokeAllForUser(id, now);
      }
      return { user, categories: [...new Set(categories)].sort() };
    });
  }
}

function assertCategoriesAllowed(role: Role, categories: readonly TicketCategory[]): void {
  if (!isStaff(role) && categories.length > 0) {
    throw new UnprocessableError(
      'Only agents and admins can be assigned ticket categories.',
      'categories-not-allowed',
    );
  }
}
