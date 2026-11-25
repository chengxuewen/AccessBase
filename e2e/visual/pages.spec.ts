/**
 * W0.3 — visual baselines (UI alignment plan rev.5).
 *
 * Determinism checklist (run-2 H-6 folds): animations disabled, caret hidden,
 * scrollbars hidden, locale pinned zh, fonts awaited, dedicated project
 * workers:1 (set in playwright.config.ts `visual` project), dynamic regions
 * masked via `mask:` (cheaper than per-cell testids).
 *
 * Baselines are shot on the CURRENT look (Ant pack, pre-S1) — S1 re-baselines
 * them deliberately at the user checkpoint (A-1=B: the default-side diff is
 * expected minimal).
 */
import { test, expect } from '@playwright/test';
import { mockSetupStatus, mockStats, mockAuthStatusTrio, mockMe } from '../fixtures/mocks';

const PAGES: Array<{ path: string; name: string; masks?: string[] }> = [
  { path: '/dashboard', name: 'dashboard', masks: ['[data-testid="stats-"]'] },
  { path: '/users', name: 'users' },
  { path: '/roles', name: 'roles' },
  { path: '/groups', name: 'groups' },
  { path: '/tenants', name: 'tenants' },
  { path: '/clients', name: 'clients' },
  { path: '/api-keys', name: 'api-keys' },
  { path: '/webhooks', name: 'webhooks' },
  { path: '/audit', name: 'audit', masks: ['text=/\\d{4}-\\d{2}-\\d{2}/'] },
  { path: '/events', name: 'events', masks: ['text=/\\d{4}-\\d{2}-\\d{2}/'] },
  { path: '/settings', name: 'settings' },
  { path: '/profile', name: 'profile' },
];

test.describe.configure({ mode: 'serial' });

for (const p of PAGES) {
  test(`visual baseline: ${p.name} (light)`, async ({ page }) => {
    await mockSetupStatus(page);
    await mockMe(page);
    await mockStats(page, { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] });
    await mockAuthStatusTrio(page);
    await page.addInitScript(() => {
      localStorage.setItem('lng', 'zh');
      localStorage.setItem('ui-storage', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
    });
    await page.goto(p.path);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400); // antd cssinjs settle + ProTable first paint
    await expect(page).toHaveScreenshot(`${p.name}-light.png`, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.002,
      ...(p.masks ? { mask: p.masks.map((m) => page.locator(m).first()) } : {}),
    });
  });

  test(`visual baseline: ${p.name} (dark)`, async ({ page }) => {
    await mockSetupStatus(page);
    await mockMe(page);
    await mockStats(page, { users: 0, roles: 0, activeSessions: 0, audits: 0, recentActivity: [] });
    await mockAuthStatusTrio(page);
    await page.addInitScript(() => {
      localStorage.setItem('lng', 'zh');
      localStorage.setItem('ui-storage', JSON.stringify({ state: { theme: 'dark' }, version: 0 }));
    });
    await page.goto(p.path);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot(`${p.name}-dark.png`, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.002,
      ...(p.masks ? { mask: p.masks.map((m) => page.locator(m).first()) } : {}),
    });
  });
}
