import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('visits login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Login')).toBeVisible();
    await expect(page.locator('input[id="email"]')).toBeVisible();
    await expect(page.locator('input[id="password"]')).toBeVisible();
  });

  test('shows validation errors for empty fields', async ({ page }) => {
    await page.goto('/login');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('text=Please input your email')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[id="email"]').fill('invalid@example.com');
    await page.locator('input[id="password"]').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.ant-message-error')).toBeVisible();
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    // Stub the login API
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 3600,
          },
        }),
      });
    });

    await page.goto('/login');
    await page.locator('input[id="email"]').fill('admin@example.com');
    await page.locator('input[id="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();

    await page.waitForURL('/');
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('logout clears session', async ({ page }) => {
    // Stub login
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 3600,
          },
        }),
      });
    });

    await page.goto('/login');
    await page.locator('input[id="email"]').fill('admin@example.com');
    await page.locator('input[id="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('/');

    // Find and click logout button
    await page.locator('[data-testid="logout"]').click();
    await page.waitForURL('/login');
  });
});
