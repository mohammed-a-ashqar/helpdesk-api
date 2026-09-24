import type { TicketDto } from '../../src/modules/tickets/tickets.schemas.js';
import type { TestUser } from './fixtures.js';
import type { TestApp } from './test-app.js';

export type { TicketDto };

export interface NewTicket {
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
}

/** Raises a ticket through the API as the given user. */
export async function raiseTicket(
  t: TestApp,
  user: TestUser,
  ticket: NewTicket = {},
): Promise<TicketDto> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/tickets',
    headers: user.headers,
    payload: {
      title: 'No power in the building',
      description: 'The whole block lost power at 08:40.',
      category: 'outage',
      priority: 'high',
      ...ticket,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`raiseTicket failed with ${res.statusCode}: ${res.body}`);
  }
  return res.json<TicketDto>();
}
