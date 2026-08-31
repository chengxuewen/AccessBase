/**
 * MfaManager - TOTP multi-factor authentication. Phase 6b Task 3.
 *
 * Secret at rest: AES-256-GCM (see services/crypto.ts) keyed by
 * MFA_ENCRYPTION_KEY. Recovery codes: 8-hex plaintext returned exactly once,
 * bcrypt hashes persisted in mfa_recovery_codes with used/used_at.
 */
import { randomBytes } from 'node:crypto';
import { generateSecret, generateURI, generateSync, verifySync } from 'otplib';
import QRCode from 'qrcode';
import bcryptjs from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { logger } from '@accessbase/logging';
import { createDb, type DrizzleDB } from '../db/index.js';
import { users, mfaRecoveryCodes } from '../db/schema.js';
import { encrypt, decrypt } from '../services/crypto.js';
import type { MfaVerifyResult } from '../types.js';

const { hash, compare } = bcryptjs;
const RECOVERY_CODE_COUNT = 10;
const EPOCH_TOLERANCE = 30; // ±1 TOTP period (otplib v13: seconds, replaces window:1)

export interface MfaSetupResult {
  /** Base32 TOTP secret (plaintext — shown once during setup) */
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  recoveryCodes: string[];
}

export class MfaManager {
  private readonly db: DrizzleDB;
  private readonly keyHex: string;

  constructor(keyHex: string, databaseUrl?: string | DrizzleDB) {
    if (!keyHex || Buffer.from(keyHex, 'hex').length !== 32) {
      throw new Error('MFA_ENCRYPTION_KEY must be 32-byte hex (64 chars)');
    }
    this.keyHex = keyHex;
    this.db =
      typeof databaseUrl === 'string' || databaseUrl === undefined
        ? createDb(databaseUrl)
        : databaseUrl;
  }

  /**
   * Generate TOTP secret + recovery codes. Secret stored encrypted;
   * totp_enabled stays false until enable() confirms a valid code.
   */
  async setup(userId: string, email: string): Promise<MfaSetupResult> {
    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: 'AccessBase', label: email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(4).toString('hex'),
    );
    const codeHashes = await Promise.all(
      recoveryCodes.map((code) => hash(code, 10)),
    );

    await this.db
      .update(users)
      .set({ totpSecret: encrypt(secret, this.keyHex), totpEnabled: false })
      .where(eq(users.id, userId));

    await this.db.insert(mfaRecoveryCodes).values(
      codeHashes.map((codeHash) => ({ userId, codeHash, used: false })),
    );

    logger.info({ userId }, 'MFA setup generated');
    return { secret, otpauthUrl, qrDataUrl, recoveryCodes };
  }

  /** Confirm setup: verify a live TOTP code, then flip totp_enabled. */
  async enable(userId: string, code: string): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row?.totpSecret) {
      throw new Error('MFA not set up for user');
    }
    const check = verifySync({ token: code, secret: decrypt(row.totpSecret, this.keyHex), epochTolerance: EPOCH_TOLERANCE });
    if (!check.valid) {
      throw new Error('Invalid TOTP code');
    }
    await this.db.update(users).set({ totpEnabled: true }).where(eq(users.id, userId));
    logger.info({ userId }, 'MFA enabled');
  }

  /** Verify a login-time TOTP code. */
  async verify(userId: string, code: string): Promise<MfaVerifyResult> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row?.totpSecret) {
      return { success: false };
    }
    const check = verifySync({ token: code, secret: decrypt(row.totpSecret, this.keyHex), epochTolerance: EPOCH_TOLERANCE });
    return { success: check.valid };
  }

  /** Verify a recovery code and burn it (single-use). */
  async verifyRecoveryCode(userId: string, code: string): Promise<MfaVerifyResult> {
    const candidates = await this.db
      .select()
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.userId, userId), eq(mfaRecoveryCodes.used, false)))
      .limit(RECOVERY_CODE_COUNT * 2);

    for (const row of candidates) {
      if (await compare(code, row.codeHash)) {
        await this.db
          .update(mfaRecoveryCodes)
          .set({ used: true, usedAt: new Date() })
          .where(eq(mfaRecoveryCodes.id, row.id));
        logger.info({ userId }, 'MFA recovery code consumed');
        return { success: true };
      }
    }
    return { success: false };
  }

  /**
   * Wipe MFA. Password verification is the caller's (route) responsibility —
   * this manager has no UserManager dependency; routes verify before calling.
   */
  async disable(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ totpSecret: null, totpEnabled: false })
      .where(eq(users.id, userId));
    await this.db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    logger.info({ userId }, 'MFA disabled');
  }
}
