import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, type TestUser } from '../support/fixtures.js';
import { createTestApp, type TestApp } from '../support/test-app.js';
import { raiseTicket, type TicketDto } from '../support/tickets.js';

interface TicketPage {
  data: TicketDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

describe('tickets', () => {
  let t: TestApp;
  let agent: TestUser;
  let customer: TestUser;
  let otherCustomer: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.database.reset();
    t.clock.set('2025-01-06T09:00:00.000Z');
    agent = await createUser(t, { role: 'agent' });
    customer = await createUser(t, { role: 'customer' });
    otherCustomer = await createUser(t, { role: 'customer' });
  });

  afterAll(async () => {
    await t.close();
  });

  const list = async (user: TestUser, query = '') => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/tickets${query}`,
      headers: user.headers,
    });
    expect(res.statusCode).toBe(200);
    return res.json<TicketPage>();
  };

  describe('create', () => {
    it('creates an open ticket with SLA due dates from its priority', async () => {
      const ticket = await raiseTicket(t, customer, { priority: 'urgent' });

      expect(ticket).toMatchObject({
        number: 1,
        status: 'open',
        priority: 'urgent',
        requesterId: customer.id,
        assigneeId: null,
        allowedTransitions: [],
        sla: {
          firstResponse: { dueAt: '2025-01-06T09:30:00.000Z', breached: false, atRisk: false },
          resolution: { dueAt: '2025-01-06T13:00:00.000Z', paused: false, breached: false },
        },
      });
    });

    it('defaults the priority to medium', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/tickets',
        headers: customer.headers,
        payload: { title: 'Bill looks wrong', description: 'Charged twice.', category: 'billing' },
      });
      expect(res.json<TicketDto>().priority).toBe('medium');
    });

    it('validates the payload', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/tickets',
        headers: customer.headers,
        payload: { title: 'x', description: '', category: 'plumbing', priority: 'asap' },
      });

      expect(res.statusCode).toBe(400);
      const paths = res.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          'body.title',
          'body.description',
          'body.category',
          'body.priority',
        ]),
      );
    });

    it('requires authentication', async () => {
      const res = await t.app.inject({ method: 'POST', url: '/tickets', payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('read', () => {
    it('lets the requester and staff read a ticket, with actor-specific transitions', async () => {
      const ticket = await raiseTicket(t, customer);

      const asCustomer = await t.app.inject({
        method: 'GET',
        url: `/tickets/${ticket.id}`,
        headers: customer.headers,
      });
      const asAgent = await t.app.inject({
        method: 'GET',
        url: `/tickets/${ticket.id}`,
        headers: agent.headers,
      });

      expect(asCustomer.statusCode).toBe(200);
      expect(asCustomer.json<TicketDto>().allowedTransitions).toEqual([]);
      expect(asAgent.json<TicketDto>().allowedTransitions).toEqual(['in_progress']);
    });

    it("hides other customers' tickets behind a 404", async () => {
      const ticket = await raiseTicket(t, customer);

      const res = await t.app.inject({
        method: 'GET',
        url: `/tickets/${ticket.id}`,
        headers: otherCustomer.headers,
      });

      expect(res.statusCode).toBe(404);
    });

    it('reports SLA progress as time passes', async () => {
      const ticket = await raiseTicket(t, customer, { priority: 'high' });
      t.clock.advance({ minutes: 50 });

      const atRisk = await t.app.inject({
        method: 'GET',
        url: `/tickets/${ticket.id}`,
        headers: agent.headers,
      });
      expect(atRisk.json<TicketDto>().sla).toMatchObject({ atRisk: true, breached: false });

      t.clock.advance({ minutes: 11 });
      const breached = await t.app.inject({
        method: 'GET',
        url: `/tickets/${ticket.id}`,
        headers: agent.headers,
      });
      expect(breached.json<TicketDto>().sla).toMatchObject({
        breached: true,
        firstResponse: { breached: true, remainingSeconds: -60 },
      });
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await raiseTicket(t, customer, { title: 'Street light out', priority: 'low' });
      t.clock.advance({ minutes: 1 });
      await raiseTicket(t, customer, {
        title: 'Meter reading disputed',
        category: 'metering',
        priority: 'medium',
      });
      t.clock.advance({ minutes: 1 });
      await raiseTicket(t, otherCustomer, {
        title: 'Transformer smoking',
        description: 'Visible smoke near the 100% load transformer',
        priority: 'urgent',
      });
    });

    it('shows staff every ticket, newest first by default', async () => {
      const page = await list(agent);

      expect(page.meta).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
      expect(page.data.map((ticket) => ticket.number)).toEqual([3, 2, 1]);
    });

    it('scopes customers to their own tickets, ignoring requester filters', async () => {
      const page = await list(customer, `?requesterId=${otherCustomer.id}`);

      expect(page.meta.total).toBe(2);
      expect(page.data.every((ticket) => ticket.requesterId === customer.id)).toBe(true);
    });

    it('filters by status, priority and category', async () => {
      expect((await list(agent, '?priority=urgent,low')).meta.total).toBe(2);
      expect((await list(agent, '?category=metering')).data[0]?.title).toBe(
        'Meter reading disputed',
      );
      expect((await list(agent, '?status=open')).meta.total).toBe(3);
      expect((await list(agent, '?status=closed')).meta.total).toBe(0);
    });

    it('filters by assignee', async () => {
      expect((await list(agent, '?assigneeId=none')).meta.total).toBe(3);
      expect((await list(agent, '?assigneeId=me')).meta.total).toBe(0);
    });

    it('searches title and description case-insensitively, and by number', async () => {
      expect((await list(agent, '?q=METER')).data.map((ticket) => ticket.number)).toEqual([2]);
      expect((await list(agent, '?q=smoke')).data.map((ticket) => ticket.number)).toEqual([3]);
      expect((await list(agent, '?q=%231')).data.map((ticket) => ticket.number)).toEqual([1]);
    });

    it('treats LIKE wildcards in the search term literally', async () => {
      expect((await list(agent, '?q=100%25')).data.map((ticket) => ticket.number)).toEqual([3]);
      expect((await list(agent, '?q=%25')).meta.total).toBe(1);
    });

    it('sorts by priority in both directions', async () => {
      const desc = await list(agent, '?sort=-priority');
      const asc = await list(agent, '?sort=priority');

      expect(desc.data.map((ticket) => ticket.priority)).toEqual(['urgent', 'medium', 'low']);
      expect(asc.data.map((ticket) => ticket.priority)).toEqual(['low', 'medium', 'urgent']);
    });

    it('paginates', async () => {
      const second = await list(agent, '?pageSize=2&page=2&sort=createdAt');

      expect(second.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
      expect(second.data.map((ticket) => ticket.number)).toEqual([3]);
    });

    it('rejects unknown filter values', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: '/tickets?status=open,bogus&sort=name',
        headers: agent.headers,
      });

      expect(res.statusCode).toBe(400);
      const paths = res.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
      expect(paths).toEqual(expect.arrayContaining(['querystring.sort']));
    });
  });

  describe('update', () => {
    it('lets staff reprioritise and recomputes SLA due dates from creation time', async () => {
      const ticket = await raiseTicket(t, customer, { priority: 'low' });
      t.clock.advance({ minutes: 10 });

      const res = await t.app.inject({
        method: 'PATCH',
        url: `/tickets/${ticket.id}`,
        headers: agent.headers,
        payload: { priority: 'urgent', title: 'Whole street without power' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        priority: 'urgent',
        title: 'Whole street without power',
        sla: {
          firstResponse: { dueAt: '2025-01-06T09:30:00.000Z' },
          resolution: { dueAt: '2025-01-06T13:00:00.000Z' },
        },
      });
    });

    it('forbids customers from editing tickets', async () => {
      const ticket = await raiseTicket(t, customer);

      const res = await t.app.inject({
        method: 'PATCH',
        url: `/tickets/${ticket.id}`,
        headers: customer.headers,
        payload: { priority: 'urgent' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for a missing ticket', async () => {
      const res = await t.app.inject({
        method: 'PATCH',
        url: '/tickets/00000000-0000-4000-8000-000000000000',
        headers: agent.headers,
        payload: { priority: 'urgent' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
