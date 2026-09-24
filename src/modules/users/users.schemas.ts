import { z } from 'zod';
import type { UserRow } from '../../db/schema.js';
import { ROLES } from './domain/role.js';

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type UserDto = z.infer<typeof userSchema>;

/** Never exposes the password hash: only whitelisted fields are copied. */
export function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}

export const emailSchema = z.email().max(254);
export const passwordSchema = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(128, 'must be at most 128 characters');
export const nameSchema = z.string().trim().min(1).max(100);
