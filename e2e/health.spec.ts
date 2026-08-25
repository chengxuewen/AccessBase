import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5101';

test.describe('Health Endpoints', () => {
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
