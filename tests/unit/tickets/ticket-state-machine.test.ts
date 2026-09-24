import { describe, expect, it } from 'vitest';
import { TICKET_STATUSES, type TicketStatus } from '../../../src/modules/tickets/domain/ticket.js';
import {
  availableTransitions,
  checkTransition,
  isLegalTransition,
  isTerminal,
} from '../../../src/modules/tickets/domain/ticket-state-machine.js';

const LEGAL: [TicketStatus, TicketStatus][] = [
  ['open', 'in_progress'],
  ['in_progress', 'waiting_on_customer'],
  ['in_progress', 'resolved'],
  ['waiting_on_customer', 'in_progress'],
  ['waiting_on_customer', 'resolved'],
  ['resolved', 'closed'],
  ['resolved', 'open'],
];

describe('ticket state machine', () => {
  it.each(LEGAL)('allows staff to move %s -> %s', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
    expect(checkTransition(from, to, 'staff')).toEqual({ allowed: true });
  });

  it('rejects every transition that is not explicitly defined', () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        if (legal.has(`${from}->${to}`)) continue;
        expect(isLegalTransition(from, to)).toBe(false);
        expect(checkTransition(from, to, 'staff')).toEqual({
          allowed: false,
          reason: 'illegal_transition',
        });
      }
    }
  });

  it('never allows a status to transition to itself', () => {
    for (const status of TICKET_STATUSES) {
      expect(isLegalTransition(status, status)).toBe(false);
    }
  });

  it('lets the requester reopen or close a resolved ticket', () => {
    expect(checkTransition('resolved', 'open', 'requester')).toEqual({ allowed: true });
    expect(checkTransition('resolved', 'closed', 'requester')).toEqual({ allowed: true });
  });

  it('lets the requester hand a waiting ticket back to the desk', () => {
    expect(checkTransition('waiting_on_customer', 'in_progress', 'requester')).toEqual({
      allowed: true,
    });
  });

  it('distinguishes a legal transition the requester may not perform', () => {
    expect(checkTransition('open', 'in_progress', 'requester')).toEqual({
      allowed: false,
      reason: 'actor_not_permitted',
    });
    expect(checkTransition('in_progress', 'resolved', 'requester')).toEqual({
      allowed: false,
      reason: 'actor_not_permitted',
    });
  });

  it('lists the next statuses available to each actor', () => {
    expect(availableTransitions('in_progress', 'staff')).toEqual([
      'waiting_on_customer',
      'resolved',
    ]);
    expect(availableTransitions('in_progress', 'requester')).toEqual([]);
    expect(availableTransitions('resolved', 'requester')).toEqual(['closed', 'open']);
  });

  it('treats closed as the only terminal status', () => {
    expect(TICKET_STATUSES.filter(isTerminal)).toEqual(['closed']);
    expect(availableTransitions('closed', 'staff')).toEqual([]);
  });
});
