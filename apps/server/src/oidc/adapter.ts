/**
 * OidcAdapter — persistent adapter for oidc-provider@9 (batch N).
 *
 * EVERY non-Client kind (Session, Grant, AccessToken, RefreshToken,
 * AuthorizationCode, Interaction, ClientCredentials, DeviceCode,
 * BackchannelAuthenticationRequest, PreAuthorizedCode, ReplayDetection)
 * round-trips through the oidc_adapter_state table: verbatim jsonb payload +
 * derived index columns (kind-scoped uid for Session, lower-cased userCode,
 * grantId) + TTL from the provider's relative expiresIn (official memory
 * adapter formula: now + expiresIn + clockTolerance seconds).
 *
 * Replaces the batch-5 in-memory Map catch-all whose own ponytail note
 * admitted restarts wiped every RP refresh token. Provider semantics kept
 * faithful to the official memory adapter (verified against
 * oidc-provider@9 lib/adapters/memory_adapter.js):
 *  - consume MARKS payload.consumed (epoch seconds) — does NOT delete;
 *  - find on an expired row deletes it and returns undefined;
 *  - the uid index is maintained for Session rows only;
 *  - Client stays manager-owned (upsert throws; find reads oidc_clients).
 */
import { and, eq, isNotNull, lte, or, isNull, gt, sql } from 'drizzle-orm';
import type { DrizzleDB } from '@accessbase/identity/db';
import { oidcAdapterState, oidcClients, type OidcClientRow } from '@accessbase/identity/db';
import { decryptSecret } from '@accessbase/identity';
import { logger } from '@accessbase/logging';

type GetUserFn = (id: string) => Promise<{ name?: string; email?: string } | null> | null;

interface OidcAccount {
  accountId: string;
  claims(): Promise<Record<string, unknown>>;
}

/** drizzle 0.29 jsonb round-trip differs across seams (PIT jsonb family):
 *  real pool → object, some fakes → string. Accept both, never assume. */
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return (value ?? {}) as Record<string, unknown>;
}

function derivedColumns(kind: string, payload: Record<string, unknown>) {
  const grantId = typeof payload['grantId'] === 'string' ? payload['grantId'] : null;
  const rawCode = typeof payload['userCode'] === 'string' ? payload['userCode'] : null;
  return {
    grantId,
    userCode: rawCode ? rawCode.toLowerCase() : null,
    // official adapter indexes uid ONLY when model === 'Session'
    uid: kind === 'Session' && typeof payload['uid'] === 'string' ? payload['uid'] : null,
  };
}

function notAfterFor(expiresIn: number | undefined, clockTolerance: number): Date | null {
  if (typeof expiresIn !== 'number') return null;
  return new Date(Date.now() + (expiresIn + clockTolerance) * 1000);
}

export class OidcAdapter {
  private readonly db: DrizzleDB;
  private readonly getUser: GetUserFn;
  private readonly clockTolerance: number;

  constructor(
    databaseUrl: DrizzleDB,
    deps?: { getUser?: GetUserFn; clockTolerance?: number },
  ) {
    this.db = databaseUrl;
    this.getUser = deps?.getUser ?? (async () => null);
    this.clockTolerance = deps?.clockTolerance ?? 0;
  }

  async upsert(
    kind: string,
    id: string,
    payload: Record<string, unknown>,
    expiresIn?: number,
  ): Promise<void> {
    if (kind === 'Client') {
      // Clients are provisioned via OidcClientManager (admin flow), not by
      // the provider runtime.
      throw new Error('Client upsert not supported; use OidcClientManager');
    }
    const set = {
      payload,
      ...derivedColumns(kind, payload),
      notAfter: notAfterFor(expiresIn, this.clockTolerance),
      updatedAt: new Date(),
    };
    await this.db
      .insert(oidcAdapterState)
      .values({ kind, id, ...set })
      .onConflictDoUpdate({
        target: [oidcAdapterState.kind, oidcAdapterState.id],
        set,
      });
  }

  async find(kind: string, id: string): Promise<unknown | undefined> {
    if (kind === 'Client') {
      return await this.findClient(id);
    }
    const rows = await this.db
      .select()
      .from(oidcAdapterState)
      .where(and(eq(oidcAdapterState.kind, kind), eq(oidcAdapterState.id, id)))
      .limit(1);
    const row = rows[0] as { payload: unknown; notAfter: Date | null } | undefined;
    if (!row) return undefined;
    if (row.notAfter && row.notAfter.getTime() <= Date.now()) {
      await this.destroy(kind, id);
      return undefined;
    }
    return asObject(row.payload);
  }

