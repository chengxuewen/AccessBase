/**
 * Wire envelope every /api/v1 endpoint returns (apps/server reply envelope).
 * Typed here so call sites cannot silently double-unwrap (see PIT-0015:
 * interceptor read `data.accessToken` on `{success,data}` → silent 15-min logout).
 */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  total?: number;
  error?: { code: string; message: string };
}

/** Paginated list endpoints: `{ success, data: T[], total }` */
export interface PaginatedEnvelope<T> {
  success: boolean;
  data: T[];
  total: number;
}
