/**
 * SessionManager - DB-side refresh token lifecycle (Phase 6a Task 4)
 *
 * Owns: hashToken, issueRefreshToken, rotateRefreshToken (with reuse
 * detection), revokeAllUserSessions, revokeSession, findSessionByToken.
 * Access tokens are signed by the caller (route handlers via app.jwt).
 */
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb, type DrizzleDB } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { logger } from '@accessbase/logging';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TokenMeta {
  ip: string;
  userAgent: string;
}

export class SessionManager {
  private readonly db: DrizzleDB;

  constructor(databaseUrl?: string) {
    this.db = createDb(databaseUrl);
  }

  /** Insert a new session row holding the sha256 of the raw refresh token. */
  async issueRefreshToken(
    sessionId: string,
    userId: string,
    meta: TokenMeta,
  ): Promise<{ refreshToken: string }> {
    const refreshToken = randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    await this.db.insert(sessions).values({
      id: sessionId,
      userId,
      token: this.hashToken(refreshToken),
      refreshTokenHash: this.hashToken(refreshToken),
      expiresAt,
      deviceInfo: { userAgent: meta.userAgent },
      ipAddress: meta.ip,
    });

    return { refreshToken };
  }

  /**
   * Rotate: validate the raw refresh token against the DB hash, mark the old
   * session used, and return a fresh refresh token. If the token was already
   * used (replay), revoke EVERY session for that user and throw.
   */
  async rotateRefreshToken(
    oldToken: string,
    meta: TokenMeta,
  ): Promise<{ refreshToken: string; userId: string }> {
    const oldHash = this.hashToken(oldToken);

    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, oldHash))
      .limit(1);

    if (!session) {
      throw new Error('Session not found');
    }
    if (session.revokedAt) {
      throw new Error('Session revoked');
    }
    if (session.usedAt) {
      // Reuse of a rotated token = replay attack: burn everything.
      logger.warn(
        { userId: session.userId, sessionId: session.id },
        'Refresh token reuse detected, revoking all sessions',
      );
      await this.revokeAllUserSessions(session.userId);
      throw new Error('Token reuse detected');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new Error('Session expired');
    }

    await this.db
      .update(sessions)
      .set({ usedAt: new Date() })
      .where(eq(sessions.id, session.id));

    const newToken = randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await this.db.insert(sessions).values({
      userId: session.userId,
      token: this.hashToken(newToken),
      refreshTokenHash: this.hashToken(newToken),
      expiresAt,
      deviceInfo: { userAgent: meta.userAgent },
      ipAddress: meta.ip,
    });

    return { refreshToken: newToken, userId: session.userId };
  }

  /** Resolve a session row by raw refresh token (for logout revocation). */
  async findSessionByToken(refreshToken: string) {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, this.hashToken(refreshToken)))
      .limit(1);
    return session ?? null;
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, userId));
  }

  async revokeSession(id: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, id));
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
