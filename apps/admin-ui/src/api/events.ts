import client from './client';
import type { ApiEnvelope, PaginatedEnvelope } from './types';

/** Domain event row — matches GET /api/v1/events projection (Q4d). */
export interface DomainEvent {
  id: number;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  fanoutComplete: boolean;
}

export interface ListEventsParams {
  page?: number;
  pageSize?: number;
  type?: string;
  startDate?: string;
  endDate?: string;
}

export interface PaginatedEvents {
  data: DomainEvent[];
  total: number;
}

/** List events (paginated, filterable; tenant isolation server-side). */
export async function listEvents(params: ListEventsParams = {}): Promise<PaginatedEvents> {
  const { data } = await client.get<PaginatedEnvelope<DomainEvent>>('/v1/events', { params });
  return { data: data.data, total: data.total };
}

/** Single event drill (foreign/missing id rejects with EVENT_NOT_FOUND). */
export async function getEvent(id: number): Promise<DomainEvent> {
  const { data } = await client.get<ApiEnvelope<DomainEvent>>(`/v1/events/${id}`);
  return data.data;
}
