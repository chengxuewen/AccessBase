import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * ui-conformance C2 capture (skill 2026-11-25): dual screenshots — prototype
 * page (file://, topbar page switch) + app page (mocked, zh, light, ant pack,
 * SAME viewport 1440x900). The AI reads both image sets and writes
 * docs/ui/conformance/report.md (the deliverable). Re-runs re-shoot the
 * PROTOTYPE side too — it's a living document (complements the A-3 token gate:
 * that one locks token VALUES, this one locks composition).
 */
const PROTO = path.resolve(__dirname, '../docs/ui/prototypes/admin-console.html');
const OUT = path.resolve(__dirname, '../docs/ui/conformance');
const PAGES: Array<{ name: string; nav: string; route: string }> = [
  { name: 'dashboard', nav: 'dashboard', route: '/dashboard' },
  { name: 'users', nav: 'users', route: '/users' },
  { name: 'roles', nav: 'roles', route: '/roles' },
  { name: 'groups', nav: 'groups', route: '/groups' },
  { name: 'tenants', nav: 'tenants', route: '/tenants' },
  { name: 'clients', nav: 'clients', route: '/clients' },
  { name: 'apikeys', nav: 'apikeys', route: '/api-keys' },
  { name: 'webhooks', nav: 'webhooks', route: '/webhooks' },
  { name: 'audit', nav: 'audit', route: '/audit' },
  { name: 'events', nav: 'events', route: '/events' },
  { name: 'settings', nav: 'settings', route: '/settings' },
  { name: 'profile', nav: 'profile', route: '/profile' },
];

test.describe.configure({ mode: 'serial' });

test('capture: prototype pages (file://)', async ({ page }) => {
  mkdirSync(path.join(OUT, 'prototype'), { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`file://${PROTO}`);
  // zh locale + light theme + default pack
  await page.evaluate(() => {
    localStorage.setItem('ab_lang', 'zh');
  });
  for (const p of PAGES) {
    const btn = page.locator(`[data-page="${p.nav}"]`);
    await btn.click();
    await page.waitForTimeout(400); // page switch + render
    await page.screenshot({
      path: path.join(OUT, 'prototype', `${p.name}.png`),
      fullPage: false,
    });
  }
  const files = await page.evaluate(() => document.querySelectorAll('[data-page]').length);
  expect(files).toBeGreaterThanOrEqual(12);
});

test('capture: app pages (mocked shell, same viewport)', async ({ page }) => {
  mkdirSync(path.join(OUT, 'app'), { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('lng', 'zh');
    localStorage.setItem(
      'ui-storage',
      JSON.stringify({ state: { theme: 'light', pack: 'ant' }, version: 0 }),
    );
  });
  // canonical shell mocks (W0.2 discipline: shapes mirror real routes)
  // Generic GET fallback (registered BEFORE the page-specific mocks below =
  // lower precedence): any un-mocked page-mount request returns an empty
  // success instead of a 401 → no mid-capture axios logout (roles details hit
  // permission endpoints the per-page regex didn't cover).
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [], total: 0 }),
        })
      : route.fallback(),
  );

  await page.route('**/api/v1/setup/status', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { isInitialized: true, adminExists: true, configComplete: true },
      }),
    }),
  );
  await page.route('**/api/v1/auth/login', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { accessToken: 't', refreshToken: 'r' } }),
    }),
  );
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'u1', name: '管理员', email: 'admin@accessbase.local', status: 'active',
          tenantId: '00000000-0000-0000-0000-000000000001', tenantIsDefault: true,
          roles: [{ name: 'admin', permissions: ['*'] }],
        },
      }),
    }),
  );
  await page.route('**/api/v1/stats**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) }),
  );
  await page.route('**/api/v1/auth/refresh', (r) => r.fulfill({ status: 401, body: '{}' }));
  // page-data catch-all: empty lists keep every page mountable
  await page.route(/\/api\/v1\/(users|roles|groups|tenants|clients|api-keys|webhooks|events|audit-logs|options)\??/, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [], total: 0 }),
    }),
  );
  // S3.5: rows so the cell components are actually visible in the capture
  // (registered AFTER the catch-all = takes precedence)
  await page.route('**/api/v1/users**', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            total: 3,
            data: [
              { id: 'u1', name: 'Ada Lovelace', email: 'ada@accessbase.local', status: 'active', isActive: true, tenantId: '00000000-0000-0000-0000-000000000001', createdAt: '2026-11-01T10:00:00Z', roles: [{ id: 'r1', name: 'admin' }, { id: 'r2', name: 'editor' }] },
              { id: 'u2', name: 'Grace Hopper', email: 'grace@accessbase.local', status: 'suspended', isActive: false, tenantId: '00000000-0000-0000-0000-000000000001', createdAt: '2026-11-03T09:30:00Z', roles: [{ id: 'r3', name: 'viewer' }] },
              { id: 'u3', name: 'Alan Turing', email: 'alan@accessbase.local', status: 'pending', isActive: false, tenantId: '00000000-0000-0000-0000-000000000001', createdAt: '2026-11-05T14:12:00Z', roles: [] },
            ],
          }),
        })
      : r.fallback(),
  );

  // login → shell
  await page.goto('/login');
  await page.locator('input#email').fill('admin@accessbase.local');
  await page.locator('input#password').fill('AdminPass123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard|users|tenants/, { timeout: 15_000 });
  for (const p of PAGES) {
    await page.goto(p.route);
    await page.waitForTimeout(600); // render settle
    await page.screenshot({
      path: path.join(OUT, 'app', `${p.name}.png`),
      fullPage: false,
    });
  }
});

// S10.1: the setup wizard is a real first-run surface — captured under an
// UNINITIALIZED status (its own mocks; the generic app capture assumes done).
test('capture: setup wizard (uninitialized) admin step', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('lng', 'zh'));
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], total: 0 }) })
      : route.fallback(),
  );
  await page.route('**/api/v1/setup/status', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }),
    }),
  );
  await page.goto('/setup');
  await page.getByRole('button', { name: /开始|Start/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /下一步|Next/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'app', 'setup-wizard.png') });
});
