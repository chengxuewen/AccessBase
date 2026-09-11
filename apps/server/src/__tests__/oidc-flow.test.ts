/**
 * OIDC protocol flow tests (Task 4c) — HTTP-level through the mounted app.
 *
 * Full AC+PKCE happy path (authorize → login interaction → consent → code →
 * token exchange → RS256 id_token verify), client_credentials, invalid
 * redirect_uri, wrong PKCE verifier, consent deny. Real PG per the
 * mfa-integration.test.ts precedent (live native PG; unique per-run data).
 *
 * Cookie handling: light-my-request has no cookie jar, so every set-cookie
 * from provider responses (session/interaction/resume + .sig pairs) is replayed
 * via a latest-wins jar on subsequent requests — this is what pins the
 * interaction-cookie-survives-prefix-strip requirement (site-wide path '/' in
 * provider.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash, createPublicKey, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-oidc-32bytes!!';
process.env.DATABASE_URL = 'postgresql://accessbase:accessbase@localhost:5432/accessbase';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.OAUTH_REDIRECT_BASE = 'http://localhost:5101';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

// Mock plugins that require fastify@5 but fastify@4 is installed (per mount/mfa tests)
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

// Real RS256 PEM pair on disk — id_token signature verification target.
const keyDir = mkdtempSync(join(tmpdir(), 'oidc-flow-keys-'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPath = join(keyDir, 'jwt.pub.pem');
const privPath = join(keyDir, 'jwt.priv.pem');
writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env.JWT_PUBLIC_KEY_PATH = pubPath;
process.env.JWT_PRIVATE_KEY_PATH = privPath;

const { buildApp } = await import('../app.js');
const { UserManager, OidcClientManager } = await import('@accessbase/identity');

type Awaited<T> = T extends Promise<infer U> ? U : U;
type App = Awaited<ReturnType<typeof buildApp>>;

const TENANT = '00000000-0000-0000-0000-000000000001';
const RUN = Date.now();
const ISSUER = 'http://localhost:5101/oidc';

let app: App;
let userId = '';
let bearer = '';
let acClient = { clientId: '', plaintextSecret: '' };
let ccClient = { clientId: '', plaintextSecret: '' };

const userManager = new (UserManager as unknown as {
  new (): import('@accessbase/identity').UserManager;
})();
const clientManager = new (OidcClientManager as unknown as {
  new (): import('@accessbase/identity').OidcClientManager;
})();

beforeAll(async () => {
  app = await buildApp();
  const user = await userManager.create(
    { email: `oidc-flow-${RUN}@test.local`, name: 'OIDC Flow', password: 'CorrectHorse1!' },
    TENANT,
  );
  userId = user.id;
  const ac = await clientManager.create({
    name: 'Flow RP',
    redirectUris: ['http://client.example/cb'],
    grantTypes: ['authorization_code'],
    scope: 'openid profile email',
    tokenAuthMethod: 'none',
  });
  acClient = { clientId: ac.client.clientId, plaintextSecret: ac.plaintextSecret };
  const cc = await clientManager.create({
    name: 'Flow Machine',
    redirectUris: ['http://machine.example/cb'],
    grantTypes: ['client_credentials'],
    scope: 'openid profile email',
    tokenAuthMethod: 'client_secret_basic',
  });
  ccClient = { clientId: cc.client.clientId, plaintextSecret: cc.plaintextSecret };

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `oidc-flow-${RUN}@test.local`, password: 'CorrectHorse1!' },
  });
  expect(login.statusCode).toBe(200);
  bearer = login.json().data.accessToken;
});

afterAll(async () => {
  if (userId) {
    try {
      await userManager.delete(userId, TENANT);
    } catch {
      // best-effort cleanup
    }
  }
  try {
    await clientManager.remove(acClient.clientId);
    await clientManager.remove(ccClient.clientId);
  } catch {
    // best-effort cleanup
  }
  await app.close();
  rmSync(keyDir, { recursive: true, force: true });
});

// --- helpers ---

/** Latest-wins cookie jar; forwards every stored cookie on each request. */
function makeJar() {
  const jar = new Map<string, string>();
  return {
    absorb(res: { headers: Record<string, unknown> }) {
      const raw = res.headers['set-cookie'];
      if (typeof raw === 'string') {
        const [pair] = raw.split(';');
        const eq = pair?.indexOf('=');
        if (pair !== undefined && eq !== undefined && eq > 0) {
          jar.set(pair.slice(0, eq), pair.slice(eq + 1));
        }
        return;
      }
      if (Array.isArray(raw)) {
        for (const entry of raw as string[]) {
          const [pair] = entry.split(';');
          const eq = pair?.indexOf('=');
          if (pair !== undefined && eq !== undefined && eq > 0) {
            jar.set(pair.slice(0, eq), pair.slice(eq + 1));
          }
        }
      }
    },
    header(): string {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

type Jar = ReturnType<typeof makeJar>;

function pkcePair() {
  const verifier = createHash('sha256').update(String(Math.random())).digest('base64url').repeat(1) +
    'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'; // 43+ chars
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authorizeUrl(clientId: string, redirectUri: string, challenge: string, state: string, nonce: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `/oidc/auth?${q.toString()}`;
}

/** Run authorize → extract uid from the login redirect (B3 topology). */
async function startAuthorize(jar: Jar, clientId: string, challenge: string, state: string, nonce: string, redirectUri = 'http://client.example/cb') {
  const res = await app.inject({
    method: 'GET',
    url: authorizeUrl(clientId, redirectUri, challenge, state, nonce),
    headers: { cookie: jar.header() },
  });
  jar.absorb(res);
  expect([302, 303]).toContain(res.statusCode);
  const location = res.headers['location'] as string;
  expect(location).toContain('http://localhost:5173/login?redirect=');
  const redirect = new URL(location).searchParams.get('redirect') ?? '';
  expect(redirect.startsWith('/oidc/auth/')).toBe(true);
  return { res, uid: redirect.split('/').pop() ?? '', location };
}

async function approve(jar: Jar, uid: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/oidc/interaction/${uid}`,
    headers: { cookie: jar.header(), authorization: `Bearer ${bearer}` },
    payload: { decision: 'approve' },
  });
  jar.absorb(res);
  return res;
}

async function deny(jar: Jar, uid: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/oidc/interaction/${uid}`,
    headers: { cookie: jar.header(), authorization: `Bearer ${bearer}` },
    payload: { decision: 'deny' },
  });
  jar.absorb(res);
  return res;
}

/** GET a provider redirect target (resume / consent), absorbing cookies. */
async function follow(jar: Jar, url: string) {
  const res = await app.inject({ method: 'GET', url, headers: { cookie: jar.header() } });
  jar.absorb(res);
  return res;
}

// --- tests ---

describe('OIDC full protocol flows', () => {
  it('AC+PKCE happy path: authorize → login → consent → code → token with verifiable RS256 id_token', async () => {
    const jar = makeJar();
    const { verifier, challenge } = pkcePair();
    const state = 'st-' + RUN;
    const nonce = 'no-' + RUN;

    const { uid, location } = await startAuthorize(jar, acClient.clientId, challenge, state, nonce);
    expect(location).toBe(
      `http://localhost:5173/login?redirect=${encodeURIComponent(`/oidc/auth/${uid}`)}`,
    );

    // GET interaction contract (login prompt) — exact M3 shape
    const details = await app.inject({
      method: 'GET',
      url: `/oidc/interaction/${uid}`,
      headers: { cookie: jar.header(), authorization: `Bearer ${bearer}` },
    });
    expect(details.statusCode).toBe(200);
    expect(details.json()).toEqual({
      success: true,
      data: {
        clientName: 'Flow RP',
        requestedScopes: ['openid', 'profile', 'email'],
        promptName: 'login',
        uid,
      },
    });

    // POST approve → login finished → 303 back to the resume route
    const loginRes = await approve(jar, uid);
    expect(loginRes.statusCode).toBe(303);
    const resumeUrl1 = loginRes.headers['location'] as string;
    expect(resumeUrl1).toContain('/oidc/auth/');

    // Resume → consent prompt redirect
    const consentRedirect = await follow(jar, resumeUrl1);
    expect(consentRedirect.statusCode).toBe(303);
    const consentUrl = consentRedirect.headers['location'] as string;
    // DIAG: inspect what the resumed authorization still demands
    const diagUid = new URL(consentUrl, 'http://x').searchParams.get('uid') ?? new URL(consentUrl, 'http://x').pathname.split('/').pop() ?? '';
    const diag = await app.inject({ method: 'GET', url: `/oidc/interaction/${diagUid}`, headers: { cookie: jar.header(), authorization: `Bearer ${bearer}` } });
    console.error('[DIAG-CONSENT]', diag.statusCode, diag.body.slice(0, 300));
    expect(consentUrl.startsWith('/consent?uid=')).toBe(true);
    const consentUid = new URL(consentUrl, ISSUER).searchParams.get('uid') ?? '';

    // Consent details — promptName flips to consent
    const consentDetails = await app.inject({
      method: 'GET',
      url: `/oidc/interaction/${consentUid}`,
      headers: { cookie: jar.header(), authorization: `Bearer ${bearer}` },
    });
    expect(consentDetails.statusCode).toBe(200);
    expect(consentDetails.json().data).toMatchObject({ promptName: 'consent', clientName: 'Flow RP' });

    // Approve consent → 303 resume → 302 redirect_uri with code
    const consentRes = await approve(jar, consentUid);
    expect(consentRes.statusCode).toBe(303);
    const resumeUrl2 = consentRes.headers['location'] as string;
    const codeRedirect = await follow(jar, resumeUrl2);
        if (codeRedirect.statusCode !== 303) {
      const fs = await import('node:fs');
      fs.writeFileSync('/tmp/opencode/resume2-err.html', codeRedirect.body);
      console.error('[DBG-RESUME2]', codeRedirect.statusCode);
    }
    expect(codeRedirect.statusCode).toBe(303);
    const callback = new URL(codeRedirect.headers['location'] as string, 'http://client.example');
    expect(callback.origin + callback.pathname).toBe('http://client.example/cb');
    const code = callback.searchParams.get('code');
    expect(callback.searchParams.get('state')).toBe(state);
    expect(code).toBeTruthy();

    // Token exchange with the verifier
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        redirect_uri: 'http://client.example/cb',
        client_id: acClient.clientId,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenRes.statusCode).toBe(200);
    const tokens = tokenRes.json();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.token_type).toBe('Bearer');

    // id_token: RS256 signature verifies against the public key + claim checks
    const [h, p, s] = tokens.id_token.split('.') as [string, string, string];
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header.alg).toBe('RS256');
    expect(
      cryptoVerify(
        'RSA-SHA256',
        Buffer.from(`${h}.${p}`),
        createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })),
        Buffer.from(s, 'base64url'),
      ),
    ).toBe(true);
    expect(claims.iss).toBe(ISSUER);
    expect(claims.sub).toBe(userId);
    expect(claims.aud).toBe(acClient.clientId);
    expect(claims.nonce).toBe(nonce);
  });

  it('client_credentials machine client exchanges Basic auth for an access token', async () => {
    const basic = Buffer.from(`${ccClient.clientId}:${ccClient.plaintextSecret}`).toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      payload: 'grant_type=client_credentials',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe('Bearer');
    expect(body.id_token).toBeUndefined();
  });

  it('invalid redirect_uri is rejected with a 400 provider error', async () => {
    const { challenge } = pkcePair();
    const res = await app.inject({
      method: 'GET',
      url: authorizeUrl(acClient.clientId, challenge, 'st-bad', 'no-bad', 'http://evil.example/cb'),
    });
    expect(res.statusCode).toBe(400);
    // provider renders the default HTML error page: without a valid
    // redirect_uri it cannot return the error to the client (spec-correct).
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('wrong PKCE verifier fails the token exchange with invalid_grant', async () => {
    const jar = makeJar();
    const { challenge } = pkcePair();
    const { uid } = await startAuthorize(jar, acClient.clientId, challenge, 'st-wv', 'no-wv');
    const loginRes = await approve(jar, uid);
    const consentRedirect = await follow(jar, loginRes.headers['location'] as string);
    const consentUid =
      new URL(consentRedirect.headers['location'] as string, ISSUER).searchParams.get('uid') ?? '';
    const consentRes = await approve(jar, consentUid);
    const codeRedirect = await follow(jar, consentRes.headers['location'] as string);
    const code = new URL(codeRedirect.headers['location'] as string).searchParams.get('code') ?? '';

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://client.example/cb',
        client_id: acClient.clientId,
        code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier-wrong',
      }).toString(),
    });
    expect(tokenRes.statusCode).toBe(400);
    expect(tokenRes.json().error).toBe('invalid_grant');
  });

  it('consent deny resumes to the client with error=access_denied', async () => {
    const jar = makeJar();
    const { challenge } = pkcePair();
    const { uid } = await startAuthorize(jar, acClient.clientId, challenge, 'st-deny', 'no-deny');
    const loginRes = await approve(jar, uid);
    const consentRedirect = await follow(jar, loginRes.headers['location'] as string);
    const consentUid =
      new URL(consentRedirect.headers['location'] as string, ISSUER).searchParams.get('uid') ?? '';

    const denyRes = await deny(jar, consentUid);
    expect(denyRes.statusCode).toBe(303);
    const codeRedirect = await follow(jar, denyRes.headers['location'] as string);
        expect(codeRedirect.statusCode).toBe(303);
    const callback = new URL(codeRedirect.headers['location'] as string, 'http://client.example');
    expect(callback.origin + callback.pathname).toBe('http://client.example/cb');
    expect(callback.searchParams.get('error')).toBe('access_denied');
  });
});

// keep fastify type import used (App type above)
void (null as unknown as FastifyInstance | null);
