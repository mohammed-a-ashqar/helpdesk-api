import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { users, type UserRow } from '../../db/schema.js';
import { ConflictError } from '../../shared/errors.js';
import type { Role } from './domain/role.js';

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}

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
}
