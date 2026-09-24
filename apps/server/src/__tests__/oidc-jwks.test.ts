/** Q3C: rotation overlap keys — loadJwks publishes extra PUBLIC jwks. */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadJwks } from '../oidc/provider.js';

const dir = mkdtempSync(path.join(tmpdir(), 'jwks-'));
function keypair(tag: string): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const priv = path.join(dir, `${tag}-priv.pem`);
  const pub = path.join(dir, `${tag}-pub.pem`);
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  return { priv, pub };
}
const primary = keypair('primary');
const extra = keypair('extra');

describe('loadJwks rotation overlap (Q3C)', () => {
  it('primary-only keeps the legacy single private JWK', () => {
    const set = loadJwks({ privateKeyPath: primary.priv, publicKeyPath: primary.pub, nodeEnv: 'test', issuer: '', jwtSecret: '', frontendOrigin: '', oidcIpRatePerMin: 120 } as never);
    expect(set?.keys).toHaveLength(1);
    expect(typeof set?.keys[0]?.d).toBe('string');
  });
  it('extras append PUBLIC-only jwks (no private material) after the signer', () => {
    const set = loadJwks({ privateKeyPath: primary.priv, publicKeyPath: primary.pub, nodeEnv: 'test', extraPublicKeys: `${extra.pub} , ${extra.pub}` } as never);
    expect(set?.keys).toHaveLength(3);
    expect(set?.keys[1]?.d).toBeUndefined();
    expect(set?.keys[1]?.alg).toBe('RS256');
  });
  it('malformed extra fails LOUD with the path (config bug, not silent drop)', () => {
    const bad = path.join(dir, 'bad.pem');
    writeFileSync(bad, 'not a pem');
    expect(() =>
      loadJwks({ privateKeyPath: primary.priv, publicKeyPath: primary.pub, nodeEnv: 'test', extraPublicKeys: bad } as never),
    ).toThrow(bad);
  });
  it('dev mode without primary keys returns undefined regardless of extras', () => {
    expect(loadJwks({ privateKeyPath: '', publicKeyPath: '', nodeEnv: 'test', extraPublicKeys: extra.pub } as never)).toBeUndefined();
  });
});
