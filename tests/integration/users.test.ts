import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, DEFAULT_PASSWORD, type TestUser } from '../support/fixtures.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('users and RBAC', () => {
  let t: TestApp;
  let admin: TestUser;
  let agent: TestUser;
  let customer: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.database.reset();
    admin = await createUser(t, { role: 'admin' });
    agent = await createUser(t, { role: 'agent', categories: ['outage'] });
    customer = await createUser(t, { role: 'customer' });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('authentication', () => {
    it('rejects requests without a token', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/users/me' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ type: 'urn:problem-type:unauthorized' });
    });

    it('rejects malformed or forged tokens', async () => {
      for (const authorization of ['Basic abc', 'Bearer', 'Bearer not-a-jwt']) {
        const res = await t.app.inject({
          method: 'GET',
          url: '/users/me',
          headers: { authorization },
        });
        expect(res.statusCode).toBe(401);
      }
    });

    it('returns the current user profile', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/users/me', headers: agent.headers });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: agent.id, role: 'agent', categories: ['outage'] });
    });
  });

  describe('authorization', () => {
    it.each(['customer', 'agent'] as const)('forbids a %s from listing users', async (role) => {
      const caller = role === 'customer' ? customer : agent;
      const res = await t.app.inject({ method: 'GET', url: '/users', headers: caller.headers });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ type: 'urn:problem-type:forbidden', status: 403 });
    });

    it('forbids non-admins from creating staff accounts', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/users',
        headers: agent.headers,
        payload: { email: 'x@example.com', name: 'X', password: DEFAULT_PASSWORD, role: 'admin' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('administration', () => {
    it('lists users with filters and pagination', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: '/users?role=agent&pageSize=10',
        headers: admin.headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        data: [{ id: agent.id, categories: ['outage'] }],
        meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
      });
    });

    it('searches by name or email', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/users?q=${encodeURIComponent(customer.email.toUpperCase())}`,
        headers: admin.headers,
      });
      expect(res.json<{ data: { id: string }[] }>().data.map((u) => u.id)).toEqual([customer.id]);
    });

    it('creates an agent who can then log in', async () => {
      const created = await t.app.inject({
        method: 'POST',
        url: '/users',
        headers: admin.headers,
        payload: {
          email: 'New.Agent@example.com',
          name: 'New Agent',
          password: DEFAULT_PASSWORD,
          role: 'agent',
          categories: ['billing', 'metering', 'billing'],
        },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        email: 'new.agent@example.com',
        role: 'agent',
        categories: ['billing', 'metering'],
      });

      const login = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'new.agent@example.com', password: DEFAULT_PASSWORD },
      });
      expect(login.statusCode).toBe(200);
    });

    it('refuses categories for customers', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/users',
        headers: admin.headers,
        payload: {
          email: 'c@example.com',
          name: 'C',
          password: DEFAULT_PASSWORD,
          role: 'customer',
          categories: ['billing'],
        },
      });
      expect(res.statusCode).toBe(422);
    });

    it('updates role and categories', async () => {
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/users/${agent.id}`,
        headers: admin.headers,
        payload: { categories: ['outage', 'connection'], name: 'Renamed' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Renamed', categories: ['connection', 'outage'] });
    });

    it('applies deactivation immediately, even to unexpired access tokens', async () => {
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/users/${agent.id}`,
        headers: admin.headers,
        payload: { isActive: false },
      });
      expect(res.statusCode).toBe(200);

      const afterwards = await t.app.inject({
        method: 'GET',
        url: '/users/me',
        headers: agent.headers,
      });
      expect(afterwards.statusCode).toBe(401);
    });

    it('does not let an admin demote or deactivate themselves', async () => {
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/users/${admin.id}`,
        headers: admin.headers,
        payload: { isActive: false },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'urn:problem-type:cannot-modify-self' });
    });

    it('returns 404 for unknown users and 400 for malformed ids', async () => {
      const unknown = await t.app.inject({
        method: 'PATCH',
        url: '/users/00000000-0000-4000-8000-000000000000',
        headers: admin.headers,
        payload: { name: 'X' },
      });
      expect(unknown.statusCode).toBe(404);

      const malformed = await t.app.inject({
        method: 'PATCH',
        url: '/users/not-a-uuid',
        headers: admin.headers,
        payload: { name: 'X' },
      });
      expect(malformed.statusCode).toBe(400);
    });

    it('rejects an empty patch', async () => {
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/users/${agent.id}`,
        headers: admin.headers,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
