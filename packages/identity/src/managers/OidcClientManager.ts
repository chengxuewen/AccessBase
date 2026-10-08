 /**
 * OidcClientManager — OIDC client CRUD with encrypted secrets.
 *
 * Client secrets are stored AES-256-GCM encrypted with a key derived via
 * scrypt(JWT_SECRET, per-record salt). Blob format (R-B versioned):
 *   v1:${base64(salt)}:${base64(iv)}:${base64(tag)}:${base64(ct)}  (legacy,
 *       raw scrypt key — read only)
 *   v2:${saltHex}:${ivHex}:${tagHex}:${ctHex} — key = scrypt(secret, salt,
 *       HKDF info 'accessbase:oidc-secret:v2') so v2 keys never collide with
 *       v1 keys for the same secret material.
 *
 * Rotation: writes use the current JWT_SECRET (v2); reads try the current
 * secret first, then JWT_SECRET_OLD (optional, rotation windows only) —
 * legacy v1 rows keep decrypting after the key changes.
 *
 * encryptSecret / decryptSecret are exported for adapter reuse (Task 4a).
 */

import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
} from 'node:crypto';
import { eq } from 'drizzle-orm';
import { logger } from '@accessbase/logging';
import { createDb, type DrizzleDB } from '../db/index.js';
import { oidcClients, type OidcClientRow } from '../db/schema.js';

const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const OIDC_V2_INFO = 'accessbase:oidc-secret:v2';

function getKeyMaterial(jwtSecret: string, salt: Buffer, info?: string): Buffer {
  const base = scryptSync(jwtSecret, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  if (info === undefined) return base; // v1 path — untouched derivation
  return Buffer.from(hkdfSync('sha256', base, salt, info, KEY_LEN));
}

/**
 * Encrypt a plaintext secret into a v2 blob using AES-256-GCM.
 * Key derived from JWT_SECRET env var via scrypt + HKDF(v2 info).
 */
export function encryptSecret(plaintext: string, salt?: Buffer): string {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  const saltBuf = salt ?? randomBytes(SALT_LEN);
  const key = getKeyMaterial(jwtSecret, saltBuf, OIDC_V2_INFO);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${saltBuf.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

/**
 * Decrypt a v1 or v2 blob back to plaintext. Current JWT_SECRET first,
 * JWT_SECRET_OLD as rotation-window fallback (both keys tried per version).
 */
export function decryptSecret(blob: string): string {
  const current = process.env['JWT_SECRET'];
  if (!current) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  const old = process.env['JWT_SECRET_OLD'];
  const keys = old && old !== current ? [current, old] : [current];

  const parts = blob.split(':');
  if (parts[0] === 'v2') {
    if (parts.length !== 5) throw new Error('Invalid secret blob format');
    const [, saltHex, ivHex, tagHex, ctHex] = parts;
    if (!saltHex || !ivHex || !tagHex || !ctHex) {
      throw new Error('Invalid secret blob format');
    }
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');
    let lastErr: unknown = new Error('Invalid secret blob format');
    for (const secret of keys) {
      try {
        const key = getKeyMaterial(secret, salt, OIDC_V2_INFO);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Decryption failed');
  }

  // Legacy v1 (explicit prefix).
  if (parts[0] !== 'v1' || parts.length !== 5) {
    throw new Error('Invalid secret blob format');
  }
  const [, saltB64, ivB64, tagB64, ctB64] = parts;
  if (!saltB64 || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Invalid secret blob format');
  }
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  let lastErr: unknown = new Error('Invalid secret blob format');
  for (const secret of keys) {
    try {
      const key = getKeyMaterial(secret, salt); // v1: untouched raw-scrypt derivation
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Decryption failed');
}

// Columns returned by list/get — secretEncrypted is NEVER exposed
const SAFE_COLUMNS = {
  id: oidcClients.id,
  clientId: oidcClients.clientId,
  name: oidcClients.name,
  redirectUris: oidcClients.redirectUris,
  postLogoutRedirectUris: oidcClients.postLogoutRedirectUris,
  grantTypes: oidcClients.grantTypes,
  scope: oidcClients.scope,
  tokenAuthMethod: oidcClients.tokenAuthMethod,
  backchannelLogoutUri: oidcClients.backchannelLogoutUri, // URI is operator-visible config, not secret
  createdAt: oidcClients.createdAt,
  updatedAt: oidcClients.updatedAt,
};

export type OidcClientListRow = Omit<OidcClientRow, 'secretEncrypted'>;

export interface OidcClientCreateInput {
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  scope: string;
  tokenAuthMethod?: string;
  /** Q3D */
  backchannelLogoutUri?: string | null;
}

export interface OidcClientCreateResult {
  client: OidcClientRow;
  plaintextSecret: string;
}

export class OidcClientManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string | DrizzleDB) {
    this.db =
      typeof databaseUrl === 'string' || databaseUrl === undefined
        ? createDb(databaseUrl)
        : databaseUrl;
  }

  async create(input: OidcClientCreateInput): Promise<OidcClientCreateResult> {
    const clientId = 'ab_' + randomBytes(8).toString('base64url');
    const plaintextSecret = randomBytes(32).toString('base64url');
    const secretEncrypted = encryptSecret(plaintextSecret);

    const row = {
      clientId,
      name: input.name,
      secretEncrypted,
      redirectUris: input.redirectUris,
      postLogoutRedirectUris: [],
      grantTypes: input.grantTypes,
      scope: input.scope,
      tokenAuthMethod: input.tokenAuthMethod ?? 'client_secret_basic',
      backchannelLogoutUri: input.backchannelLogoutUri ?? null,
    };

    const [inserted] = await this.db.insert(oidcClients).values(row).returning();
    if (!inserted) {
      throw new Error('Failed to create OIDC client');
    }

    logger.info({ clientId }, 'OIDC client created');
    return { client: inserted, plaintextSecret };
  }

  async list(): Promise<OidcClientListRow[]> {
    return await this.db.select(SAFE_COLUMNS).from(oidcClients);
  }

  async get(clientId: string): Promise<OidcClientRow | undefined> {
    const rows = await this.db.select().from(oidcClients).where(eq(oidcClients.clientId, clientId)).limit(1);
    return rows[0] as OidcClientRow | undefined;
  }

  async rotateSecret(clientId: string): Promise<string> {
    const newSecret = randomBytes(32).toString('base64url');
    const newBlob = encryptSecret(newSecret);

    await this.db
      .update(oidcClients)
      .set({ secretEncrypted: newBlob, updatedAt: new Date() })
      .where(eq(oidcClients.clientId, clientId));

    logger.info({ clientId }, 'OIDC client secret rotated');
    return newSecret;
  }

  async remove(clientId: string): Promise<void> {
    await this.db.delete(oidcClients).where(eq(oidcClients.clientId, clientId));
    logger.info({ clientId }, 'OIDC client removed');
  }
}
