import { describe, expect, it } from 'vitest';
import type { AgentWorkload } from '../../../src/modules/tickets/assignment/assignment-strategy.js';
import { LeastOpenTicketsStrategy } from '../../../src/modules/tickets/assignment/least-open-tickets.strategy.js';

function agent(overrides: Partial<AgentWorkload> & { agentId: string }): AgentWorkload {
  return { isActive: true, categories: ['outage'], openTickets: 0, ...overrides };
}

describe('LeastOpenTicketsStrategy', () => {
  const strategy = new LeastOpenTicketsStrategy();

  it('picks the agent with the fewest open tickets', () => {
    const chosen = strategy.selectAgent({ category: 'outage' }, [
      agent({ agentId: 'a', openTickets: 5 }),
      agent({ agentId: 'b', openTickets: 1 }),
      agent({ agentId: 'c', openTickets: 3 }),
    ]);
    expect(chosen).toBe('b');
  });

  it('only considers agents covering the ticket category', () => {
    const chosen = strategy.selectAgent({ category: 'billing' }, [
      agent({ agentId: 'outage-only', openTickets: 0 }),
      agent({ agentId: 'billing', categories: ['billing', 'metering'], openTickets: 7 }),
    ]);
    expect(chosen).toBe('billing');
  });

  it('skips inactive agents', () => {
    const chosen = strategy.selectAgent({ category: 'outage' }, [
      agent({ agentId: 'away', isActive: false, openTickets: 0 }),
      agent({ agentId: 'busy', openTickets: 9 }),
    ]);
    expect(chosen).toBe('busy');
  });

  it('breaks ties deterministically by agent id', () => {
    const candidates = [
      agent({ agentId: 'charlie', openTickets: 2 }),
      agent({ agentId: 'alpha', openTickets: 2 }),
      agent({ agentId: 'bravo', openTickets: 2 }),
    ];
    expect(strategy.selectAgent({ category: 'outage' }, candidates)).toBe('alpha');
  });

  it('returns null when nobody is eligible', () => {
    expect(strategy.selectAgent({ category: 'metering' }, [agent({ agentId: 'a' })])).toBeNull();
    expect(strategy.selectAgent({ category: 'metering' }, [])).toBeNull();
  });

  it('does not reorder the caller array', () => {
    const candidates = [agent({ agentId: 'b', openTickets: 3 }), agent({ agentId: 'a' })];
    strategy.selectAgent({ category: 'outage' }, candidates);
    expect(candidates.map((c) => c.agentId)).toEqual(['b', 'a']);
  });
});
