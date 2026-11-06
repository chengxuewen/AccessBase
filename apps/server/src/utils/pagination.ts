/**
 * T3 (gap-remediation 2026-10-12, G5): shared pagination — parse + reply.
 * Envelope per the events.ts:118 precedent: {success, data, total} siblings
 * (+ page/pageSize) — NOT {items, totalPages} (dual-Momus R2/B3 killed that
 * shape for contradicting both the precedent and the additive-sibling ruling).
 */

export interface PageQuery {
  page?: string;
  pageSize?: string;
}

export interface PageOpts {
  page: number;
  pageSize: number;
  offset: number;
}

export const PAGE_DEFAULT_SIZE = 20;
export const PAGE_MAX_SIZE = 100;

/** Parse page/pageSize from a query with caps; invalid values fall to defaults. */
export function parsePageQuery(query: PageQuery): PageOpts {
  const rawPage = Number.parseInt(query.page ?? '', 10);
  const rawSize = Number.parseInt(query.pageSize ?? '', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(rawSize, PAGE_MAX_SIZE) : PAGE_DEFAULT_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Envelope siblings per the events.ts precedent. Callers spread into their reply. */
export function paginatedReply<T>(
  rows: T[],
  total: number,
  opts: PageOpts,
): {
  success: true;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
} {
  return { success: true, data: rows, total, page: opts.page, pageSize: opts.pageSize };
}
