import type { TicketCategory } from '../../src/modules/tickets/domain/ticket.js';
import type { Role } from '../../src/modules/users/domain/role.js';
import type { TestApp } from './test-app.js';

export const DEFAULT_PASSWORD = 'correct-horse-battery';

export interface TestUser {
  id: string;
  email: string;
  role: Role;
  /** Ready-to-use `authorization` header for `app.inject`. */
  headers: { authorization: string };
}

let sequence = 0;

/** Inserts a user directly and mints an access token for them. */
export async function createUser(
  t: TestApp,
  options: { role?: Role; name?: string; categories?: TicketCategory[] } = {},
): Promise<TestUser> {
  sequence += 1;
  const role = options.role ?? 'customer';
  const { users } = t.container.uow.repositories;
  const user = await users.create({
    email: `${role}-${sequence}@example.com`,
    name: options.name ?? `${role} ${sequence}`,
    passwordHash: await t.container.passwordHasher.hash(DEFAULT_PASSWORD),
    role,
  });
  if (options.categories) {
    await users.replaceCategories(user.id, options.categories);
  }
  const { token } = await t.container.tokens.issueAccessToken({ userId: user.id, role });
  return { id: user.id, email: user.email, role, headers: { authorization: `Bearer ${token}` } };
}
