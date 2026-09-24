export const ROLES = ['customer', 'agent', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ['agent', 'admin'];

/** Agents and admins work tickets; customers only see their own. */
export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
