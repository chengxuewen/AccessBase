import { test, expect } from '@playwright/test';

/**
 * 真实后端 reset 测试（不用 mock）
 *
 * 完整自包含流程:
 * 1. 在同一 browser context 中注入 localStorage 模拟旧版 currentStep 残留
 * 2. mock /setup/status 返回 isInitialized: false（模拟后端已 reset）
 * 3. 刷新页面
 * 4. 验证回到 WelcomeStep
 *
 * 注意: 此测试不依赖真实后端 setup 状态，通过注入 localStorage + mock status 完成。
 */
test('wizard restarts from WelcomeStep after backend reset (stale localStorage)', async ({ page }) => {
  // Step 1: 注入旧版 localStorage 残留（模拟之前完成过 setup）
  await page.goto('/');  // 先加载页面以设置 localStorage
  await page.evaluate(() => {
    localStorage.setItem('accessbase-setup-store', JSON.stringify({
      state: { currentStep: 3, formData: { admin: { email: 'old@test.local' } } },
      version: 0,
    }));
  });

  // Step 2: mock 后端已 reset
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }),
    });
  });

  // Step 3: 刷新页面（同一 browser context，localStorage 仍有残留）
  await page.goto('/');

  // Step 4: 验证回到 WelcomeStep（不是 CompleteStep）
  await expect(page).toHaveURL(/\/setup/, { timeout: 5000 });
  await expect(page.locator('h2#welcome-title')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('button:has-text("Start Setup")')).toBeVisible();
});
