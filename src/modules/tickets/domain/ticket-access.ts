import type { Actor } from '../../../shared/actor.js';
import { isStaff } from '../../users/domain/role.js';
import type { TransitionActor } from './ticket-state-machine.js';

interface OwnedTicket {
  requesterId: string;
}

/** Staff see every ticket; customers only the tickets they raised. */
export function canViewTicket(actor: Actor, ticket: OwnedTicket): boolean {
  return isStaff(actor.role) || ticket.requesterId === actor.userId;
}

/** How the state machine should treat this actor for this ticket. */
export function transitionActorFor(actor: Actor, ticket: OwnedTicket): TransitionActor | null {
  if (isStaff(actor.role)) return 'staff';
  if (ticket.requesterId === actor.userId) return 'requester';
  return null;
}
