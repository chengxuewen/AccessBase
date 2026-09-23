import client from './client';
import type { PaginatedEnvelope } from './types';

/** Audit log entry — matches GET /api/v1/audit-logs response */
export interface AuditLog {
  id: string;
  action: string;
  actor?: string;
  resource?: string;
  status?: number;
  ipAddress?: string;
  createdAt: string;
}

export interface ListAuditParams {
  page?: number;
  pageSize?: number;
  action?: string;
  actor?: string;
  startDate?: string;
  endDate?: string;
}

export interface PaginatedAuditLogs {
  data: AuditLog[];
  total: number;
}

/** List audit logs (paginated, filterable) */
export async function listAuditLogs(params: ListAuditParams = {}): Promise<PaginatedAuditLogs> {
  const { data } = await client.get<PaginatedEnvelope<AuditLog>>('/v1/audit-logs', { params });
  return { data: data.data, total: data.total };
}

/**
 * Q1-f6: server-side full export (GET /v1/audit-logs/export) — every row
 * matching the filters, tenant predicate + CSV injection guard server-side
 * (batch K). The old client-side export covered the visible page only.
 * Errors (403/401) reject normally — blob error bodies never reach disk.
 */
export async function exportAuditLogs(
  params: Omit<ListAuditParams, 'page' | 'pageSize'> = {},
): Promise<void> {
  const res = await client.get('/v1/audit-logs/export', { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