  /**
   * Provider semantics (memory adapter parity): mark consumed, keep the row —
   * the provider's replay logic reads the marker via a later find(). The
   * jsonb_set runs inside UPDATE ⇒ atomic get-mark pair under concurrency.
   */
  async consume(kind: string, id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .update(oidcAdapterState)
      .set({
        payload: sql`jsonb_set(${oidcAdapterState.payload}, '{consumed}', to_jsonb(${now}::bigint))`,
        updatedAt: new Date(),
      })
      .where(and(eq(oidcAdapterState.kind, kind), eq(oidcAdapterState.id, id)));
  }

  async findByUid(kind: string, uid: string): Promise<unknown | undefined> {
    const rows = await this.db
      .select()
      .from(oidcAdapterState)
      .where(
        and(
          eq(oidcAdapterState.kind, kind),
          eq(oidcAdapterState.uid, uid),
          or(isNull(oidcAdapterState.notAfter), gt(oidcAdapterState.notAfter, new Date())),
        ),
      )
      .limit(1);
    const row = rows[0] as { payload: unknown } | undefined;
    return row ? asObject(row.payload) : undefined;
  }

  async findByUserCode(kind: string, userCode: string): Promise<unknown | undefined> {
    const rows = await this.db
      .select()
      .from(oidcAdapterState)
      .where(
        and(
          eq(oidcAdapterState.kind, kind),
          eq(oidcAdapterState.userCode, userCode.toLowerCase()),
          or(isNull(oidcAdapterState.notAfter), gt(oidcAdapterState.notAfter, new Date())),
        ),
      )
      .limit(1);
    const row = rows[0] as { payload: unknown } | undefined;
    return row ? asObject(row.payload) : undefined;
  }

  async destroy(kind: string, id: string): Promise<void> {
    await this.db
      .delete(oidcAdapterState)
      .where(and(eq(oidcAdapterState.kind, kind), eq(oidcAdapterState.id, id)));
  }

  /**
   * Drop every row of THIS kind bound to the grant. The provider invokes
   * revokeByGrantId on each grantable model's adapter (AccessToken,
   * AuthorizationCode, RefreshToken, DeviceCode, BackchannelAuthenticationRequest,
   * PreAuthorizedCode — official memory-adapter grantable set). Kind-scoping is
   * load-bearing: Interaction payloads carry grantId too, and a kind-blind
   * DELETE would destroy in-flight consent rows (review B1).
   */
  async revokeByGrantId(kind: string, grantId: string): Promise<void> {
    await this.db
      .delete(oidcAdapterState)
      .where(and(eq(oidcAdapterState.kind, kind), eq(oidcAdapterState.grantId, grantId)));
  }

  async findAccount(_ctx: unknown, accountId: string): Promise<OidcAccount> {
    const id = accountId;
    const user = await Promise.resolve(this.getUser(id));
    return {
      accountId: id,
      claims: async () => ({
        sub: id,
        name: user?.name ?? undefined,
        email: user?.email ?? undefined,
        email_verified: false,
      }),
    };
  }

  // SECURITY (review B3): for opaque token kinds the row `id` IS the bearer
  // token value (formats/opaque.js returns jti as the value) — logs and error
  // messages must NEVER carry `id` or `payload`. pino redact does not cover a
  // top-level `id` key, so discipline lives here.

  /**
   * Garbage collection of expired rows (sweeper wired at app bootstrap with
   * unref + onClose cleanup). Errors swallowed-and-logged: the interval must
   * never take the process down (L-T3 uncaughtException exit contract).
   */
  async sweepExpired(): Promise<number> {
    try {
      const gone = await this.db
        .delete(oidcAdapterState)
        .where(and(isNotNull(oidcAdapterState.notAfter), lte(oidcAdapterState.notAfter, new Date())))
        .returning({ kind: oidcAdapterState.kind, id: oidcAdapterState.id });
      if (gone.length > 0) {
        logger.debug({ swept: gone.length }, 'oidc adapter state sweep');
      }
      return gone.length;
    } catch (err) {
      logger.warn({ err }, 'oidc adapter sweep failed — next tick retries');
      return 0;
    }
  }

  private async findClient(id: string): Promise<Record<string, unknown> | undefined> {
    const rows = await this.db
      .select()
      .from(oidcClients)
      .where(eq(oidcClients.clientId, id))
      .limit(1);
    const row = rows[0] as OidcClientRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      // Protocol metadata uses snake_case — camelCase clientId would fail the
      // provider's Client schema ("client_id is mandatory property").
      client_id: row.clientId,
      name: row.name,
      client_secret: decryptSecret(row.secretEncrypted),
      redirect_uris: row.redirectUris,
      post_logout_redirect_uris: row.postLogoutRedirectUris,
      grant_types: row.grantTypes,
      scope: row.scope,
      token_endpoint_auth_method: row.tokenAuthMethod,
    };
  }
}
