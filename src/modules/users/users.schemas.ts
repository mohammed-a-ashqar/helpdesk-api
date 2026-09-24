import { z } from 'zod';
import type { UserRow } from '../../db/schema.js';
import { paginationQuerySchema } from '../../http/pagination.js';
import { TICKET_CATEGORIES, type TicketCategory } from '../tickets/domain/ticket.js';
import { ROLES } from './domain/role.js';

export const emailSchema = z.email().max(254);
export const passwordSchema = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(128, 'must be at most 128 characters');
export const nameSchema = z.string().trim().min(1).max(100);
const categoriesSchema = z
  .array(z.enum(TICKET_CATEGORIES))
  .max(TICKET_CATEGORIES.length)
  .describe('Ticket categories a staff member handles (drives auto-assignment)');

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  categories: z.array(z.enum(TICKET_CATEGORIES)),
  createdAt: z.iso.datetime(),
});

export type UserDto = z.infer<typeof userSchema>;

/** Never exposes the password hash: only whitelisted fields are copied. */
export function toUserDto(user: UserRow, categories: readonly TicketCategory[] = []): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    categories: [...categories],
    createdAt: user.createdAt.toISOString(),
  };
}

export const userIdParamsSchema = z.object({ id: z.uuid() });

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(ROLES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const createUserBodySchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
  categories: categoriesSchema.default([]),
});

export const updateUserBodySchema = z
  .object({
    name: nameSchema,
    role: z.enum(ROLES),
    isActive: z.boolean(),
    categories: categoriesSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'At least one field must be provided');
