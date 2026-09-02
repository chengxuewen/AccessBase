import { useEffect, useState } from 'react';
import { checkSetupStatus } from '../api/setup';

const RETRY_MS = 3000;

/**
 * Shared three-state setup guard state: null = checking / retrying (backend
 * unreachable), true = needs setup, false = no setup needed. Auto-retries
 * every RETRY_MS while the status check keeps failing — backend-down must
 * never resolve to a routing decision (PIT-029).
 */
export function useSetupGuardState(): { needsSetup: boolean | null } {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = () => {
      checkSetupStatus().then(({ needsSetup: ns, ok }) => {
        if (cancelled) return;
        if (ok) {
          setNeedsSetup(ns);
        } else {
          // Stay null (retry state), re-check after RETRY_MS
          timer = setTimeout(poll, RETRY_MS);
        }
      });
    };
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { needsSetup };
}
