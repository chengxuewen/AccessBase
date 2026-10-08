import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../services/crypto.js';

const KEY = 'ab'.repeat(32); // 32-byte hex key

describe('crypto (AES-256-GCM)', () => {
  it('roundtrips plaintext through encrypt/decrypt', () => {
    const ciphertext = encrypt('hello-totp-secret', KEY);
    expect(ciphertext).not.toContain('hello-totp-secret');
    expect(decrypt(ciphertext, KEY)).toBe('hello-totp-secret');
  });

  it('fails with wrong key', () => {
    const ciphertext = encrypt('hello-totp-secret', KEY);
    const wrongKey = 'cd'.repeat(32);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  it('fails on tampered ciphertext', () => {
    const ciphertext = encrypt('hello-totp-secret', KEY);
    const buf = Buffer.from(ciphertext, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip last byte of the auth tag
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered, KEY)).toThrow();
  });
});

describe('crypto envelope versioning (R-B)', () => {
  // Fixture generated with the PRE-EDIT algorithm (base64(iv|tag|ct), raw hex key),
  // frozen before any implementation change — proves backward compatibility.
  const FIXTURE =
    'Ui0HNFIWovZK5lI7wvB1Zx9+TcoR69uPyXt9FIfIW9UBNmXC8q+SW3POZMyyCiUSo5bKZg==';
  const FIXTURE_PLAINTEXT = 'fixture-totp-secret-JK3M';

  it('decrypts the frozen pre-edit ciphertext as bare legacy input', () => {
    expect(decrypt(FIXTURE, KEY)).toBe(FIXTURE_PLAINTEXT);
  });

  it('decrypts the frozen pre-edit ciphertext with an explicit v1: prefix', () => {
    expect(decrypt(`v1:${FIXTURE}`, KEY)).toBe(FIXTURE_PLAINTEXT);
  });

  it('new encrypt() emits v2-prefixed ciphertext', () => {
    const ct = encrypt('hello', KEY);
    expect(ct.startsWith('v2:')).toBe(true);
  });

  it('v2 roundtrip: decrypt(encrypt(x, key), key) === x', () => {
    const ct = encrypt('roundtrip-v2', KEY);
    expect(decrypt(ct, KEY)).toBe('roundtrip-v2');
  });

  it('v2 decrypt falls back to MFA_ENCRYPTION_KEY_OLD when the current key fails', () => {
    const oldKey = 'cd'.repeat(32);
    const ct = encrypt('written-under-old-key', oldKey);
    expect(() => decrypt(ct, KEY)).toThrow(); // current key alone: auth fail
    process.env['MFA_ENCRYPTION_KEY_OLD'] = oldKey;
    try {
      expect(decrypt(ct, KEY)).toBe('written-under-old-key');
    } finally {
      delete process.env['MFA_ENCRYPTION_KEY_OLD'];
    }
  });

  it('v1 legacy input also benefits from the OLD-key fallback (rotation of pre-existing rows)', () => {
    const oldKey = 'ef'.repeat(32);
    const legacy = encrypt('legacy-row', oldKey); // pre-edit fixture shape == bare v1
    process.env['MFA_ENCRYPTION_KEY_OLD'] = oldKey;
    try {
      expect(decrypt(legacy, '12'.repeat(32))).toBe('legacy-row');
    } finally {
      delete process.env['MFA_ENCRYPTION_KEY_OLD'];
    }
  });

  it('wrong key entirely (no OLD set) throws — no silent garbage', () => {
    const ct = encrypt('secret', KEY);
    expect(() => decrypt(ct, '99'.repeat(32))).toThrow();
  });

  it('unparseable prefix throws', () => {
    expect(() => decrypt('v9:nope', KEY)).toThrow();
  });
});
