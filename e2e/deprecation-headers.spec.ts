import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5101';

/**
 * S5-B real-backend smoke (2026-11-09). Same discipline as health.spec.ts: the E2E job runs
 * no backend by design, so an unreachable API SKIPS these — a red here means "backend down",
 * never "regression". Deliberately written as invariants rather than "the list is empty",
 * because an emptiness assertion would rot into a false alarm the moment a real deprecation
 * is announced.
 */
test.describe('Deprecation contract headers (S5-B)', () => {
  test.beforeEach(async ({ request }) => {
    const reachable = await request
      .get(`${BASE_URL}/health/live`, { timeout: 2000 })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(
      !reachable,
      'Real backend on :5101 not running — real-backend smoke tests skipped (NOT VERIFIED per testing.md)',
    );
  });

  test('the deprecation headers are CORS-exposed, so a browser can actually read them', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v1/auth/captcha/status`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    const exposed = res.headers()['access-control-expose-headers'] ?? '';
    // Sunset/Deprecation/Link are not CORS-safelisted; without exposeHeaders the contract
    // this ruling bought would be invisible to every web integration.
    for (const name of ['Deprecation', 'Sunset', 'Link']) expect(exposed).toContain(name);
  });

  test('a deprecated response never travels alone (triple-or-nothing invariant)', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/v1/auth/captcha/status`);
    const headers = res.headers();
    if (headers.deprecation === undefined) {
      expect(headers.sunset).toBeUndefined();
      expect(headers.link).toBeUndefined();
    } else {
      expect(headers.deprecation).toBe('true');
      expect(headers.sunset).toBeTruthy();
      expect(headers.link).toContain('rel="deprecation"');
    }
  });
});
