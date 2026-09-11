import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5101';

// These are REAL-backend smoke tests (no mocks): when the API server isn't
// running (mock-API e2e default per testing.md) they are skipped rather than
// red — a red here means "backend down", not "regression". Start the server
// (or run accessbase.sh start:native + server) to exercise them.
test.describe('Health Endpoints', () => {
  test.beforeEach(async ({ request }) => {
    const reachable = await request
      .get(`${BASE_URL}/health/live`, { timeout: 2000 })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!reachable, 'Real backend on :5101 not running — real-backend smoke tests skipped (NOT VERIFIED per testing.md)');
  });

  test('GET /health/live returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health/live`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  test('GET /health/ready returns status', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health/ready`);
    // May be 200 or 503 depending on db/redis status
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    expect(body.status).toBeDefined();
    expect(body.checks).toBeDefined();
  });

  test('GET /health/startup returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health/startup`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeDefined();
  });
});
