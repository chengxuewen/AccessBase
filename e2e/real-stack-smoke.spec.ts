/**
 * W0.7 — real-stack smoke lane (rev.5 revised form).
 *
 * HONEST boot story: `waitForServer` waits for an already-running stack;
 * `restartServer` is the only full-boot path (with known fragilities this
 * lane fixes first: /tmp/opencode mkdir, port conflicts, env coupling).
 * `resetBackend` is DESTRUCTIVE (drop/recreate) — this lane targets a
 * SCRATCH database, NEVER the dev database.
 *
 * Tiering (rev.5): login/logout + ONE canonical CRUD (users) = MANDATORY
 * minimal set at S1/S3/S10 pre-merge (≈3-5min warm). Per-family CRUD rides
 * ITS OWN slice (S4-S9). Full floor (12 families + MFA + OAuth) = on-demand
 * + S10. CI stays local-only (ci.yml keeps backend DOWN).
 *
 * Locators: verbatim from auth-session.spec (input#email/#password +
 * button[type=submit]) and users-crud's zh-form shapes — no invented testids.
 */
import { test, expect } from '@playwright/test';
import {
  resetBackendScratch,
  waitForServer,
  restartServerScratch,
} from './helpers/backend-control';

test.describe.configure({ mode: 'serial' });

const EMAIL = 'lanes@it.local';
const PASSWORD = 'LanesReal-123';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard|users|tenants/, { timeout: 20_000 });
}

test.describe('real-stack smoke (W0.7 — project setup-real)', () => {
  test('boot: scratch DB reset + wizard + login round-trip', { timeout: 240_000 }, async ({
    page,
  }) => {
    // Scratch DB — the dev database is NEVER touched (rev.5 mandate).
    await resetBackendScratch();
    try {
      await waitForServer();
    } catch {
      // cold path: stack NOT running — boot the stack pointed AT THE SCRATCH DB.
      await restartServerScratch();
      await waitForServer();
    }
    // Idempotency guard (serial reruns): an already-initialized scratch DB
    // skips the wizard — log in directly and the round-trip still proves.
    await page.goto('/login');
    const alreadyInitialized = await page
      .locator('input#email')
      .isVisible()
      .catch(() => false);
    if (alreadyInitialized) {
      await login(page);
      await page.getByTestId('user-dropdown').click();
      await page.getByRole('menuitem', { name: /退出|Logout/ }).click();
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
      return;
    }

    // Wizard: the fresh DB needs its admin (setup-real-flow T5.1 shape).
    // Four-step flow: Welcome (run checks → Next) → Admin → Config → Complete.
    await page.goto('/setup');
    // Welcome step: start checks, wait for them to finish, then Next.
    await page.getByRole('button', { name: /开始|Start/ }).click();
    await page.waitForTimeout(2500); // checks run against the live stack
    await page.getByRole('button', { name: /下一步|Next/ }).click();
    // Admin step: create the admin.
    await page.locator('input#name').fill('Real Stack');
    await page.locator('input#email').fill(EMAIL);
    await page.locator('input#password').fill(PASSWORD);
    await page.locator('input#confirmPassword').fill(PASSWORD);
    await page.getByRole('button', { name: /下一步|Next/ }).click();
    await expect(page.locator('input#email')).toBeHidden({ timeout: 30_000 });

    // Login round-trip against the REAL API.
    await login(page);

    // Logout closes the loop.
    await page.getByTestId('user-dropdown').click();
    await page.getByRole('menuitem', { name: /退出|Logout/ }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('canonical CRUD: users create → read → update → delete (REAL API)', {
    timeout: 120_000,
  }, async ({ page }) => {
    await login(page);
    await page.goto('/users');

    const suffix = Date.now();
    // create — /users/create page (shape verbatim from users-crud.spec:390)
    await page.getByRole('button', { name: /创建用户|Create/ }).first().click();
    await expect(page).toHaveURL(/\/users\/create/, { timeout: 15_000 });
    const card = page.locator('.ant-card');
    const nameInput = card.locator('input#name');
    const emailInput = card.locator('input#email');
    await nameInput.fill(`real-${suffix}`);
    await emailInput.fill(`real-${suffix}@it.local`);
    await card.locator('input#password').fill('RealUser-123');
    await card.locator('input#confirmPassword').fill('RealUser-123');
    // AntD controlled-input timing: values must be COMMITTED before submit
    await expect(nameInput).toHaveValue(`real-${suffix}`);
    await expect(emailInput).toHaveValue(`real-${suffix}@it.local`);
    await card.locator('button[type="submit"]').click();
    // Navigates back to list, new row visible
    await expect(page).toHaveURL(/\/users$/, { timeout: 10_000 });
    await expect(page.locator(`td:has-text("${`real-${suffix}@it.local`}")`)).toBeVisible();

    // update: /users/:id/edit is a ROUTE PAGE (Users.tsx:86), not a modal.
    // Save stays on the edit page (no redirect — observed live); assert the
    // PUT landed by re-reading the row on the list.
    const row = page.locator('tr', { has: page.getByText(`real-${suffix}@it.local`) });
    await row.getByRole('button', { name: /编辑|Edit/ }).first().click();
    await expect(page).toHaveURL(/\/users\/.+\/edit/, { timeout: 15_000 });
    const editCard = page.locator('.ant-card').first();
    const editName = editCard.locator('input#name');
    await expect(editName).toBeVisible();
    await editName.fill(`real-renamed-${suffix}`);
    await expect(editName).toHaveValue(`real-renamed-${suffix}`);
    // submit ONLY after the fill has landed in the controlled input (the
    // un-scoped fill above hit a different/hidden form — PUT carried the
    // original name, 200, no-op).
    await editCard.locator('button[type="submit"]').first().click();
    await expect(page.locator('.ant-message-success, .ant-alert-success').first()).toBeVisible({
      timeout: 10_000,
    });
    await page.goto('/users');
    await expect(page.locator(`td:has-text("${`real-renamed-${suffix}`}")`)).toBeVisible();

    // delete: popconfirm → row gone
    const row2 = page.locator('tr', { has: page.getByText(`real-renamed-${suffix}`) });
    await row2.getByRole('button', { name: /删除|Delete/ }).first().click();
    await page.locator('.ant-popconfirm .ant-btn-primary').click();
    await expect(page.getByText(`real-renamed-${suffix}`)).toBeHidden({ timeout: 15_000 });
  });
});
