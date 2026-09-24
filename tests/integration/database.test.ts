import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.js';
import { createTestDatabase, type TestDatabase } from '../support/test-database.js';

describe('database migrations', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  it('creates the schema and enforces unique emails', async () => {
    const [created] = await database.db
      .insert(users)
      .values({ email: 'a@example.com', name: 'A', passwordHash: 'x' })
      .returning();

    expect(created?.role).toBe('customer');
    expect(created?.isActive).toBe(true);

    await expect(
      database.db.insert(users).values({ email: 'a@example.com', name: 'B', passwordHash: 'y' }),
    ).rejects.toThrow();
  });

  it('reset() empties every table', async () => {
    await database.reset();
    const rows = await database.db.select().from(users).where(eq(users.email, 'a@example.com'));
    expect(rows).toHaveLength(0);
  });
});
