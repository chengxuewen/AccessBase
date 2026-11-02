/**
 * Branding slice (Q4 proposal #5, minimal): logo + primary color from the
 * options table, read through the PUBLIC /setup/status probe (already on the
 * login-page contract; PIT-080 roster unchanged). Module-level cache — one
 * fetch per tab session; Settings saves invalidate via explicit reload.
 *
 * Fail-soft everywhere: empty strings mean "not configured" → built-in chrome.
 */
import { useEffect, useState } from 'react';
import client from './api/client';
import type { ApiEnvelope } from './api/types';

export interface Branding {
  siteName: string;
  logoUrl: string;
  primaryColor: string;
}

const EMPTY: Branding = { siteName: '', logoUrl: '', primaryColor: '' };
let cache: Branding | null = null;

export async function fetchBranding(force = false): Promise<Branding> {
  if (cache && !force) return cache;
  try {
    const { data } = await client.get<ApiEnvelope<{ siteName?: string; logoUrl?: string; primaryColor?: string }>>(
      '/v1/setup/status',
    );
    cache = {
      siteName: data.data?.siteName ?? '',
      logoUrl: data.data?.logoUrl ?? '',
      primaryColor: data.data?.primaryColor ?? '',
    };
  } catch {
    cache = EMPTY; // backend down → built-in chrome (fail-soft)
  }
  return cache;
}

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(cache ?? EMPTY);
  useEffect(() => {
    if (cache) return; // already fetched this session
    void fetchBranding().then(setBranding);
  }, []);
  return branding;
}

/** Settings save path: PUT both options (admin auth), then bust the cache. */
export async function saveBranding(siteName: string, logoUrl: string, primaryColor: string): Promise<void> {
  await client.put<ApiEnvelope<unknown>>('/v1/options', { key: 'site.name', value: siteName });
  await client.put<ApiEnvelope<unknown>>('/v1/options', { key: 'site.logo_url', value: logoUrl });
  await client.put<ApiEnvelope<unknown>>('/v1/options', { key: 'site.primary_color', value: primaryColor });
  cache = null;
}
