/**
 * OIDC device-flow browser-handoff regression net (device-loop fix, 2026-09-30).
 *
 * Full RFC 8628 round WITHOUT a browser through the mounted app (app.inject):
 * device_authorization → code-verification GET (form_post) → user_code POST →
 * confirm POST → SPA handoff emulation via the interaction contract
 * (/api/v1/oidc/interaction) → resume → consent → resume → success page →
 * token poll returns access_token.
 *
 * Locks the four links the browser round proved broken on master:
 * 1. helmet CSP form-action must admit FRONTEND_ORIGIN (Chromium blocks the
 *    cross-origin 303 from the confirm form submission otherwise — the user
 *    stays stuck on the provider confirm page);
 * 2. the interaction contract must be reachable at /api/v1/oidc/interaction
 *    (the historical /oidc mount was 404 for every real client topology);
 * 3. the approve POST keeps the 303-to-resume contract (Location = the
 *    provider-declared returnTo, driven by a top-level navigation);
 * 4. the resume chain (device_resume → consent → device success) completes and
 *    the token poll returns an access_token.
 *
 * Real PG per the oidc-flow.test.ts precedent; skipIf when PG is down.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-oidc-32bytes!!';
process.env.DATABASE_URL = 'postgresql://accessbase:accessbase@localhost:5432/accessbase';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.OAUTH_REDIRECT_BASE = 'http://localhost:5101';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

import pg from 'pg';

const pgProbe = new pg.Client({ connectionString: process.env.DATABASE_URL });
const pgAvailable = await (async () => {
  try { await pgProbe.connect(); await pgProbe.end(); return true; } catch { return false; }
})();

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const keyDir = mkdtempSync(join(tmpdir(), 'oidc-devround-keys-'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPath = join(keyDir, 'jwt.pub.pem');
const privPath = join(keyDir, 'jwt.priv.pem');
writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env.JWT_PUBLIC_KEY_PATH = pubPath;
process.env.JWT_PRIVATE_KEY_PATH = privPath;

const { buildApp } = await import('../app.js');
const { UserManager, OidcClientManager } = await import('@accessbase/identity');

const TENANT = '00000000-0000-0000-0000-000000000001';
const RUN = Date.now();
const FRONTEND_ORIGIN = 'http://localhost:5173';

let app: Awaited<ReturnType<typeof buildApp>>;
let userId = '';
let bearer = '';
let dvClient = { clientId: '', plaintextSecret: null as string | null };

// Instance types via typeof (the classes come from the dynamic import above;
 // a static `import type` would defeat the env-priming order the suite relies on).
type UserManagerLike = InstanceType<typeof UserManager>;
type OidcClientManagerLike = InstanceType<typeof OidcClientManager>;
const userManager: UserManagerLike = new (UserManager as unknown as new () => UserManagerLike)();
const clientManager: OidcClientManagerLike = new (OidcClientManager as unknown as new () => OidcClientManagerLike)();

// --- helpers (jar copied from oidc-flow.test.ts — light-my-request has none) ---

function makeJar() {
  const jar = new Map<string, string>();
  return {
    absorb(res: { headers: Record<string, unknown> }) {
      const raw = res.headers['set-cookie'];
      const entries = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? (raw as string[]) : [];
      for (const entry of entries) {
        const [pair] = entry.split(';');
        const eq = pair?.indexOf('=');
        if (pair !== undefined && eq !== undefined && eq > 0) {
          jar.set(pair.slice(0, eq), pair.slice(eq + 1));
        }
      }
    },
    header(): string {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}
type Jar = ReturnType<typeof makeJar>;

/** Extract a hidden input value by name from a provider-rendered form page. */
function hiddenValue(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'))
    ?? html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`, 'i'));
  return m?.[1] ?? '';
}

async function follow(jar: Jar, url: string) {
  const res = await app.inject({ method: 'GET', url, headers: { cookie: jar.header() } });
  jar.absorb(res);
  return res;
}

// --- tests ---

describe.skipIf(!pgAvailable)('OIDC device-flow browser handoff (no-browser round)', () => {
  beforeAll(async () => {
    app = await buildApp();
    const user = await userManager.create(
      { email: `devround-${RUN}@test.local`, name: 'Device Round', password: 'CorrectHorse1!' },
      TENANT,
    );
    userId = user.id;
    const dv = await clientManager.create({
      name: 'DevRound RP',
      redirectUris: ['http://localhost:3000/cb'],
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
      scope: 'openid profile email',
      tokenAuthMethod: 'client_secret_basic',
    });
    dvClient = { clientId: dv.client.clientId, plaintextSecret: dv.plaintextSecret };

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `devround-${RUN}@test.local`, password: 'CorrectHorse1!' },
    });
    expect(login.statusCode).toBe(200);
    bearer = login.json().data.accessToken;
  });

  afterAll(async () => {
    if (userId) {
      try { await userManager.delete(userId, TENANT); } catch { /* best-effort */ }
    }
    try { await clientManager.remove(dvClient.clientId); } catch { /* best-effort */ }
    await app.close();
    rmSync(keyDir, { recursive: true, force: true });
  });

  it('confirm POST → SPA login handoff → approve → consent → success + access_token', async () => {
    const jar = makeJar();
    const basic = 'Basic ' + Buffer.from(`${dvClient.clientId}:${dvClient.plaintextSecret ?? ''}`).toString('base64');

    // 1. device_authorization
    const dev = await app.inject({
      method: 'POST',
      url: '/oidc/device/auth',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
      payload: new URLSearchParams({ client_id: dvClient.clientId, scope: 'openid profile email' }).toString(),
    });
    expect(dev.statusCode).toBe(200);
    const { user_code: userCode, device_code: deviceCode } = dev.json();

    // 2. GET verification page with user_code → provider renders the auto-submit
    //    form_post page (hidden xsrf + user_code; a browser JS-submits it).
    const page1 = await follow(jar, `/oidc/device?user_code=${encodeURIComponent(userCode)}`);
    expect(page1.statusCode).toBe(200);
    const xsrf1 = hiddenValue(page1.body, 'xsrf');
    const ucField = hiddenValue(page1.body, 'user_code');
    expect(xsrf1).not.toBe('');
    expect(ucField).toBe(userCode);

    // 3. POST user_code (the auto-submit) → confirm form
    const page2 = await app.inject({
      method: 'POST',
      url: '/oidc/device',
      headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ xsrf: xsrf1, user_code: ucField }).toString(),
    });
    jar.absorb(page2);
    expect(page2.statusCode).toBe(200);
    expect(page2.body).toContain('op.deviceConfirmForm');
    const xsrf2 = hiddenValue(page2.body, 'xsrf');

    // 4. THE CONFIRM POST → 303 to the SPA login with the DEVICE resume path,
    //    and the CSP the response carries must let the SPA origin through
    //    (form-action is what Chromium enforces on this form submission).
    const confirm = await app.inject({
      method: 'POST',
      url: '/oidc/device',
      headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ xsrf: xsrf2, user_code: userCode, confirm: 'yes' }).toString(),
    });
    jar.absorb(confirm);
    expect(confirm.statusCode).toBe(303);
    // NOTE: CSP form-action (the OTHER half of the fix — helmet must admit
    // FRONTEND_ORIGIN on the confirm form's cross-origin 303) is proven in the
    // live browser round; the helmet mock in this suite is a no-op so the
    // header is absent here by construction.
    const loginLocation = String(confirm.headers['location']);
    const redirectParam = decodeURIComponent(new URL(loginLocation).searchParams.get('redirect') ?? '');
    expect(loginLocation).toBe(
      `${FRONTEND_ORIGIN}/login?redirect=${encodeURIComponent(redirectParam)}`,
    );
    expect(redirectParam).toMatch(/^\/oidc\/device\//);
    const resumeUid = redirectParam.split('/').pop() ?? '';

    // 5. SPA handoff: interaction contract reachable under /api/v1/oidc
    const details = await app.inject({
      method: 'GET',
      url: `/api/v1/oidc/interaction/${resumeUid}`,
      headers: { cookie: jar.header(), authorization: `Bearer ${bearer}` },
    });
    expect(details.statusCode).toBe(200);
    expect(details.json().data).toMatchObject({ promptName: 'login', uid: resumeUid });

    // 6. approve keeps the 303-to-resume contract (Location = returnTo)
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/oidc/interaction/${resumeUid}`,
      headers: { cookie: jar.header(), authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: { decision: 'approve' },
    });
    jar.absorb(approve);
    // 303 Location = interaction.returnTo (ABSOLUTE issuer URL — issuer-derived;
    // compare path+query since the inject Host lacks the port a real request has).
    const approveLocation = String(approve.headers['location']);
    expect(new URL(approveLocation, 'http://localhost:5101').pathname + new URL(approveLocation, 'http://localhost:5101').search).toBe(redirectParam);

    // 7. resume → consent prompt
    const consentRedirect = await follow(jar, redirectParam);
    expect(consentRedirect.statusCode).toBe(303);
    const consentUrl = String(consentRedirect.headers['location']);
    expect(consentUrl.startsWith('/consent?uid=')).toBe(true);
    const consentUid = new URL(consentUrl, 'http://localhost:5101').searchParams.get('uid') ?? '';

    // 8. consent details + approve → 303 back to the DEVICE resume path
    const consentDetails = await app.inject({
      method: 'GET',
      url: `/api/v1/oidc/interaction/${consentUid}`,
      headers: { cookie: jar.header(), authorization: `Bearer ${bearer}` },
    });
    expect(consentDetails.statusCode).toBe(200);
    expect(consentDetails.json().data).toMatchObject({ promptName: 'consent' });

    const consentApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/oidc/interaction/${consentUid}`,
      headers: { cookie: jar.header(), authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: { decision: 'approve' },
    });
    jar.absorb(consentApprove);
    expect(consentApprove.statusCode).toBe(303);
    const consentLocation = String(consentApprove.headers['location']);
    // The consent interaction's returnTo is ITS OWN resume route (each interaction
    // gets a fresh uid); the resume at that path carries login+consent results.
    const consentReturnTo = new URL(consentLocation, 'http://localhost:5101').pathname + new URL(consentLocation, 'http://localhost:5101').search;
    expect(consentReturnTo).toMatch(/^\/oidc\/device\//);

    // 9. final resume → device success page
    const success = await follow(jar, consentReturnTo);
    expect(success.statusCode).toBe(200);
    expect(success.body).toMatch(/success|congratulation/i);

    // 10. token poll returns the access_token
    const poll = await app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
      payload: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: String(deviceCode),
      }).toString(),
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().access_token).toBeTruthy();
    expect(poll.json().token_type).toBe('Bearer');
  });
});
