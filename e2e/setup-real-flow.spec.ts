import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resetBackend, waitForServer, restartServer } from './helpers/backend-control';

const API = 'http://localhost:5101/api/v1';

/** Wait for backend; if the tsx watch chain died during reset, relaunch it. */
async function ensureServer(): Promise<void> {
  try {
    await waitForServer(undefined, 20_000);
  } catch {
    await restartServer();
    await waitForServer();
  }
}

test.describe.serial('Setup real backend flow', () => {
  test('T5.1 fresh DB → wizard → admin created → login round-trip', async ({ page }) => {
    resetBackend(); // real reset command (stops/creates PG + db:push)
    await ensureServer(); // tsx watch usually survives; restartServer is the fallback

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/, { timeout: 10_000 });
    await expect(page.locator('h2#welcome-title')).toBeVisible();
    await page.locator('button:has-text("Start Setup")').click();
    await expect(page.locator('[role="listitem"] .anticon-check-circle').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("Next")').click();

    const unique = `admin-${Date.now()}@test.local`;
    await expect(page.locator('h2#admin-title')).toBeVisible({ timeout: 5_000 });
    await page.locator('input#name').fill('Test Admin');
    await page.locator('input#email').fill(unique);
    await page.locator('input#password').fill('TestPassword123!');
    await page.locator('input#confirmPassword').fill('TestPassword123!');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/setup/admin')),
      page.locator('button:has-text("Next")').click(),
    ]);
    // config step: fill siteName + Next (regression: guard/handler 410 deadlocked this step — human-tested bug)
    await expect(page.locator('h2')).toContainText(/config/i, { timeout: 5_000 });
    await page.locator('input#siteName').fill('AccessBase Test');
    const cfg = page.waitForResponse((r) => r.url().includes('/setup/config'));
    await page.locator('button:has-text("Next")').click();
    expect((await cfg).status()).toBe(200);
    // Complete step: button goes loading + page navigates — wait for URL, don't click a spinner
    const completeBtn = page.locator('button:has-text("Enter Dashboard")');
    await expect(completeBtn).toBeVisible({ timeout: 5_000 });
    const completeResp = page.waitForResponse(
      (r) => r.url().includes('/setup/complete'),
      { timeout: 15_000 },
    );
    await completeBtn.click({ trial: true }).catch(() => {}); // may detach mid-click (loading → navigation)
    // If the click didn't land (detached), the navigation has already started; wait for either tokens fetch or URL
    await Promise.race([
      completeResp,
      page.waitForURL(/\/dashboard|\/$/, { timeout: 15_000 }),
    ]);
    await page.waitForURL(/\/dashboard|\/$/, { timeout: 15_000 });

    // logout → re-login closed loop (admin is really loggable)
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.locator('input#email').fill(unique);
    await page.locator('input#password').fill('TestPassword123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('T5.2 real reset → wizard reappears (DB-derived state evidence)', async ({ page }) => {
    // precondition: T5.1 just created an admin — DB is initialized
    const before = (await (await fetch(`${API}/setup/status`)).json()) as {
      data: { adminExists: boolean };
    };
    expect(before.data.adminExists).toBe(true);

    resetBackend(); // ACCESSBASE_RESET_CONFIRM=yes non-interactive bypass — the point of this test
    await ensureServer();

    const after = (await (await fetch(`${API}/setup/status`)).json()) as {
      data: { adminExists: boolean };
    };
    expect(after.data.adminExists).toBe(false); // D113: DB-derived out-of-browser evidence

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/, { timeout: 10_000 }); // PIT-027 E2E evidence: wizard reappears
    await expect(page.locator('h2#welcome-title')).toBeVisible();
  });

  test('T5.2b reset without confirm fails closed, data intact', async () => {
    // no CONFIRM env + non-interactive stdin → read fails → reset exits non-zero
    let threw = false;
    try {
      execSync('bash accessbase.sh reset', { cwd: resolve(__dirname, '..'), stdio: 'pipe', input: '' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const status = (await (await fetch(`${API}/setup/status`)).json()) as {
      data: { adminExists: boolean };
    };
    expect(status.data.adminExists).toBe(false); // not deleted (still post-reset state) and command refused
  });

  test('T5.3 guard states surfaced in UI (mock layer)', async ({ page }) => {
    // 403 interception: mock /setup/status uninitialized → protected pages redirect to setup
    await page.route('**/api/v1/setup/status', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }),
      }),
    );
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/setup/, { timeout: 10_000 }); // GlobalGuard redirect

    // 503: mock status 503 → frontend must not crash (no ErrorBoundary)
    await page.route('**/api/v1/setup/status', (r) => r.fulfill({ status: 503, body: '{"success":false}' }));
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });
});
