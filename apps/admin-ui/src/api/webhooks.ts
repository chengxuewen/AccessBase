import client from './client';
import type { ApiEnvelope } from './types';

/** Webhook endpoint row — mirrors routes/webhooks.ts projection. The list
 * projection NEVER carries secret material (OidcClientListRow precedent);
 * the plaintext secret appears only in create/rotate responses. */
export interface Webhook {
  id: string;
  url: string;
  description?: string;
  subscribedEvents: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  pending: number;
  dead: number;
}

export interface CreateWebhookPayload {
  url: string;
  description?: string;
  subscribedEvents?: string[];
}

/** PUT body — all fields optional (partial incl. active toggle). */
export interface UpdateWebhookPayload {
  url?: string;
  description?: string;
  subscribedEvents?: string[];
  active?: boolean;
}

/** Delivery ledger row — GET /v1/webhooks/:id/deliveries */
export interface WebhookDelivery {
  id: string;
  eventId: string;
  status: 'pending' | 'delivered' | 'dead';
  attempts: number;
  lastError: string | null;
  responseStatus: number | null;
  deliveredAt: string | null;
  createdAt: string;
}

/** GET /v1/webhooks — list endpoints with pending/dead aggregates */
export async function fetchWebhooks(): Promise<Webhook[]> {
  const { data } = await client.get<ApiEnvelope<Webhook[]>>('/v1/webhooks');
  return data.data;
}

/** POST /v1/webhooks — 201; response carries the plaintext secret ONCE.
 * Errors: 400 WEBHOOK_INVALID / WEBHOOK_URL_DENIED, 409 WEBHOOK_EXISTS. */
export async function createWebhook(payload: CreateWebhookPayload): Promise<Webhook & { secret: string }> {
  const { data } = await client.post<ApiEnvelope<Webhook & { secret: string }>>('/v1/webhooks', payload);
  return data.data;
}

/** PUT /v1/webhooks/:id — partial update; 404 WEBHOOK_NOT_FOUND */
export async function updateWebhook(id: string, payload: UpdateWebhookPayload): Promise<Webhook> {
  const { data } = await client.put<ApiEnvelope<Webhook>>(`/v1/webhooks/${id}`, payload);
  return data.data;
}

/** DELETE /v1/webhooks/:id — deliveries cascade; {success,data:null} */
export async function deleteWebhook(id: string): Promise<void> {
  await client.delete<ApiEnvelope<null>>(`/v1/webhooks/${id}`);
}

/** POST /v1/webhooks/:id/rotate-secret — new plaintext secret ONCE */
export async function rotateWebhookSecret(id: string): Promise<string> {
  const { data } = await client.post<ApiEnvelope<{ secret: string }>>(`/v1/webhooks/${id}/rotate-secret`);
  return data.data.secret;
}

/** POST /v1/webhooks/:id/ping — 202, enqueues a webhook.test delivery */
export async function pingWebhook(id: string): Promise<{ deliveryQueued: boolean; eventId?: string }> {
  const { data } = await client.post<ApiEnvelope<{ deliveryQueued: boolean; eventId?: string }>>(
    `/v1/webhooks/${id}/ping`,
  );
  return data.data;
}

/** GET /v1/webhooks/:id/deliveries — recent delivery ledger */
export async function fetchWebhookDeliveries(id: string): Promise<WebhookDelivery[]> {
  const { data } = await client.get<ApiEnvelope<WebhookDelivery[]>>(`/v1/webhooks/${id}/deliveries`);
  return data.data;
}
