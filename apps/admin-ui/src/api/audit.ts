import client from './client';
import type { PaginatedEnvelope, ApiEnvelope } from './types';

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

/** R-audit D7: tamper-chain verification report (GET /v1/audit-logs/verify). */
export interface AuditVerifyFailure {
  day: string;
  seq: number;
  kind: 'row-mismatch' | 'anchor-mismatch' | 'orphan-erasure' | 'unanchored';
  rowId?: string;
}

export interface AuditVerifyReport {
  from: string;
  to: string;
  rowsChecked: number;
  rowsErased: number;
  erasedLegacyUnhashed: number;
  legacyPreChain: number;
  anchorsChecked: number;
  prunedAnchors: number;
  prunedFrom: string | null;
  unanchoredRows: number;
  chainOk: boolean;
  firstFailure: AuditVerifyFailure | null;
  partial: boolean;
  durationMs: number;
}

/** Verify params: ISO dates YYYY-MM-DD; server defaults last 30d, caps 90d. */
export interface VerifyAuditParams {
  from?: string;
  to?: string;
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

/** Run the tamper-chain verification (platform tenant only). */
export async function verifyAudit(params: VerifyAuditParams = {}): Promise<AuditVerifyReport> {
  const { data } = await client.get<ApiEnvelope<AuditVerifyReport>>('/v1/audit-logs/verify', { params });
  return data.data;
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
