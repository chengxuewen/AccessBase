/**
 * OidcAdapter — the adapter class shape oidc-provider expects (Task 4a).
 *
 * Standalone-testable: no oidc-provider import (Task 4b wires it as the
 * adapter factory). Persisted set = {Client} via OidcClientManager; every
 * other kind (Grant included) falls through to an in-memory Map catch-all.
 *
 * ponytail: Grant/Interaction/transient kinds are in-memory — a server
 * restart drops pending consents (users re-approve) and all RP refresh
 * tokens; move Grant/RefreshToken to PG or Redis when restart-survival or
 * multi-instance deployment matters. (The oidc_grants DB round-trip was
 * tried and broken: provider-side Grant instantiation loses non-whitelisted
 * payload fields on reload, re-prompting consent endlessly.)
 */
import type { DrizzleDB } from '@accessbase/identity/db';
import { decryptSecret } from '@accessbase/identity';
import { oidcClients, type OidcClientRow } from '@accessbase/identity/db';
import { eq } from 'drizzle-orm';

// ponytail: transient kinds in-memory; restart invalidates all RP refresh
// tokens; persist RefreshToken/Session to PG or Redis for restart-survival
// and multi-instance
const memory = new Map<string, Map<string, unknown>>();

const kindKey = (kind: string, id: string): string => `${kind}:${id}`;

/** Minimal account shape oidc-provider consumes from findAccount. */
export interface OidcAccount {
  accountId: string;
  claims: (use: string, scope: string) => Promise<{
    sub: string;
    name?: string;
    email?: string;
    email_verified: boolean;
  }>;
}

/** Lookup fn so tests (and future callers) can swap the user source. */
export type GetUserFn = (id: string) => Promise<{
  id: string;
  name: string | null;
  email: string;
} | null>;

export class OidcAdapter {
  private readonly db: DrizzleDB;
  private readonly getUser: GetUserFn;

  constructor(databaseUrl: DrizzleDB, deps?: { getUser?: GetUserFn }) {
    this.db = databaseUrl;
    this.getUser = deps?.getUser ?? (async () => null);
  }

  async upsert(
    kind: string,
    id: string,
    payload: Record<string, unknown>,
    // oidc-provider passes a seconds-since-epoch expiration; in-memory kinds
    // accept but ignore it (ponytail: no TTL sweep yet).
    _expiresIn?: number,
  ): Promise<void> {
    if (kind === 'Client') {
      // Clients are provisioned via OidcClientManager (admin flow), not by
      // the provider runtime.
      throw new Error('Client upsert not supported; use OidcClientManager');
    }



    let bucket = memory.get(kind);
    if (!bucket) {
      bucket = new Map();
      memory.set(kind, bucket);
    }
    bucket.set(id, payload);
  }

  async find(kind: string, id: string): Promise<unknown | undefined> {
    if (kind === 'Client') {
      return await this.findClient(id);
    }
    return memory.get(kind)?.get(id);
  }


  async findByUid(_kind: string, uid: string): Promise<unknown | undefined> {
    for (const bucket of memory.values()) {
      for (const payload of bucket.values()) {
        const p = payload as { uid?: string };
        if (p.uid === uid) {
          return payload;
        }
      }
    }
    return undefined;
  }

  async findByUserCode(_kind: string, userCode: string): Promise<unknown | undefined> {
    for (const bucket of memory.values()) {
      for (const payload of bucket.values()) {
        const p = payload as { userCode?: string };
        if (p.userCode?.toLowerCase() === userCode.toLowerCase()) {
          return payload;
        }
      }
    }
    return undefined;
  }

  async destroy(kind: string, id: string): Promise<void> {
    memory.get(kind)?.delete(id);
  }

async consume(kind: string, id: string): Promise<void> {
memory.get(kind)?.delete(id);
  }

  /** oidc-provider revocation feature: drop every token bound to the grant.
   *  In-memory kinds carry grantId in their payload; PG-persisted kinds
   *  (Client/Grant) are not tokens. */
  async revokeByGrantId(grantId: string): Promise<void> {
    for (const bucket of memory.values()) {
      for (const [id, payload] of bucket) {
        if ((payload as { grantId?: string }).grantId === grantId) {
          bucket.delete(id);
        }
      }
    }
  }

  async findAccount(_ctx: unknown, accountId: string): Promise<OidcAccount> {
    const id = accountId;
    const user = await this.getUser(id);
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
