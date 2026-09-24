import type { Role } from '../modules/users/domain/role.js';

/** The authenticated user performing a request. */
export interface Actor {
  userId: string;
  role: Role;
}
