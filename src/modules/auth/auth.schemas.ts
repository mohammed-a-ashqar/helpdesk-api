import { z } from 'zod';
import { emailSchema, nameSchema, passwordSchema, userSchema } from '../users/users.schemas.js';

export const registerBodySchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

export const authResponseSchema = z.object({
  user: userSchema,
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  expiresIn: z.number().int().describe('Access token lifetime in seconds'),
  refreshToken: z.string().describe('Single-use; exchange it at /auth/refresh'),
  refreshTokenExpiresAt: z.iso.datetime(),
});
