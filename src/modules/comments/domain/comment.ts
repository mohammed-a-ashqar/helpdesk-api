/**
 * `public` comments are visible to the requester; `internal` notes are for
 * the service desk only and are never returned to customers.
 */
export const COMMENT_VISIBILITIES = ['public', 'internal'] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];
