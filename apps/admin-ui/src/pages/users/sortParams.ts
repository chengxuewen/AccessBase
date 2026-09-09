/**
 * Map ProTable sorter state (antd column-sorter order values) to the API query
 * params the backend accepts (apps/server/src/routes/users.ts:39-40 — sortBy:
 * string, sortOrder: 'asc' | 'desc'). Only the first (most recently clicked)
 * sorter column is applied, matching antd single-column toggle behavior.
 * `null`/`undefined` order (third click = clear sort) yields no sort params.
 */
export function mapSort(
  sort: Record<string, 'ascend' | 'descend' | undefined> | undefined,
): { sortBy?: string; sortOrder?: 'asc' | 'desc' } {
  const entry = Object.entries(sort ?? {})[0];
  if (!entry || !entry[1]) return {};
  return { sortBy: entry[0], sortOrder: entry[1] === 'ascend' ? 'asc' : 'desc' };
}
