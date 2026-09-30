import client from './client';
import { useAuthStore } from '../stores/auth';
import type { ApiEnvelope } from './types';

export interface OidcInteraction {
  clientName: string;
  requestedScopes: string[];
  promptName: 'login' | 'consent';
  uid: string;
  /** Q3B: provider-declared resume target (/oidc/auth/:uid or /oidc/device/:uid) */
  resumePath?: string;
}

/**
 * GET /v1/oidc/interaction/:uid — interaction details for the frontend login/
 * consent pages (bearer auth).
 */
export async function getInteraction(uid: string): Promise<OidcInteraction> {
  const { data } = await client.get<ApiEnvelope<OidcInteraction>>(`/v1/oidc/interaction/${uid}`);
  return data.data;
}

/*
 * POST /v1/oidc/interaction/:uid — submit approve/deny decision (bearer auth).
 * Uses fetch with redirect:'manual': a REAL provider responds 303 to the resume
 * hop; letting XHR auto-follow would consume the whole resume chain (burning the
 * interaction/resume cookies) before the SPA can assign the resume URL — the
 * redirect must be driven by a TOP-LEVEL navigation. Mock-API e2e answers 200
 * JSON, which is also accepted (returns true).
 */
export async function postInteractionDecision(uid: string, decision: 'approve' | 'deny'): Promise<boolean> {
  const { token } = useAuthStore.getState();
  const res = await fetch(`/api/v1/oidc/interaction/${encodeURIComponent(uid)}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ decision }),
  });
  return res.type === 'opaqueredirect' || res.ok;
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
  return /^\/oidc\/(auth|device)\//.test(decoded) ? decoded : undefined;
}
