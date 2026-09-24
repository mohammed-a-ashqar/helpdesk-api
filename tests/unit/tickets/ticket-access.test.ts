import { describe, expect, it } from 'vitest';
import {
  canViewTicket,
  transitionActorFor,
} from '../../../src/modules/tickets/domain/ticket-access.js';

const ticket = { requesterId: 'customer-1' };

describe('ticket access', () => {
  it('lets staff see and work every ticket', () => {
    for (const role of ['agent', 'admin'] as const) {
      const actor = { userId: 'staff-1', role };
      expect(canViewTicket(actor, ticket)).toBe(true);
      expect(transitionActorFor(actor, ticket)).toBe('staff');
    }
  });

  it('lets customers see only their own tickets', () => {
    expect(canViewTicket({ userId: 'customer-1', role: 'customer' }, ticket)).toBe(true);
    expect(canViewTicket({ userId: 'customer-2', role: 'customer' }, ticket)).toBe(false);
  });

  it('maps the requester to the requester transition actor and others to none', () => {
    expect(transitionActorFor({ userId: 'customer-1', role: 'customer' }, ticket)).toBe(
      'requester',
    );
    expect(transitionActorFor({ userId: 'customer-2', role: 'customer' }, ticket)).toBeNull();
  });
});
