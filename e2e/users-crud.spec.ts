import { test, expect } from '@playwright/test';

test.describe('Users CRUD', () => {
  test.beforeEach(async ({ page }) => {
    // Mock setup status as initialized so we go to /login, not /setup
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }),
      });
    });
    
    // Mock auth/me for post-login
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: ['admin'] }),
      });
    });

    // Mock login API
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 900, user: { id: '1', email: 'admin@accessbase.local', name: 'Administrator', roles: ['admin'] } },
        }),
      });
    });

    await page.goto('/login');
    await page.waitForTimeout(2000);
    await page.locator('input#email').fill('admin@accessbase.local');
    await page.locator('input#password').fill('AdminPass123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('create user', async ({ page }) => {
    const ts = Date.now();
    
    // Mock users list API
    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [{ id: '1', email: 'admin@accessbase.local', name: 'Administrator', isActive: true, tenantId: 't1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], total: 1 }),
        });
      }
    });
    
    // Mock create user API
    await page.route('**/api/v1/users', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { id: '2', email: `e2e-${ts}@test.local`, name: `E2E User ${ts}`, isActive: true, tenantId: 't1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
        });
      }
    });

    await page.goto('/users');
    await page.waitForTimeout(3000);

    await page.locator('button').filter({ hasText: /create|\+/i }).first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    const modalInputs = page.locator('.ant-modal input:visible');
    await modalInputs.nth(0).fill(`E2E User ${ts}`);
    await modalInputs.nth(1).fill(`e2e-${ts}@test.local`);
    await modalInputs.nth(2).fill('E2ePass123!');

    await page.locator('.ant-modal button:has-text("Confirm"), .ant-modal button:has-text("确认")').first().click();

    await expect(page.locator(`td:has-text("E2E User ${ts}")`)).toBeVisible({ timeout: 10000 });
  });

  test('edit user', async ({ page }) => {
    const ts = Date.now();
    
    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [{ id: '1', email: 'admin@accessbase.local', name: 'Administrator', isActive: true, tenantId: 't1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], total: 1 }),
        });
      }
    });
    
    await page.route('**/api/v1/users/1', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { id: '1', email: 'admin@accessbase.local', name: `Updated ${ts}`, isActive: true, tenantId: 't1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
        });
      }
    });

    await page.goto('/users');
    await page.waitForTimeout(3000);

    await page.locator('a:has-text("Edit")').first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    const nameInput = page.locator('.ant-modal input:visible').first();
    await nameInput.clear();
    await nameInput.fill(`Updated ${ts}`);

    await page.locator('.ant-modal button:has-text("Confirm"), .ant-modal button:has-text("确认")').first().click();

    await expect(page.locator(`td:has-text("Updated ${ts}")`)).toBeVisible({ timeout: 10000 });
  });

  test('delete user', async ({ page }) => {
    await page.route('**/api/v1/users?**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [{ id: '1', email: 'admin@accessbase.local', name: 'Administrator', isActive: true, tenantId: 't1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], total: 1 }),
        });
      }
    });
    
    await page.route('**/api/v1/users/1', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      }
    });

    await page.goto('/users');
    await page.waitForTimeout(3000);

    const firstRow = page.locator('tbody tr').first();
    await firstRow.locator('a:has-text("Delete")').click();

    await page.locator('.ant-popconfirm button:has-text("Confirm"), .ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes")').first().click();

    await page.waitForTimeout(3000);
  });

  test('search users', async ({ page }) => {
    await page.route('**/api/v1/users?**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{ id: '1', email: 'admin@accessbase.local', name: 'Administrator', isActive: true, tenantId: 't1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], total: 1 }),
      });
    });

    await page.goto('/users');
    await page.waitForTimeout(3000);

    const searchInput = page.locator('input[placeholder]').first();
    await searchInput.fill('admin');
    await page.locator('button').filter({ hasText: /search|查询|submit/i }).first().click();

    await page.waitForTimeout(2000);
  });
});
