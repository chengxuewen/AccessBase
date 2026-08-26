import { test, expect } from '@playwright/test';

test.describe('Setup Wizard', () => {
  test('full setup flow: welcome → admin → config → complete → login', async ({ page }) => {
    // Step 1: 访问首页 → 跳转 /setup
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/);

    // Step 2: WelcomeStep — 点击 Start Setup，等检查完成
    await expect(page.locator('h2#welcome-title')).toBeVisible();
    await page.locator('button:has-text("Start Setup")').click();
    await expect(page.locator('.anticon-check-circle')).toHaveCount(4, { timeout: 15000 });
    await page.locator('button:has-text("Next")').click();

    // Step 3: AdminStep — 填写管理员
    await expect(page.locator('h2#admin-title')).toBeVisible({ timeout: 5000 });
    await page.locator('input#name').fill('Test Admin');
    await page.locator('input#email').fill('admin@test.local');
    await page.locator('input#password').fill('TestPassword123!');
    await page.locator('input#confirmPassword').fill('TestPassword123!');
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/setup/admin')),
      page.locator('button:has-text("Next")').click(),
    ]);

    // Step 4: ConfigStep — Skip 跳过配置
    await expect(page.locator('h2')).toContainText(/config/i, { timeout: 5000 });
    await page.locator('button:has-text("Skip")').click();

    // Step 5-6: CompleteStep 自动完成 → navigate 到 Dashboard
    // setup 完成后已登录，直接进 Dashboard
    await expect(page).toHaveURL(/\/dashboard|\/$/, { timeout: 15000 });
    await expect(page.locator('h2')).toContainText(/dashboard/i);
  });

  test('setup page redirects away after initialization', async ({ page }) => {
    await page.goto('/setup');
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/setup');
  });

  test('login page accessible after setup', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input#email, input[id="email"]')).toBeVisible();
    await expect(page.locator('input#password, input[id="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
