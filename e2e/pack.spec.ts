import { test, expect, type Page } from '@playwright/test';
import { mockSetupStatus } from './fixtures/mocks';

/**
 * S1 (plan rev.5 test (e)): pack axis — default Ant, labeled selector flips
 * BOTH the data-pack axis and the injected contract cssVars, and the choice
 * persists via ui-storage (partialize includes pack, run-3 F7).
 *
 * NOTE (honest scoping): the plan's original "first-frame no-mixed-state"
 * screenshot form was falsified by panel run 3 (screenshots wait for
 * stability — a 1-2 frame flash is invisible); the settled-state computed
 * assertions below are the implementable form. True frame-sampling flash
 * detection stays LEDGERED (S1 checkpoint manual eyeball covers it).
 */

async function gotoLogin(page: Page): Promise<void> {
  await mockSetupStatus(page);
  await page.goto('/login');
  await expect(page.locator('input#email')).toBeVisible();
}

async function loginToShell(page: Page): Promise<void> {
  await mockSetupStatus(page);
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { accessToken: 'e2e-token', refreshToken: 'e2e-refresh' },
      }),
    }),
  );
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 'u1',
          name: 'E2E Admin',
          email: 'admin@accessbase.local',
          status: 'active',
          tenantId: '00000000-0000-0000-0000-000000000001',
          tenantIsDefault: true,
          roles: [{ name: 'admin', permissions: ['*'] }],
        },
      }),
    }),
  );
  // Dashboard mounts GET /stats — unmocked 401 would axios-logout (layout.spec lesson)
  await page.route('**/api/v1/stats**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    }),
  );
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/login');
  await page.locator('input#email').fill('admin@accessbase.local');
  await page.locator('input#password').fill('E2ePass-123');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard|users|tenants/, { timeout: 15_000 });
}

async function accentVar(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );
}

test.describe('pack axis (S1)', () => {
  test('default pack is ant — data-pack axis + injected cssVars', async ({ page }) => {
    await gotoLogin(page);
    await expect(page.locator('html')).toHaveAttribute('data-pack', 'ant');
    expect(await accentVar(page)).toBe('#1677FF'); // ant light accent (contract)
  });

  test('seeded broadsheet preference flips the axis + accent (persistence read side)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { theme: 'light', pack: 'broadsheet' }, version: 0 }),
      );
    });
    await gotoLogin(page);
    await expect(page.locator('html')).toHaveAttribute('data-pack', 'broadsheet');
    expect(await accentVar(page)).toBe('#0F5C5A'); // broadsheet light accent
  });

  test('shell selector: labeled Segmented flips pack and PERSISTS across reload', async ({
    page,
  }) => {
    await loginToShell(page);
    const selector = page.getByTestId('pack-select');
    await expect(selector).toBeVisible();
    // default selection = Ant (A-1=B)
    await expect(selector.locator('.ant-segmented-item-selected')).toHaveText('Ant');
    // flip to Broadsheet
    await selector.getByText('Broadsheet', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-pack', 'broadsheet');
    expect(await accentVar(page)).toBe('#0F5C5A');
    // persisted in ui-storage (partialize includes pack — run-3 F7)
    const stored = await page.evaluate(() => localStorage.getItem('ui-storage'));
    expect(stored).toContain('"pack":"broadsheet"');
    // reload keeps the choice
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-pack', 'broadsheet', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('pack-select')).toBeVisible();
  });
});
