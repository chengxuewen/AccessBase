import { test, expect, type Page } from '@playwright/test';
import { mockSetupStatus, mockLogin, mockMe } from './fixtures/mocks';

/**
 * S10 B-lite (user ruling): contract `data-prio` columns hide on narrow screens
 * via antd's native column `responsive` — prio2 → ['lg'] (hidden < 992px),
 * prio3 → ['xl'] (hidden < 1200px). Desktop viewports keep every column.
 */
async function loginToShell(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('lng', 'zh'));
  // LOWEST-precedence GET fallback FIRST (Playwright: last-registered wins, so
  // the specific mocks below must come after it): lists return empty, the page
  // never 401-logs out mid-test.
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [], total: 0 }),
        })
      : route.fallback(),
  );
  await mockSetupStatus(page);
  await mockLogin(page);
  await mockMe(page, { permissions: ['users:read', 'audit:read', 'stats:read'] });
  await page.goto('/login');
  await page.locator('input#email').fill('admin@accessbase.local');
  await page.locator('input#password').fill('AdminPass123!');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.ant-layout-sider')).toBeVisible({ timeout: 15_000 });
}

/** SPA navigation through the sidebar (a full reload races the route guard
 *  against the async /me hydration — probe-caught 403). */
async function gotoViaSider(page: Page, label: string): Promise<void> {
  await page.locator('.ant-menu-item', { hasText: label }).first().click();
  await expect(page).toHaveURL(new RegExp(label === '用户' ? '/users' : '/audit'));
}

test.describe('responsive tables (S10 B-lite — contract data-prio)', () => {
  test('users: tenant(prio2) + created(prio3) hide on narrow screens, return on desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginToShell(page);
    await gotoViaSider(page, '用户');
    await expect(page.locator('thead').first()).toBeVisible();
    const tenantCol = page.locator('thead th:has-text("租户"), thead th:has-text("Tenant")');
    const createdCol = page.locator('thead th:has-text("创建时间"), thead th:has-text("Created")');
    await expect(tenantCol).toHaveCount(1); // desktop: every column present
    await expect(createdCol).toHaveCount(1);

    // narrow (900 < lg 992): both priority columns gone
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(tenantCol).toHaveCount(0);
    await expect(createdCol).toHaveCount(0);
    // the essential columns stay
    await expect(page.locator('thead th:has-text("姓名"), thead th:has-text("User")')).toBeVisible();
    await expect(page.locator('thead th:has-text("状态"), thead th:has-text("Status")')).toBeVisible();
  });

  test('audit: resource(prio2) + ip(prio3) hide below lg', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await loginToShell(page);
    await gotoViaSider(page, '审计');
    await expect(page.locator('thead').first()).toBeVisible();
    await expect(page.locator('thead th:has-text("IP")')).toHaveCount(0);
    await expect(page.locator('thead th:has-text("资源"), thead th:has-text("Resource")')).toHaveCount(0);
  });
});
