/**
 * Logout-coherence T-PKJ integration proof — provider-side private_key_jwt
 * client auth over the mounted app with real PG (oidc-flow.test.ts precedent:
 * app.inject + PG-probe skip + NODE_ENV test).
 *
 * Positive lane is the ONLY net that proves the whole chain (manager jwks
 * persistence -> adapter client() jwks mapping -> provider assertion verify):
 * every mock seam hides exactly one link of it (PIT-072/B-T2 family).
 *
 * CLIENT_009 route rejection is covered in the mock harness lane
 * (clients-routes.test.ts); re-proving it here needs clients:write role
 * wiring against the dev DB — not cheap, deliberately skipped.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  createSign,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-oidc-32bytes!!';
process.env.DATABASE_URL = 'postgresql://accessbase:accessbase@localhost:5432/accessbase';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MFA_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.OAUTH_REDIRECT_BASE = 'http://localhost:5101';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

import pg from 'pg';
import type { OidcClientManager as OidcClientManagerT } from '@accessbase/identity';

// PG-reachable probe — skip entire suite when native PG is down (oidc-flow precedent).
const pgProbe = new pg.Client({ connectionString: process.env.DATABASE_URL });
const pgAvailable = await (async () => {
  try {
    await pgProbe.connect();
    await pgProbe.end();
    return true;
  } catch {
    return false;
  }
})();

// Mock plugins that require fastify@5 but fastify@4 is installed (per mount/mfa tests)
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const { buildApp } = await import('../app.js');
const { OidcClientManager } = await import('@accessbase/identity');

type Awaited<T> = T extends Promise<infer U> ? U : U;
type App = Awaited<ReturnType<typeof buildApp>>;

const ISSUER = 'http://localhost:5101/oidc';
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const RUN = Date.now();

let app: App;
let clientId = '';
const clientManager = new (OidcClientManager as unknown as {
  new (): OidcClientManagerT;
})();

/** Public JWK of a KeyObject — a PUBLIC export carries no private members by construction. */
function publicJwk(key: KeyObject): Record<string, unknown> {
  return key.export({ format: 'jwk' }) as Record<string, unknown>;
}

/** RS256 client_assertion: iss=sub=client_id, aud=issuer, exp near-future, fresh jti. */
function signAssertion(
  privateKey: KeyObject,
  opts: { clientId: string; tamper?: boolean } = { clientId: '' },
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: opts.clientId || clientId,
    sub: opts.clientId || clientId,
    aud: ISSUER,
    jti: randomUUID(),
    iat: now,
    exp: now + 60,
  };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(
    JSON.stringify(payload),
  ).toString('base64url')}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  const sig = signer.sign(privateKey);
  if (opts.tamper) sig[0] ^= 0xff; // flip one bit of the signature
  return `${input}.${sig.toString('base64url')}`;
}

function postToken(clientAssertion: string) {
  return app.inject({
    method: 'POST',
    url: '/oidc/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_assertion_type: ASSERTION_TYPE,
      client_assertion: clientAssertion,
    }).toString(),
  });
}

describe.skipIf(!pgAvailable)('OIDC private_key_jwt client auth (real provider roundtrip)', () => {
  // Client keypair registered in the client's jwks + an attacker keypair that
  // is NOT part of the registered set.
  const clientKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  beforeAll(async () => {
    app = await buildApp();
    const created = await clientManager.create({
      name: `PKJ Integration ${RUN}`,
      redirectUris: ['https://pkj.example/cb'],
      grantTypes: ['client_credentials'],
      scope: 'openid',
      tokenAuthMethod: 'private_key_jwt',
      jwks: { keys: [publicJwk(clientKeys.publicKey)] },
    });
    clientId = created.client.clientId;
  });

  afterAll(async () => {
    if (clientId) {
      try {
        await clientManager.remove(clientId);
      } catch {
        // best-effort cleanup
      }
    }
    await app.close();
  });

  it('persists jwks through the manager (row read-back carries the key)', async () => {
    const row = await clientManager.get(clientId);
    expect(row?.jwks).toEqual({ keys: [publicJwk(clientKeys.publicKey)] });
  });

  it('token exchange authenticates with a valid assertion and NO client_secret', async () => {
    const res = await postToken(signAssertion(clientKeys.privateKey));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe('Bearer');
  });

  it('tampered assertion signature -> 401 invalid_client', async () => {
    const res = await postToken(signAssertion(clientKeys.privateKey, { tamper: true }));
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_client');
  });

  it('assertion signed by an unregistered key -> 401 invalid_client', async () => {
    const res = await postToken(signAssertion(attackerKeys.privateKey));
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_client');
  });
});
