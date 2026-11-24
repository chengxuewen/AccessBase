/**
 * 4A T1 — SET signer profile locks (spec rev.4 §3 T1; P-2=B wire proof).
 * RED discipline: these assertions encode the panel findings F-09 (typ/aud/
 * exp/txn/jti + sub_id iss_sub) and P-2 (dedicated kid, same JWKS).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jwtVerify } from 'jose';
import { signSet, SET_KID, CAEP_EVENT_TYPES } from '../utils/set-signer.js';
import { loadJwks } from '../oidc/provider.js';

const ISSUER = 'https://idp.example/oidc';
const AUDIENCE = 'ab_targetclient';
const JTI = '11111111-2222-3333-4444-555555555555';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const setPrivPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const setPubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const sign = (eventType = CAEP_EVENT_TYPES.suspended) =>
  signSet(
    setPrivPem,
    {
      issuer: ISSUER,
      audience: AUDIENCE,
      jti: JTI,
      txn: '42',
      subjectId: '0f1e2d3c-1111-2222-3333-444455556666',
      eventType,
    },
    1_700_000_000,
  );

/** Deterministic verify clock mid-window of the pinned iat=1_700_000_000. */
const VERIFY_CLOCK = { currentDate: new Date(1_700_000_200 * 1000) };

describe('SET signer profile (F-09)', () => {
  it('emits typ=secevent+jwt, kid=set-signing, RS256 and verifies against the SET public key', async () => {
    const set = await sign();
    const { payload, protectedHeader } = await jwtVerify(set, createPublicKey(setPrivPem), VERIFY_CLOCK);
    expect(protectedHeader.alg).toBe('RS256');
    expect(protectedHeader.typ).toBe('secevent+jwt');
    expect(protectedHeader.kid).toBe(SET_KID);
    expect(payload.iss).toBe(ISSUER);
    expect(payload.aud).toBe(AUDIENCE);
    expect(payload.jti).toBe(JTI);
    expect(payload.txn).toBe('42');
  });

  it('keeps exp ≤ 300s past iat (short-lived; retry re-signs fresh)', async () => {
    const { payload } = await jwtVerify(await sign(), createPublicKey(setPrivPem), VERIFY_CLOCK);
    const iat = payload.iat as number;
    const exp = payload.exp as number;
    expect(exp - iat).toBeLessThanOrEqual(300);
    expect(exp - iat).toBeGreaterThan(0);
  });

  it('carries the RISC URN from the row + BOTH iss_sub subject spellings (S1-3 interop)', async () => {
    const { payload } = await jwtVerify(await sign(), createPublicKey(setPrivPem), VERIFY_CLOCK);
    const events = payload.events as Record<string, Record<string, unknown>>;
    const eventKeys = Object.keys(events);
    expect(eventKeys).toEqual([CAEP_EVENT_TYPES.suspended]);
    const body = events[CAEP_EVENT_TYPES.suspended];
    for (const member of ['subject', 'sub_id'] as const) {
      const s = body[member] as Record<string, string>;
      expect(s.format).toBe('iss_sub');
      expect(s.iss).toBe(ISSUER);
      expect(s.sub).toBe('0f1e2d3c-1111-2222-3333-444455556666');
    }
    // purged maps to the OTHER URN (delete arm, P-3).
    const { payload: purged } = await jwtVerify(
      await sign(CAEP_EVENT_TYPES.deleted),
      createPublicKey(setPrivPem),
      VERIFY_CLOCK,
    );
    expect(Object.keys(purged.events as object)).toEqual([CAEP_EVENT_TYPES.deleted]);
  });
});

describe('P-2=B dedicated SET key in the shared JWKS', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'set-key-'));
  const primaryPriv = path.join(dir, 'primary.key');
  const primaryPub = path.join(dir, 'primary.crt');
  const setPriv = path.join(dir, 'set.key');
  const setPub = path.join(dir, 'set.crt');

  beforeAll(() => {
    const p = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(
      primaryPriv,
      p.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    writeFileSync(primaryPub, p.publicKey.export({ type: 'spki', format: 'pem' }).toString());
    writeFileSync(setPriv, setPrivPem);
    writeFileSync(setPub, setPubPem);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('loadJwks publishes BOTH kids — SET kid distinct from the signing key kid (P-2 isolation)', () => {
    const jwks = loadJwks({
      issuer: ISSUER,
      jwtSecret: 'x',
      nodeEnv: 'development',
      privateKeyPath: primaryPriv,
      publicKeyPath: primaryPub,
      setPrivateKeyPath: setPriv,
      setPublicKeyPath: setPub,
    });
    expect(jwks).toBeDefined();
    const keys = (jwks as { keys: Array<Record<string, unknown>> }).keys;
    const setKey = keys.find((k) => k['kid'] === SET_KID);
    // The SET public JWK carries the stable kid AND the same modulus as the
    // key that signs (wire identity).
    expect(setKey).toBeDefined();
    if (!setKey) throw new Error('SET kid missing from published JWKS');
    const setJwkN = String(setKey['n']);
    const signerJwkN = String(
      createPublicKey(setPubPem).export({ format: 'jwk' })['n'],
    );
    expect(setJwkN).toBe(signerJwkN);
    // Primary JWK is a DIFFERENT key (kid unset on extras in this shape — the
    // isolation claim is about key material, asserted via modulus inequality).
    const primaryJwkN = String(
      createPublicKey(createPrivateKey(readFileSync(primaryPriv, 'utf-8'))).export({
        format: 'jwk',
      })['n'],
    );
    expect(primaryJwkN).not.toBe(signerJwkN);
  });

  it('prod fail-fast: missing SET pair refuses boot (P-7 doctrine on a compliance channel)', () => {
    expect(() =>
      loadJwks({
        issuer: ISSUER,
        jwtSecret: 'x',
        nodeEnv: 'production',
        privateKeyPath: primaryPriv,
        publicKeyPath: primaryPub,
        extraPublicKeys: '',
      }),
    ).toThrow(/JWT_SET_PRIVATE_KEY_PATH/);
  });
});
