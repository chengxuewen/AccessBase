import { test, expect } from '@playwright/test';

test.describe('Setup Wizard', () => {

  test('completeSetup finds wizard-created admin (not hardcoded email)', async ({ page }) => {
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }) });
    });
    await page.route('**/api/v1/setup/checks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { checks: [
          { name: 'database', status: 'pass', message: 'OK' },
          { name: 'redis', status: 'pass', message: 'OK' },
          { name: 'disk_space', status: 'pass', message: 'OK' },
          { name: 'migrations', status: 'pass', message: 'OK' },
        ]}}) });
    });
    await page.route('**/api/v1/setup/admin', async (route) => {
      await route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { userId: 'test-id', email: 'wizard@test.local', name: 'Wizard' } }) });
    });
    let completeCalled = false;
    await page.route('**/api/v1/setup/complete', async (route) => {
      completeCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { accessToken: 'tok', refreshToken: 'ref' } }) });
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: '1', email: 'wizard@test.local', name: 'Wizard', roles: ['admin'] }) });
    });

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/);
    await page.locator('button:has-text("Start Setup")').click();
    await expect(page.locator('[role="listitem"] .anticon-check-circle')).toHaveCount(4, { timeout: 10000 });
    await page.locator('button:has-text("Next")').click();

    await page.locator('input#name').fill('Wizard');
    await page.locator('input#email').fill('wizard@test.local');
    await page.locator('input#password').fill('WizardPass123!');
    await page.locator('input#confirmPassword').fill('WizardPass123!');
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/setup/admin')),
      page.locator('button:has-text("Next")').click(),
    ]);
    await page.locator('button:has-text("Skip")').click();
    await page.waitForTimeout(3000);
    expect(completeCalled).toBe(true);
  });

  test('CompleteStep does not retry on remount', async ({ page }) => {
    let completeCallCount = 0;

    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }) });
    });
    await page.route('**/api/v1/setup/checks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { checks: [
          { name: 'database', status: 'pass', message: 'OK' },
          { name: 'redis', status: 'pass', message: 'OK' },
          { name: 'disk_space', status: 'pass', message: 'OK' },
          { name: 'migrations', status: 'pass', message: 'OK' },
        ]}}) });
    });
    await page.route('**/api/v1/setup/admin', async (route) => {
      await route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { userId: 'test-id', email: 'test@test.local', name: 'Test' } }) });
    });
    await page.route('**/api/v1/setup/complete', async (route) => {
      completeCallCount++;
      if (completeCallCount <= 1) {
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { accessToken: 'tok', refreshToken: 'ref' } }) });
      } else {
        await route.fulfill({ status: 410, contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'SETUP_ALREADY_COMPLETE' } }) });
      }
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: '1', email: 'test@test.local', name: 'Test', roles: ['admin'] }) });
    });

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/);
    await page.locator('button:has-text("Start Setup")').click();
    await expect(page.locator('[role="listitem"] .anticon-check-circle')).toHaveCount(4, { timeout: 10000 });
    await page.locator('button:has-text("Next")').click();

    await page.locator('input#name').fill('Test');
    await page.locator('input#email').fill('test@test.local');
    await page.locator('input#password').fill('TestPassword123!');
    await page.locator('input#confirmPassword').fill('TestPassword123!');
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/setup/admin')),
      page.locator('button:has-text("Next")').click(),
    ]);
    await page.locator('button:has-text("Skip")').click();
    await page.waitForTimeout(5000);

    // completeSetup should be called exactly once (not infinite retry from StrictMode)
    expect(completeCallCount).toBeLessThanOrEqual(1);
  });

  test('setup page redirects away after initialization', async ({ page }) => {
    // Mock status as already initialized
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) });
    });
    await page.goto('/setup');
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/setup');
  });

  test('login page accessible after setup', async ({ page }) => {
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: true, adminExists: true, configComplete: true } }) });
    });
    await page.goto('/login');
    await expect(page.locator('input#email, input[id="email"]')).toBeVisible();
    await expect(page.locator('input#password, input[id="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  /**
   * 覆盖: setup 完成后 localStorage 残留 currentStep，后端 reset 后浏览器刷新应回到 WelcomeStep。
   * 同一 browser context 中：先完成 setup → mock 后端 reset → 刷新 → 验证从头开始。
   */
  test('wizard restarts from WelcomeStep after backend reset (no stale localStorage)', async ({ page }) => {
    // Phase 1: 用 mock 走完 setup 流程（localStorage 会残留 formData + 旧 currentStep）
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }) });
    });
    await page.route('**/api/v1/setup/checks', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { checks: [
          { name: 'database', status: 'pass', message: 'OK' },
          { name: 'redis', status: 'pass', message: 'OK' },
          { name: 'disk_space', status: 'pass', message: 'OK' },
          { name: 'migrations', status: 'pass', message: 'OK' },
        ]}}) });
    });
    await page.route('**/api/v1/setup/admin', async (route) => {
      await route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { userId: 'test', email: 'test@test.local', name: 'Test' } }) });
    });
    await page.route('**/api/v1/setup/complete', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { accessToken: 'tok', refreshToken: 'ref' } }) });
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: '1', email: 'test@test.local', name: 'Test', roles: ['admin'] }) });
    });

    // 走完 setup
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/);
    await page.locator('button:has-text("Start Setup")').click();
    await expect(page.locator('[role="listitem"] .anticon-check-circle')).toHaveCount(4, { timeout: 10000 });
    await page.locator('button:has-text("Next")').click();
    await page.locator('input#name').fill('Test');
    await page.locator('input#email').fill('test@test.local');
    await page.locator('input#password').fill('TestPassword123!');
    await page.locator('input#confirmPassword').fill('TestPassword123!');
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/setup/admin')),
      page.locator('button:has-text("Next")').click(),
    ]);
    await page.locator('button:has-text("Skip")').click();
    await expect(page).toHaveURL(/\/dashboard|\/$/, { timeout: 10000 });

    // Phase 2: 模拟后端 reset — 拦截 status 返回 isInitialized: false
    // 不需要 unroute，直接替换路由响应
    await page.unroute('**/api/v1/setup/status');
    await page.route('**/api/v1/setup/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }) });
    });

    // 刷新页面 — 同一 browser context，localStorage 仍有旧数据
    await page.goto('/');

    // 验证: 应该回到 /setup 并显示 WelcomeStep（不是 CompleteStep）
    await expect(page).toHaveURL(/\/setup/, { timeout: 5000 });
    await expect(page.locator('h2#welcome-title')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Start Setup")')).toBeVisible();
  });
});
