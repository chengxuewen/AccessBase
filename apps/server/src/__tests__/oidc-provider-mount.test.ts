/**
 * OIDC provider mount tests (Task 4b) — RED first.
 *
 * Covers the B1/B2 ratified mounting contract:
 * - provider constructs via buildOidcProvider
 * - GET /oidc/.well-known/openid-configuration serves through the mounted app
 * - B1 regression lock: POST urlencoded to /oidc/token reaches the provider
 *   (not Fastify 415) — proves the onRequest-before-body-parsing hijack mount
 * - static assertion: /oidc must have NO content-type parsers registered
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-jwt-secret-for-oidc-32bytes!!';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';

// Real RS256 PEM pair on disk — provider build reads key files like production.
const keyDir = mkdtempSync(join(tmpdir(), 'oidc-keys-'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubPath = join(keyDir, 'jwt.pub.pem');
const privPath = join(keyDir, 'jwt.priv.pem');
writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env['JWT_PUBLIC_KEY_PATH'] = pubPath;
process.env['JWT_PRIVATE_KEY_PATH'] = privPath;

import { buildApp } from '../app.js';
import { buildOidcProvider } from '../oidc/provider.js';

let savedEnv: Record<string, string | undefined>;

beforeAll(() => {
  savedEnv = {
    NODE_ENV: process.env['NODE_ENV'],
    JWT_PRIVATE_KEY_PATH: process.env['JWT_PRIVATE_KEY_PATH'],
    JWT_PUBLIC_KEY_PATH: process.env['JWT_PUBLIC_KEY_PATH'],
  };
});

afterAll(() => {
  rmSync(keyDir, { recursive: true, force: true });
});

describe('buildOidcProvider', () => {
  it('constructs a provider with the adapter class and pkce required', async () => {
    const { provider, oidcHandler } = await buildOidcProvider({
      issuer: 'http://localhost:5101/oidc',
      jwtSecret: 'test-jwt-secret-for-oidc-32bytes!!',
      nodeEnv: 'test',
      privateKeyPath: privPath,
      publicKeyPath: pubPath,
      adapterCtorArgs: ['postgresql://ignored'],
    });
    expect(provider).toBeTruthy();
    expect(provider.issuer).toBe('http://localhost:5101/oidc');
    expect(typeof oidcHandler).toBe('function');
  });

  it('fail-fast throws in production when key files are absent', async () => {
    await expect(
      buildOidcProvider({
        issuer: 'http://localhost:5101/oidc',
        jwtSecret: 's',
        nodeEnv: 'production',
        privateKeyPath: '',
        publicKeyPath: '',
        adapterCtorArgs: ['postgresql://ignored'],
      }),
    ).rejects.toThrow(/RS256 key|JWT_PRIVATE_KEY_PATH|JWT_PUBLIC_KEY_PATH|keystore/i);
  });
});

describe('oidc mount via onRequest hijack', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /oidc/.well-known/openid-configuration serves 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/oidc/.well-known/openid-configuration' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.issuer).toBe('http://localhost:5101/oidc');
    // app.inject host is 'localhost' (no port) — assert prefix + path shape
    expect(body.authorization_endpoint).toBe('http://localhost/oidc/auth');
  });


  it('B1 regression lock: POST urlencoded to /oidc/token reaches provider (not 415)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/oidc/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=client_credentials&client_id=none&client_secret=none',
    });
    // The provider answers (401 invalid_client) — NOT Fastify's 415/400 body-parse errors.
    expect(res.statusCode).not.toBe(415);
    expect([400, 401, 403]).toContain(res.statusCode);
    // Provider error envelope, not Fastify's plain-text FST_ERR_CTP_* error
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.stringify(res.json())).toMatch(/invalid_client|error/i);
  });
});

describe('static assertions (route-guard precedent)', () => {
  it('/oidc has no content-type parsers registered in app.ts', () => {
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect(src).not.toMatch(/addContentTypeParser/);
    expect(src).toMatch(/addHook\('onRequest'/);
    expect(src).toMatch(/reply\.hijack\(\)/);
    expect(src).toMatch(/provider\.callback\(\)/);
  });
});
