export interface PageRequest {
  /** 1-based page number. */
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export function offsetOf(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}
