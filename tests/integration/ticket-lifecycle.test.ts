import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEvents } from '../../src/shared/events/domain-events.js';
import { createUser, type TestUser } from '../support/fixtures.js';
import { createTestApp, type TestApp } from '../support/test-app.js';
import { raiseTicket, type TicketDto } from '../support/tickets.js';

describe('ticket lifecycle', () => {
  let t: TestApp;
  let agent: TestUser;
  let customer: TestUser;
  let ticket: TicketDto;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.database.reset();
    t.clock.set('2025-01-06T09:00:00.000Z');
    agent = await createUser(t, { role: 'agent' });
    customer = await createUser(t, { role: 'customer' });
    ticket = await raiseTicket(t, customer, { priority: 'high' }); // 8h resolution target
  });

  afterAll(async () => {
    await t.close();
  });

  const move = (user: TestUser, status: string, id = ticket.id) =>
    t.app.inject({
      method: 'POST',
      url: `/tickets/${id}/transitions`,
      headers: user.headers,
      payload: { status },
    });

  it('walks the happy path and pauses the SLA while waiting on the customer', async () => {
    expect((await move(agent, 'in_progress')).statusCode).toBe(200);

    t.clock.advance({ hours: 1 });
    const waiting = await move(agent, 'waiting_on_customer');
    expect(waiting.json<TicketDto>()).toMatchObject({
      status: 'waiting_on_customer',
      sla: { resolution: { paused: true } },
    });

    // Two hours pass while the customer is away: they must not count.
    t.clock.advance({ hours: 2 });
    const resumed = await move(agent, 'in_progress');
    expect(resumed.json<TicketDto>().sla.resolution).toMatchObject({
      paused: false,
      dueAt: '2025-01-06T19:00:00.000Z', // 09:00 + 8h + 2h paused
    });

    t.clock.advance({ hours: 1 });
    const resolved = await move(agent, 'resolved');
    expect(resolved.json<TicketDto>()).toMatchObject({
      status: 'resolved',
      resolvedAt: '2025-01-06T13:00:00.000Z',
      allowedTransitions: ['closed', 'open'],
      sla: { resolution: { breached: false, completedAt: '2025-01-06T13:00:00.000Z' } },
    });

    const closed = await move(customer, 'closed');
    expect(closed.json<TicketDto>()).toMatchObject({ status: 'closed', allowedTransitions: [] });
  });

  it('records every transition in the audit trail', async () => {
    await move(agent, 'in_progress');
    await move(agent, 'resolved');

    const res = await t.app.inject({
      method: 'GET',
      url: `/tickets/${ticket.id}/activity`,
      headers: agent.headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([
      { type: 'created', actorId: customer.id },
      { type: 'status_changed', actorId: agent.id, data: { from: 'open', to: 'in_progress' } },
      { type: 'status_changed', actorId: agent.id, data: { from: 'in_progress', to: 'resolved' } },
    ]);
  });

  it('keeps the audit trail away from customers', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/tickets/${ticket.id}/activity`,
      headers: customer.headers,
    });
    expect(res.statusCode).toBe(403);
  });

  it('publishes a status_changed event after the change is committed', async () => {
    const received: DomainEvents['ticket.status_changed'][] = [];
    const unsubscribe = t.container.events.subscribe('ticket.status_changed', (event) => {
      received.push(event);
    });

    await move(agent, 'in_progress');
    unsubscribe();

    expect(received).toEqual([
      expect.objectContaining({
        ticketId: ticket.id,
        from: 'open',
        to: 'in_progress',
        changedBy: agent.id,
      }),
    ]);
  });

  describe('illegal transitions', () => {
    it.each([['closed'], ['resolved'], ['waiting_on_customer'], ['open']])(
      'rejects open -> %s with 409',
      async (status) => {
        const res = await move(agent, status);

        expect(res.statusCode).toBe(409);
        expect(res.headers['content-type']).toContain('application/problem+json');
        expect(res.json()).toMatchObject({
          type: 'urn:problem-type:invalid-transition',
          title: 'Invalid Status Transition',
          detail: `A ticket cannot move from open to ${status}.`,
        });
      },
    );

    it('treats closed as terminal', async () => {
      await move(agent, 'in_progress');
      await move(agent, 'resolved');
      await move(agent, 'closed');

      for (const status of ['open', 'in_progress', 'resolved']) {
        expect((await move(agent, status)).statusCode).toBe(409);
      }
    });

    it('leaves the ticket and its audit trail untouched', async () => {
      await move(agent, 'closed');

      const activity = await t.app.inject({
        method: 'GET',
        url: `/tickets/${ticket.id}/activity`,
        headers: agent.headers,
      });
      expect(activity.json<unknown[]>()).toHaveLength(1);
    });

    it('rejects unknown statuses as a validation error', async () => {
      expect((await move(agent, 'archived')).statusCode).toBe(400);
    });
  });

  describe('requester permissions', () => {
    it('cannot start work on a ticket', async () => {
      const res = await move(customer, 'in_progress');
      expect(res.statusCode).toBe(403);
    });

    it('can reopen a resolved ticket, which clears the resolution', async () => {
      await move(agent, 'in_progress');
      await move(agent, 'resolved');

      const res = await move(customer, 'open');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'open', resolvedAt: null });
    });

    it("cannot touch someone else's ticket", async () => {
      const stranger = await createUser(t, { role: 'customer' });
      expect((await move(stranger, 'closed')).statusCode).toBe(404);
    });
  });
});
