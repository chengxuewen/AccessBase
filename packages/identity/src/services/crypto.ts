/**
 * AES-256-GCM envelope encryption (TOTP secrets at rest).
 *
 * Envelope versions:
 *   v1 (legacy): base64(iv[12] | tag[16] | ciphertext), raw 32-byte hex key.
 *                Bare input (no prefix) and explicit `v1:` both take this path.
 *   v2 (R-B):    v2:<salt16-hex>:<iv12-hex>:<tag16-hex>:<ct-hex>, key =
 *                HKDF-SHA256(ikm=key, salt=record salt, info=ENVELOPE_V2_INFO).
 *                The HKDF salt/info separation guarantees v1 and v2 keys never
 *                collide even for the same key material.
 *
 * Rotation: writes always use the current key (v2). Reads try the current key
 * first, then MFA_ENCRYPTION_KEY_OLD (optional, set only during rotation
 * windows) — old ciphertexts keep decrypting, rotation stops destroying data.
 * GCM auth tags make wrong-key/tamper fail loudly (no silent garbage).
 */
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;
const SALT_LEN = 16;
const KEY_BYTES = 32;
const ENVELOPE_V2_INFO = 'accessbase:envelope:v2';

function keyBytes(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error('MFA encryption key must be 32 bytes (64 hex chars)');
  }
  return key;
}

/** v2 key derivation: HKDF separates v2 keys from v1's raw-key use. */
function v2KeyBytes(keyHex: string, salt: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', keyBytes(keyHex), salt, ENVELOPE_V2_INFO, KEY_BYTES),
  );
}

/** Current (argument) key first, then the optional rotation-window OLD key. */
function candidateKeys(keyHex: string): string[] {
  const old = process.env['MFA_ENCRYPTION_KEY_OLD'];
  return old && old !== keyHex ? [keyHex, old] : [keyHex];
}

export function encrypt(plaintext: string, keyHex: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', v2KeyBytes(keyHex, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v2',
    salt.toString('hex'),
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

/** v1/legacy decrypt: base64(iv|tag|ct), raw key. Tries each key in turn. */
function decryptV1(ciphertextB64: string, keys: string[]): string {
  const data = Buffer.from(ciphertextB64, 'base64');
  if (data.length < IV_LEN + TAG_LEN) {
    throw new Error('Invalid ciphertext');
  }
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + TAG_LEN);
  let lastErr: unknown = new Error('Invalid ciphertext');
  for (const keyHex of keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', keyBytes(keyHex), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Decryption failed');
}

/** v2 decrypt: hex segments, HKDF-derived key. Tries each key in turn. */
function decryptV2(
  keyHexes: string[],
  saltHex: string,
  ivHex: string,
  tagHex: string,
  ctHex: string,
): string {
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex, 'hex');
  let lastErr: unknown = new Error('Invalid ciphertext');
  for (const keyHex of keyHexes) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', v2KeyBytes(keyHex, salt), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Decryption failed');
}

export function decrypt(ciphertext: string, keyHex: string): string {
  const keys = candidateKeys(keyHex);

  if (ciphertext.startsWith('v2:')) {
    const parts = ciphertext.split(':');
    if (parts.length !== 5) throw new Error('Invalid ciphertext');
    const [, saltHex, ivHex, tagHex, ctHex] = parts;
    if (!saltHex || !ivHex || !tagHex || !ctHex) throw new Error('Invalid ciphertext');
    return decryptV2(keys, saltHex, ivHex, tagHex, ctHex);
  }

  // Legacy: bare input or explicit v1: prefix — same bytes, raw key.
  const body = ciphertext.startsWith('v1:') ? ciphertext.slice(3) : ciphertext;
  return decryptV1(body, keys);
}

