/**
 * W0.2 — shared e2e mock fixtures (UI alignment plan rev.5).
 *
 * PIT-033 discipline PRESERVED: shapes mirror the real routes verbatim — the
 * point of this module is SINGLE-POINT MAINTENANCE of those shapes, not
 * abstraction. Everything here was extracted byte-identical from the specs'
 * inline blocks (the 40× setup/status, 36× auth/me, 27× stats, 20×
 * saml/status, 19× sms/status, 19× captcha/status families).
 *
 * Override-timing rule: helpers register routes; a spec that needs a
 * DIFFERENT shape for one route registers its own `page.route` AFTER the
 * helper call inside the test body — Playwright routes are last-registered-wins.
 */
import type { Page } from '@playwright/test';

const json = (body: unknown, status = 200): {
  status: number;
  contentType: string;
  body: string;
} => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// identity payloads (verbatim shapes from the inline blocks)
// ---------------------------------------------------------------------------

export interface MePayload {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  tenantId: string;
  tenantIsDefault: boolean;
  tenantName: string;
}

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** A permissive /me — specs overriding permissions spread over it. */
export const FULL_PERMS_ME: MePayload = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Administrator',
  email: 'admin@accessbase.local',
  roles: ['admin'],
  permissions: ['*'],
  tenantId: DEFAULT_TENANT_ID,
  tenantIsDefault: true,
  tenantName: 'Default',
};

/** Stats — NO canonical shape: each spec asserts its own (clients uses
 * {users,roles,activeSessions,audits,recentActivity}; dashboard others).
 * Pass the spec's verbatim object — the helper is a transport, not a schema. */
export async function mockStats(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.route('**/api/v1/stats', async (route) => {
    await route.fulfill(json({ success: true, data }));
  });
}

// ---------------------------------------------------------------------------
// helpers — each replaces the N× copy-pasted block family
// ---------------------------------------------------------------------------

/** setup/status — 40×. Verbatim shape. */
export async function mockSetupStatus(
  page: Page,
  data: { isInitialized: boolean; adminExists: boolean; configComplete: boolean } = {
    isInitialized: true,
    adminExists: true,
    configComplete: true,
  },
): Promise<void> {
  await page.route('**/api/v1/setup/status', async (route) => {
    await route.fulfill(json({ success: true, data }));
  });
}

/** auth/me — 36×. Pass a partial to override fields (spread over FULL_PERMS_ME). */
export async function mockMe(page: Page, over: Partial<MePayload> = {}): Promise<void> {
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill(json({ success: true, data: { ...FULL_PERMS_ME, ...over } }));
  });
}

/** saml/sms/captcha status trio — 20/19/19×. The enabled:false default is the
 * verbatim shape; enabled:true specs register their own richer body after. */
export async function mockAuthStatusTrio(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/saml/status', async (route) => {
    await route.fulfill(json({ success: true, data: { enabled: false } }));
  });
  await page.route('**/api/v1/auth/sms/status', async (route) => {
    await route.fulfill(json({ success: true, data: { enabled: false } }));
  });
  await page.route('**/api/v1/auth/captcha/status', async (route) => {
    await route.fulfill(json({ success: true, data: { enabled: false } }));
  });
}

/** auth/login — 16×. Verbatim token-pair shape. */
export async function mockLogin(
  page: Page,
  tokens: { accessToken: string; refreshToken: string } = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
  },
): Promise<void> {
  await page.route('**/api/v1/auth/login', async (route) => {
    await route.fulfill(json({ success: true, data: tokens }));
  });
}

// ---------------------------------------------------------------------------
// console-error whitelist (A-4=B): strictest-core + named per-file exceptions
// ---------------------------------------------------------------------------

/**
 * The INTERSECTION of the three pre-consolidation whitelists
 * (users-crud:55-62 wide / ui-quality:30-38 narrow / branding:80-87 strict).
 * Direction is strict-only: a spec needing a wider entry declares a NAMED,
 * commented exception in its own file — never widening this core silently.
 *
 * DAY-ONE EXCEPTION LIST (A-4 transition clause, run 3): the intersection
 * drops `[antd: compatible]` / `[antd: message]` / `Failed to load resource`
 * / bare `ResizeObserver` — filtered by 22 spec files pre-consolidation.
 * Specs that still emit those console entries carry the exception locally
 * (see e2e/exceptions.ts consumers) until the underlying noise is fixed.
 */
export const CONSOLE_ERROR_CORE = [
  'findDOMNode',
  'chrome-extension',
  'moz-extension',
  'ResizeObserver loop',
] as const;

/**
 * Day-one named exceptions (A-4 transition clause). Each entry names the
 * reason and the specs entitled to it; consumers import and spread.
 */
export const CONSOLE_EXCEPTIONS = {
  /** antd compat warnings — present across most console pages (22 specs). */
  antdCompat: ['[antd: compatible]', '[antd: message]'],
  /** 404s from intentionally-absent mock routes in specific specs. */
  failedResource: ['Failed to load resource'],
  /** bare ResizeObserver (without "loop") — users-crud's wider historical entry. */
  resizeObserverBare: ['ResizeObserver'],
} as const;
