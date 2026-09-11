/**
 * OidcClientManager — OIDC client CRUD with encrypted secrets.
 *
 * Client secrets are stored AES-256-GCM encrypted with a key derived via
 * scrypt(JWT_SECRET, per-record salt). Blob format:
 *   v1:${base64(salt)}:${base64(iv)}:${base64(tag)}:${base64(ct)}
 *
 * encryptSecret / decryptSecret are exported for adapter reuse (Task 4a).
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { logger } from '@accessbase/logging';
import { createDb, type DrizzleDB } from '../db/index.js';
import { oidcClients, type OidcClientRow } from '../db/schema.js';

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function getKeyMaterial(jwtSecret: string, salt: Buffer): Buffer {
  return scryptSync(jwtSecret, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

/**
 * Encrypt a plaintext secret into a v1: blob using AES-256-GCM.
 * Key derived from JWT_SECRET env var via scrypt.
 */
export function encryptSecret(plaintext: string, salt?: Buffer): string {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  const saltBuf = salt ?? randomBytes(SALT_LEN);
  const key = getKeyMaterial(jwtSecret, saltBuf);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${saltBuf.toString('base64')}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypt a v1: blob back to plaintext.
 */
export function decryptSecret(blob: string): string {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  const parts = blob.split(':');
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
  const key = getKeyMaterial(jwtSecret, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
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
  createdAt: oidcClients.createdAt,
  updatedAt: oidcClients.updatedAt,
};

export interface OidcClientCreateInput {
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  scope: string;
  tokenAuthMethod?: string;
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
    };

    await this.db.insert(oidcClients).values(row);

    const client: OidcClientRow = {
      id: crypto.randomUUID(),
      ...row,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    logger.info({ clientId }, 'OIDC client created');
    return { client, plaintextSecret };
  }

  async list(): Promise<OidcClientRow[]> {
    return await this.db.select(SAFE_COLUMNS).from(oidcClients) as unknown as OidcClientRow[];
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
