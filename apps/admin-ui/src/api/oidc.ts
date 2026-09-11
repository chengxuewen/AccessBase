import client from './client';
import type { ApiEnvelope } from './types';

export interface OidcInteraction {
  clientName: string;
  requestedScopes: string[];
  promptName: 'login' | 'consent';
  uid: string;
}

/** GET /v1/oidc/interaction/:uid — interaction details for the consent page (bearer auth) */
export async function getInteraction(uid: string): Promise<OidcInteraction> {
  const { data } = await client.get<ApiEnvelope<OidcInteraction>>(`/v1/oidc/interaction/${uid}`);
  return data.data;
}

/** POST /v1/oidc/interaction/:uid — submit approve/deny decision (bearer auth) */
export async function postInteractionDecision(uid: string, decision: 'approve' | 'deny'): Promise<void> {
  await client.post(`/v1/oidc/interaction/${uid}`, { decision });
}

/**
 * Resume URL for a validated OIDC login redirect. Returns undefined unless the
 * redirect is a relative /oidc/auth/ path with no traversal/encoding tricks
 * (open-redirect guard: reject backslashes and double-encoded slashes).
 */
export function safeOidcRedirect(redirect: string | null): string | undefined {
  if (!redirect) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(redirect);
  } catch {
    return undefined;
  }
  if (decoded.includes('\\') || decoded.includes('%2F%2F')) return undefined;
  return /^\/oidc\/auth\//.test(decoded) ? decoded : undefined;
}
