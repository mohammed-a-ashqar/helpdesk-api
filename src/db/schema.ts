import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { COMMENT_VISIBILITIES } from '../modules/comments/domain/comment.js';
import { ACTIVITY_TYPES } from '../modules/tickets/domain/activity.js';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from '../modules/tickets/domain/ticket.js';
import { ROLES } from '../modules/users/domain/role.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userRole = pgEnum('user_role', ROLES);
export const ticketStatus = pgEnum('ticket_status', TICKET_STATUSES);
export const ticketPriority = pgEnum('ticket_priority', TICKET_PRIORITIES);
export const ticketCategory = pgEnum('ticket_category', TICKET_CATEGORIES);
export const commentVisibility = pgEnum('comment_visibility', COMMENT_VISIBILITIES);
export const activityType = pgEnum('activity_type', ACTIVITY_TYPES);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('customer'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** Which ticket categories an agent handles (used by auto-assignment). */
export const agentCategories = pgTable(
  'agent_categories',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: ticketCategory('category').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category] })],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Every token issued from one login shares a family; reuse revokes it. */
    familyId: uuid('family_id').notNull(),
    /** SHA-256 of the opaque token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    replacedById: uuid('replaced_by_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('refresh_tokens_family_idx').on(table.familyId)],
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-friendly sequential reference shown to customers. */
    number: serial('number').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: ticketCategory('category').notNull(),
    priority: ticketPriority('priority').notNull(),
    status: ticketStatus('status').notNull().default('open'),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    firstResponseDueAt: timestamptz('first_response_due_at').notNull(),
    resolutionDueAt: timestamptz('resolution_due_at').notNull(),
    firstRespondedAt: timestamptz('first_responded_at'),
    resolvedAt: timestamptz('resolved_at'),
    closedAt: timestamptz('closed_at'),
    slaPausedAt: timestamptz('sla_paused_at'),
    slaPausedSeconds: integer('sla_paused_seconds').notNull().default(0),
    /** Set once a breach has been detected and announced (idempotency). */
    firstResponseBreachedAt: timestamptz('first_response_breached_at'),
    resolutionBreachedAt: timestamptz('resolution_breached_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    index('tickets_status_idx').on(table.status),
    index('tickets_assignee_idx').on(table.assigneeId),
    index('tickets_requester_idx').on(table.requesterId),
    index('tickets_created_at_idx').on(table.createdAt),
    index('tickets_first_response_due_idx')
      .on(table.firstResponseDueAt)
      .where(sql`${table.firstRespondedAt} is null`),
    index('tickets_resolution_due_idx')
      .on(table.resolutionDueAt)
      .where(sql`${table.resolvedAt} is null`),
  ],
);

export const ticketComments = pgTable(
  'ticket_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    visibility: commentVisibility('visibility').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [index('ticket_comments_ticket_idx').on(table.ticketId, table.createdAt)],
);

export const ticketActivities = pgTable(
  'ticket_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Monotonic insertion order; several entries can share a timestamp. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    /** Null when the system acted (auto-assignment, SLA monitor). */
    actorId: uuid('actor_id').references(() => users.id),
    type: activityType('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamptz('created_at').notNull(),
  },
  (table) => [index('ticket_activities_ticket_idx').on(table.ticketId, table.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type NewTicketRow = typeof tickets.$inferInsert;
export type CommentRow = typeof ticketComments.$inferSelect;
export type ActivityRow = typeof ticketActivities.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
