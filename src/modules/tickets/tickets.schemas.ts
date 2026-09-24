import { z } from 'zod';
import type { ActivityRow } from '../../db/schema.js';
import { paginationQuerySchema } from '../../http/pagination.js';
import type { SlaTargetStatus } from '../sla/domain/sla-calculator.js';
import { ACTIVITY_TYPES } from './domain/activity.js';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from './domain/ticket.js';
import { TICKET_SORT_FIELDS, type TicketSort } from './tickets.repository.js';
import type { TicketView } from './tickets.service.js';

/** Accepts `a,b,c` in a query string and validates each item. */
function csvOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1))
    .describe(`Comma-separated list of: ${values.join(', ')}`);
}

const SORT_VALUES = TICKET_SORT_FIELDS.flatMap((field) => [field, `-${field}`]) as [
  string,
  ...string[],
];

export const ticketIdParamsSchema = z.object({ id: z.uuid() });

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  status: csvOf(TICKET_STATUSES).optional(),
  priority: csvOf(TICKET_PRIORITIES).optional(),
  category: csvOf(TICKET_CATEGORIES).optional(),
  assigneeId: z
    .union([z.uuid(), z.enum(['me', 'none'])])
    .optional()
    .describe('A user id, `me`, or `none` for unassigned tickets'),
  requesterId: z.uuid().optional(),
  q: z.string().trim().min(1).max(200).optional().describe('Search title/description or #number'),
  sort: z
    .enum(SORT_VALUES)
    .default('-createdAt')
    .describe('Sort field; prefix with `-` for descending'),
});

export function parseSort(value: string): TicketSort {
  const descending = value.startsWith('-');
  const field = (descending ? value.slice(1) : value) as TicketSort['field'];
  return { field, direction: descending ? 'desc' : 'asc' };
}

export const createTicketBodySchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10_000),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES).default('medium'),
});

export const updateTicketBodySchema = createTicketBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'At least one field must be provided');

export const transitionBodySchema = z.object({
  status: z.enum(TICKET_STATUSES).describe('Target status'),
});

export const activitySchema = z.object({
  id: z.uuid(),
  type: z.enum(ACTIVITY_TYPES),
  actorId: z.uuid().nullable().describe('Null when the system acted'),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export function toActivityDto(activity: ActivityRow): z.infer<typeof activitySchema> {
  return {
    id: activity.id,
    type: activity.type,
    actorId: activity.actorId,
    data: activity.data,
    createdAt: activity.createdAt.toISOString(),
  };
}

const slaTargetSchema = z.object({
  dueAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  breached: z.boolean(),
  atRisk: z.boolean(),
  remainingSeconds: z.number().int().describe('Negative when overdue'),
});

export const ticketSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  title: z.string(),
  description: z.string(),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  status: z.enum(TICKET_STATUSES),
  requesterId: z.uuid(),
  assigneeId: z.uuid().nullable(),
  allowedTransitions: z.array(z.enum(TICKET_STATUSES)),
  sla: z.object({
    firstResponse: slaTargetSchema,
    resolution: slaTargetSchema.extend({ paused: z.boolean() }),
    breached: z.boolean(),
    atRisk: z.boolean(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
});

export type TicketDto = z.infer<typeof ticketSchema>;

export function toTicketDto({ ticket, sla, allowedTransitions }: TicketView): TicketDto {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    requesterId: ticket.requesterId,
    assigneeId: ticket.assigneeId,
    allowedTransitions,
    sla: {
      firstResponse: toSlaTargetDto(sla.firstResponse),
      resolution: { ...toSlaTargetDto(sla.resolution), paused: sla.resolution.paused },
      breached: sla.breached,
      atRisk: sla.atRisk,
    },
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
  };
}

function toSlaTargetDto(target: SlaTargetStatus) {
  return {
    dueAt: target.dueAt.toISOString(),
    completedAt: target.completedAt?.toISOString() ?? null,
    breached: target.breached,
    atRisk: target.atRisk,
    remainingSeconds: target.remainingSeconds,
  };
}
