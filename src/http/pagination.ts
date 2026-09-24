import { z } from 'zod';
import type { Page, PageRequest } from '../shared/pagination.js';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z.object({
      page: z.number().int(),
      pageSize: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
    }),
  });
}

export function toPageResponse<T, R>(page: Page<T>, request: PageRequest, map: (item: T) => R) {
  return {
    data: page.items.map(map),
    meta: {
      page: request.page,
      pageSize: request.pageSize,
      total: page.total,
      totalPages: Math.ceil(page.total / request.pageSize),
    },
  };
}
