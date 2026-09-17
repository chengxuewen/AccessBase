import { useEffect, useState } from 'react';
import { fetchTenants } from '../api/tenants';

// Module-scope cache: tenant id -> slug. Fetched once per session; failure is
// cached too (no retry) so users without tenants:read don't re-hit 403 on
// every render (batch G R4). Missing id also degrades to undefined -> '—'.
let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

function resolveTenantSlugs(): Promise<Map<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetchTenants({ pageSize: 100 })
      .then(({ data }) => {
        cache = new Map(data.map((t) => [t.id, t.slug]));
        return cache;
      })
      .catch(() => {
        // Cache the failure: empty map, never retried, silently degrades to '—'
        cache = new Map();
        return cache;
      });
  }
  return inflight;
}

/** Read-only table cell showing the tenant slug (or '—' if unavailable). */
export default function TenantCell({ tenantId }: { tenantId: string }) {
  const [slug, setSlug] = useState<string | undefined>(() => (cache ? cache.get(tenantId) : undefined));

  useEffect(() => {
    if (cache && cache.has(tenantId)) return;
    let cancelled = false;
    void resolveTenantSlugs().then((map) => {
      if (!cancelled) setSlug(map.get(tenantId));
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return <>{slug ?? '—'}</>;
}
