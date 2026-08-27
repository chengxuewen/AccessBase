import { test, expect } from '@playwright/test';

test.describe('Users CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.locator('input#email, input[id="email"]').fill('admin@accessbase.local');
    await page.locator('input#password, input[id="password"]').fill('AdminPass123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('create user', async ({ page }) => {
    const ts = Date.now();
    await page.goto('/users');
    await expect(page.locator('th')).toContainText(/name/i, { timeout: 10000 });

    await page.locator('button:has-text("Create"), button:has-text("+")').first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    const inputs = page.locator('.ant-modal input:visible');
    await inputs.nth(0).fill(`E2E User ${ts}`);
    await inputs.nth(1).fill(`e2e-${ts}@test.local`);
    await page.locator('.ant-modal input[type="password"]:visible').fill('E2ePass123!');

    await page.locator('.ant-modal button:has-text("OK")').click();
    await expect(page.locator(`td:has-text("E2E User ${ts}")`)).toBeVisible({ timeout: 10000 });
  });

  test('edit user', async ({ page }) => {
    const ts = Date.now();
    await page.goto('/users');
    await expect(page.locator('th')).toContainText(/name/i, { timeout: 10000 });

    await page.locator('a:has-text("Edit")').first().click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    await page.locator('.ant-modal input:visible').first().clear();
    await page.locator('.ant-modal input:visible').first().fill(`Updated ${ts}`);
    await page.locator('.ant-modal button:has-text("OK")').click();

    await expect(page.locator(`td:has-text("Updated ${ts}")`)).toBeVisible({ timeout: 10000 });
  });

  test('delete user', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('th')).toContainText(/name/i, { timeout: 10000 });

    // Get first row
    const firstRow = page.locator('tbody tr').first();
    const name = await firstRow.locator('td').first().textContent();

    // Click delete on first row
    await firstRow.locator('a:has-text("Delete")').click();

    // Confirm
    await page.locator('.ant-popconfirm button:has-text("OK"), .ant-popconfirm button:has-text("Yes")').first().click();

    // Verify row changed
    await page.waitForTimeout(2000);
  });

  test('search users', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('th')).toContainText(/name/i, { timeout: 10000 });

    const searchInput = page.locator('input[placeholder]').first();
    await searchInput.fill('admin');
    await page.locator('button:has-text("Search"), button:has-text("查询"), button:has-text("Submit")').first().click();

    await page.waitForTimeout(2000);
  });
});
