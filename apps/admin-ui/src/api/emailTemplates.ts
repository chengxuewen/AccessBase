import client from './client';
import type { ApiEnvelope } from './types';

export type EmailTemplateId = 'verify' | 'reset' | 'magic' | 'invite';

/** Per-language arm; absent = falls back to the server default at render. */
export interface LocalizedField {
  en?: string;
  zh?: string;
}

/** Template view — GET /v1/email-templates (fixed four ids).
 * Value shape is the jsonb object {subject:{en?,zh?},html:{en?,zh?}} (spec §7). */
export interface EmailTemplate {
  id: EmailTemplateId;
  subject: LocalizedField;
  html: LocalizedField;
  overridden: boolean;
}

/** PUT /v1/email-templates/:id body — merged server-side. */
export interface EmailTemplatePayload {
  subject: LocalizedField;
  html: LocalizedField;
}

export interface TemplatePreview {
  subject: string;
  html: string;
}

export async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
  const { data } = await client.get<ApiEnvelope<EmailTemplate[]>>('/v1/email-templates');
  return data.data;
}

export async function updateEmailTemplate(
  id: EmailTemplateId,
  payload: EmailTemplatePayload,
): Promise<EmailTemplate> {
  const { data } = await client.put<ApiEnvelope<EmailTemplate>>(`/v1/email-templates/${id}`, payload);
  return data.data;
}

/** POST /v1/email-templates/:id/preview — renders the STORED template. */
export async function previewEmailTemplate(
  id: EmailTemplateId,
  locale?: 'en' | 'zh',
  vars?: Record<string, string | number>,
): Promise<TemplatePreview> {
  const { data } = await client.post<ApiEnvelope<TemplatePreview>>(`/v1/email-templates/${id}/preview`, {
    ...(locale ? { locale } : {}),
    ...(vars ? { vars } : {}),
  });
  return data.data;
}

/** POST /v1/email-templates/:id/test {to} — 202 queued; 502 SMTP_UNAVAILABLE. */
export async function testEmailTemplate(id: EmailTemplateId, to: string): Promise<void> {
  await client.post<ApiEnvelope<null>>(`/v1/email-templates/${id}/test`, { to });
}
