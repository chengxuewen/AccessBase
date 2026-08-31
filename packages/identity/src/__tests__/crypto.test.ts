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
