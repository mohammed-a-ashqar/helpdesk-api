import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEvents } from '../../src/shared/events/domain-events.js';
import { createUser, type TestUser } from '../support/fixtures.js';
import { createTestApp, type TestApp } from '../support/test-app.js';
import { raiseTicket, type TicketDto } from '../support/tickets.js';

describe('ticket assignment', () => {
  let t: TestApp;
  let admin: TestUser;
  let customer: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.database.reset();
    t.clock.set('2025-01-06T09:00:00.000Z');
    admin = await createUser(t, { role: 'admin' });
    customer = await createUser(t, { role: 'customer' });
  });

  afterAll(async () => {
    await t.close();
  });

  const assign = (user: TestUser, ticketId: string, assigneeId: string | null) =>
    t.app.inject({
      method: 'PUT',
      url: `/tickets/${ticketId}/assignee`,
      headers: user.headers,
      payload: { assigneeId },
    });

  const autoAssign = (user: TestUser, ticketId: string) =>
    t.app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/auto-assign`,
      headers: user.headers,
    });

  const move = (user: TestUser, ticketId: string, status: string) =>
    t.app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/transitions`,
      headers: user.headers,
      payload: { status },
    });

  const activity = async (ticketId: string) => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/tickets/${ticketId}/activity`,
      headers: admin.headers,
    });
    return res.json<{ type: string; actorId: string | null; data: Record<string, unknown> }[]>();
  };

  describe('on create', () => {
    it('assigns the agent with the fewest open tickets in the category', async () => {
      const busy = await createUser(t, { role: 'agent', categories: ['outage'] });
      const idle = await createUser(t, { role: 'agent', categories: ['outage'] });
      await createUser(t, { role: 'agent', categories: ['billing'] });

      const first = await raiseTicket(t, customer, { category: 'outage' });
      // Make `first`'s owner the busier one regardless of id ordering.
      await assign(admin, first.id, busy.id);

      const second = await raiseTicket(t, customer, { category: 'outage' });
      expect(second.assigneeId).toBe(idle.id);
    });

    it('records the automatic assignment as a system action', async () => {
      const agent = await createUser(t, { role: 'agent', categories: ['outage'] });
      const ticket = await raiseTicket(t, customer, { category: 'outage' });

      expect(ticket.assigneeId).toBe(agent.id);
      expect(await activity(ticket.id)).toMatchObject([
        { type: 'created', actorId: customer.id },
        {
          type: 'assigned',
          actorId: null,
          data: { from: null, to: agent.id, strategy: 'least-open-tickets' },
        },
      ]);
    });

    it('leaves the ticket in the queue when no agent covers the category', async () => {
      await createUser(t, { role: 'agent', categories: ['billing'] });
      const ticket = await raiseTicket(t, customer, { category: 'outage' });
      expect(ticket.assigneeId).toBeNull();
    });

    it('skips deactivated agents', async () => {
      const inactive = await createUser(t, { role: 'agent', categories: ['outage'] });
      await t.container.uow.repositories.users.update(inactive.id, {
        isActive: false,
        updatedAt: new Date(),
      });

      const ticket = await raiseTicket(t, customer, { category: 'outage' });
      expect(ticket.assigneeId).toBeNull();
    });

    it('publishes ticket.assigned after the ticket is created', async () => {
      const agent = await createUser(t, { role: 'agent', categories: ['outage'] });
      const received: DomainEvents['ticket.assigned'][] = [];
      const unsubscribe = t.container.events.subscribe('ticket.assigned', (event) => {
        received.push(event);
      });

      const ticket = await raiseTicket(t, customer, { category: 'outage' });
      unsubscribe();

      expect(received).toEqual([
        expect.objectContaining({
          ticketId: ticket.id,
          assigneeId: agent.id,
          assignedBy: null,
          strategy: 'least-open-tickets',
        }),
      ]);
    });
  });

  describe('PUT /tickets/:id/assignee', () => {
    it('lets staff assign, reassign and unassign', async () => {
      const ticket = await raiseTicket(t, customer);
      const first = await createUser(t, { role: 'agent' });
      const second = await createUser(t, { role: 'agent' });

      const assigned = await assign(admin, ticket.id, first.id);
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json<TicketDto>().assigneeId).toBe(first.id);

      const reassigned = await assign(first, ticket.id, second.id);
      expect(reassigned.json<TicketDto>().assigneeId).toBe(second.id);

      const unassigned = await assign(admin, ticket.id, null);
      expect(unassigned.json<TicketDto>().assigneeId).toBeNull();

      expect((await activity(ticket.id)).slice(1)).toMatchObject([
        { type: 'assigned', actorId: admin.id, data: { from: null, to: first.id } },
        { type: 'assigned', actorId: first.id, data: { from: first.id, to: second.id } },
        { type: 'unassigned', actorId: admin.id, data: { from: second.id, to: null } },
      ]);
    });

    it('does not record anything when the assignee is unchanged', async () => {
      const agent = await createUser(t, { role: 'agent' });
      const ticket = await raiseTicket(t, customer);
      await assign(admin, ticket.id, agent.id);
      await assign(admin, ticket.id, agent.id);

      expect((await activity(ticket.id)).filter((a) => a.type === 'assigned')).toHaveLength(1);
    });

    it('rejects customers and inactive agents as assignees', async () => {
      const ticket = await raiseTicket(t, customer);
      const inactive = await createUser(t, { role: 'agent' });
      await t.container.uow.repositories.users.update(inactive.id, {
        isActive: false,
        updatedAt: new Date(),
      });

      for (const assigneeId of [customer.id, inactive.id]) {
        const res = await assign(admin, ticket.id, assigneeId);
        expect(res.statusCode).toBe(422);
        expect(res.json()).toMatchObject({ type: 'urn:problem-type:invalid-assignee' });
      }
    });

    it('refuses to reassign a resolved ticket', async () => {
      const agent = await createUser(t, { role: 'agent' });
      const ticket = await raiseTicket(t, customer);
      await move(agent, ticket.id, 'in_progress');
      await move(agent, ticket.id, 'resolved');

      const res = await assign(admin, ticket.id, agent.id);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'urn:problem-type:ticket-not-assignable' });
    });

    it('is staff only', async () => {
      const ticket = await raiseTicket(t, customer);
      const res = await assign(customer, ticket.id, null);
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for an unknown ticket', async () => {
      const res = await assign(admin, '00000000-0000-4000-8000-000000000000', null);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /tickets/:id/auto-assign', () => {
    it('assigns a queued ticket once an agent becomes available', async () => {
      const ticket = await raiseTicket(t, customer, { category: 'billing' });
      expect(ticket.assigneeId).toBeNull();

      const agent = await createUser(t, { role: 'agent', categories: ['billing'] });
      const res = await autoAssign(admin, ticket.id);

      expect(res.statusCode).toBe(200);
      expect(res.json<TicketDto>().assigneeId).toBe(agent.id);
    });

    it('answers 409 when nobody is eligible', async () => {
      const ticket = await raiseTicket(t, customer, { category: 'billing' });
      const res = await autoAssign(admin, ticket.id);

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'urn:problem-type:no-eligible-agent' });
    });

    it('is staff only', async () => {
      const ticket = await raiseTicket(t, customer);
      expect((await autoAssign(customer, ticket.id)).statusCode).toBe(403);
    });
  });
});
