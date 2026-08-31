/**
 * AES-256-GCM encryption for TOTP secrets at rest. Phase 6b Task 3.
 *
 * Format: base64(iv[12] | tag[16] | ciphertext). Key is 32-byte hex from
 * MFA_ENCRYPTION_KEY. GCM auth tag makes wrong-key/tamper fail on decrypt.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

function keyBytes(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('MFA encryption key must be 32 bytes (64 hex chars)');
  }
  return key;
}

export function encrypt(plaintext: string, keyHex: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decrypt(ciphertextB64: string, keyHex: string): string {
  const data = Buffer.from(ciphertextB64, 'base64');
  if (data.length < IV_LEN + TAG_LEN) {
    throw new Error('Invalid ciphertext');
  }
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
