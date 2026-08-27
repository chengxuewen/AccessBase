import { test, expect } from '@playwright/test';

test.describe('Users CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForTimeout(2000);
    await page.locator('input#email').fill('admin@accessbase.local');
    await page.locator('input#password').fill('AdminPass123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('create user', async ({ page }) => {
    const ts = Date.now();
    await page.goto('/users');
    await page.waitForTimeout(3000);

    // Click create button
    await page.locator('button').filter({ hasText: /create|\+/i }).first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    // Fill form
    const modalInputs = page.locator('.ant-modal input:visible');
    await modalInputs.nth(0).fill(`E2E User ${ts}`);
    await modalInputs.nth(1).fill(`e2e-${ts}@test.local`);
    await modalInputs.nth(2).fill('E2ePass123!');

    // Submit (button text is "Confirm" / "确认")
    await page.locator('.ant-modal button:has-text("Confirm"), .ant-modal button:has-text("确认")').first().click();

    // Verify in table
    await expect(page.locator(`td:has-text("E2E User ${ts}")`)).toBeVisible({ timeout: 10000 });
  });

  test('edit user', async ({ page }) => {
    const ts = Date.now();
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
    await page.goto('/users');
    await page.waitForTimeout(3000);

    const firstRow = page.locator('tbody tr').first();
    await firstRow.locator('a:has-text("Delete")').click();

    await page.locator('.ant-popconfirm button:has-text("Confirm"), .ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes")').first().click();

    await page.waitForTimeout(3000);
  });

  test('search users', async ({ page }) => {
    await page.goto('/users');
    await page.waitForTimeout(3000);

    const searchInput = page.locator('input[placeholder]').first();
    await searchInput.fill('admin');
    await page.locator('button').filter({ hasText: /search|查询|submit/i }).first().click();

    await page.waitForTimeout(2000);
  });
});
