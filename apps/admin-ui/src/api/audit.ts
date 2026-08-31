import client from './client';

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
  const { data } = await client.get('/v1/audit-logs', { params });
  return { data: data.data, total: data.total };
}
