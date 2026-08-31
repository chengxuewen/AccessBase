/**
 * SessionManager - DB-side refresh token lifecycle (Phase 6a Task 4)
 *
 * Owns: hashToken, issueRefreshToken, rotateRefreshToken (with reuse
 * detection), revokeAllUserSessions, revokeSession, findSessionByToken.
 * Access tokens are signed by the caller (route handlers via app.jwt).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createDb, type DrizzleDB } from '../db/index.js';
import { sessions } from '../db/schema.js';
import type { RedisLike } from '../services/redis.js';
import { logger } from '@accessbase/logging';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 60;

interface TokenMeta {
  ip: string;
  userAgent: string;
}

export interface SafeSession {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: Date;
  expiresAt: Date;
}

export class SessionManager {
  private readonly db: DrizzleDB;
  private readonly redis: RedisLike | null;

  constructor(databaseUrl?: string, redis?: RedisLike) {
    this.db = createDb(databaseUrl);
    this.redis = redis ?? null;
  }

  /** Cache helpers: every path fails soft — redis is an optimization. */
  private async cacheGetList(userId: string): Promise<SafeSession[] | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(`session:${userId}`);
      return raw ? (JSON.parse(raw) as SafeSession[]) : null;
    } catch (err) {
      logger.warn({ err }, 'Session cache read failed, falling back to DB');
      return null;
    }
  }

  private async cacheSetList(userId: string, list: SafeSession[]): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(`session:${userId}`, JSON.stringify(list));
    } catch (err) {
      logger.warn({ err }, 'Session cache write failed');
    }
  }

  private async cacheInvalidateUser(userId: string | null | undefined): Promise<void> {
    if (!this.redis || !userId) return;
    try {
      await this.redis.del(`session:${userId}`);
    } catch (err) {
      logger.warn({ err }, 'Session cache invalidation failed');
    }
  }

  /** Active sessions for a user (revoked/expired excluded), safe shape only. */
  async getUserSessions(userId: string): Promise<SafeSession[]> {
    const cached = await this.cacheGetList(userId);
    if (cached) return cached;

    const rows = await this.db
      .select({
        id: sessions.id,
        deviceInfo: sessions.deviceInfo,
        ipAddress: sessions.ipAddress,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );

    const list: SafeSession[] = rows.map((row) => ({
      id: row.id,
      userAgent:
        (typeof row.deviceInfo === 'object' && row.deviceInfo !== null && 'userAgent' in row.deviceInfo
          ? String((row.deviceInfo as Record<string, unknown>)['userAgent'] ?? '')
          : ''),
      ip: row.ipAddress ?? '',
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }));
    await this.cacheSetList(userId, list);
    return list;
  }

  async validateSession(sessionId: string): Promise<boolean> {
    const [session] = await this.db
      .select({ id: sessions.id, revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) return false;
    return !session.revokedAt && session.expiresAt.getTime() > Date.now();
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

    await this.cacheInvalidateUser(session.userId);
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
    await this.cacheInvalidateUser(userId);
  }

  async revokeSession(id: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, id));
    await this.cacheInvalidateUser(await this.findUserIdBySession(id));
  }

  /** Lookup helper for cache invalidation; absent row = nothing to invalidate. */
  private async findUserIdBySession(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return row?.userId ?? null;
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
