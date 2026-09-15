/**
 * ApiKeyManager — API key lifecycle with one-time plaintext reveal.
 *
 * Plaintext format: `ab_` + exactly 32 lowercase-alnum chars (35 total).
 * Only the sha256 hex hash is stored; the plaintext is returned exactly once
 * from create() and can never be recovered (no rotation-by-rehash — revoke and
 * create a new key instead). Mirrors the OidcClientManager one-time-reveal
 * precedent (SAFE_COLUMNS / Omit shape).
 */
import { randomBytes, createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { logger } from '@accessbase/logging';
import { createDb, type DrizzleDB } from '../db/index.js';
import { apiKeys, type ApiKeyRow } from '../db/schema.js';

const KEY_BODY_LEN = 32;
const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const PREFIX_LEN = 8;

export interface GeneratedApiKey {
  plaintext: string;
  hash: string;
  prefix: string;
}

// Columns returned by list — hash is NEVER exposed (one-time reveal precedent)
const SAFE_COLUMNS = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  scopes: apiKeys.scopes,
  expiresAt: apiKeys.expiresAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  tenantId: apiKeys.tenantId,
  createdAt: apiKeys.createdAt,
  updatedAt: apiKeys.updatedAt,
};

export type SafeApiKey = Omit<ApiKeyRow, 'hash'>;

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export class ApiKeyManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string | DrizzleDB) {
    this.db =
      typeof databaseUrl === 'string' || databaseUrl === undefined
        ? createDb(databaseUrl)
        : databaseUrl;
  }

  /**
   * Generate a new key. Loop randomBytes and filter the [a-z0-9] charset
   * until 32 chars are collected — simplest correct form that guarantees the
   * exactly-32-lowercase-alnum contract without base64url lookalike chars.
   */
  static generateApiKey(): GeneratedApiKey {
    const chars: string[] = [];
    while (chars.length < KEY_BODY_LEN) {
      for (const byte of randomBytes(KEY_BODY_LEN)) {
        if (chars.length < KEY_BODY_LEN) {
          chars.push(CHARSET[byte % CHARSET.length] as string);
        }
      }
    }
    const plaintext = 'ab_' + chars.join('');
    return { plaintext, hash: hashApiKey(plaintext), prefix: plaintext.slice(0, PREFIX_LEN) };
  }

  static isExpired(expiresAt: Date | null): boolean {
    return expiresAt !== null && expiresAt.getTime() <= Date.now();
  }

  async create(
    name: string,
    scopes: string[],
    tenantId: string,
    expiresAt?: Date,
  ): Promise<SafeApiKey & { plaintext: string }> {
    const { plaintext, hash, prefix } = ApiKeyManager.generateApiKey();

    const values = {
      name,
      prefix,
      hash,
      scopes,
      tenantId,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };

    const [inserted] = (await this.db.insert(apiKeys).values(values).returning()) as ApiKeyRow[];
    if (!inserted) {
      throw new Error('Failed to create API key');
    }

    logger.info({ keyId: inserted.id }, 'API key created');
    const { hash: _hash, ...safe } = inserted;
    return { ...safe, plaintext };
  }

  async list(tenantId: string): Promise<SafeApiKey[]> {
    const rows = (await this.db
      .select(SAFE_COLUMNS)
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, tenantId))) as SafeApiKey[];
    return rows;
  }

  async findByHash(hash: string): Promise<ApiKeyRow | null> {
    const rows = (await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.hash, hash))
      .limit(1)) as ApiKeyRow[];
    return rows[0] ?? null;
  }

  async revoke(id: string, tenantId: string): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId)));
    logger.info({ keyId: id }, 'API key revoked');
  }
}
