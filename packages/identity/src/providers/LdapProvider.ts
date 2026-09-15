/**
 * LdapProvider - LDAP/AD authentication via ldapts (SDD 2.1, Batch D Task 2)
 *
 * Real Admin Bind flow: bind service account → search for the user entry →
 * bind AS the user to verify credentials → shape LDAP attributes into a
 * User-like result. Pure protocol: no tenantId, no UserManager (route layer
 * handles provisioning in Task 3).
 *
 * ldapts contract (R1): `new Client({ url })` is lazy (no explicit connect);
 * bind FAILS BY THROWING (never returns false); search returns
 * `{ searchEntries: [{ dn, ...flatAttrs }] }` flat pojos.
 */
import { Client } from 'ldapts';
import { logger } from '@accessbase/logging';
import type { AuthProvider, AuthResult, LdapConfig } from '../types.js';
import type { User } from '@accessbase/types';

/**
 * LDAP-sourced identity claims carried in AuthResult.user. Structurally a
 * superset view of the entry with mapped email/name; the route layer (Task 3)
 * converts these claims into a real provisioned User row.
 */
type LdapIdentityClaims = User & Record<string, unknown>;

/** RFC 4515 filter-escape (R4): all filter interpolation goes through this. */
export function escapeLdapFilter(value: string): string {
  return value
    .replaceAll('\\', '\\5c')
    .replaceAll('*', '\\2a')
    .replaceAll('(', '\\28')
    .replaceAll(')', '\\29')
    .replaceAll('\0', '\\00');
}

export class LdapProvider implements AuthProvider {
  name = 'ldap';
  type = 'oidc' as const; // Using 'oidc' as per SDD
  enabled: boolean;
  private config: LdapConfig;

  constructor(config: LdapConfig) {
    this.enabled = config.enabled;
    this.config = config;
  }

  /**
   * Map raw LDAP entry to identity claims carried in the AuthResult user
   * field. The LDAP protocol layer cannot produce a full User row (no id,
   * tenantId, tokenVersion - R5 forbids tenant knowledge here); the route
   * layer (Task 3) completes find-or-provision and issues the real row.
   */
  private mapAttributes(entry: Record<string, unknown>): LdapIdentityClaims {
    const m = this.config.attributeMapping;
    const email = typeof entry[m.mail] === 'string' ? entry[m.mail] : '';
    const name = typeof entry[m.cn] === 'string' ? entry[m.cn] : '';
    // Single documented cast: LDAP claims are intentionally a partial identity
    return { ...entry, email, name } as LdapIdentityClaims;
  }

  private errorResult(code: 'AUTH_063' | 'AUTH_064', message: string): AuthResult {
    return { success: false, error: { code, message } };
  }

  /** Admin (service account) bind + search for the user entry. */
  private async adminSearch(filter: string): Promise<Record<string, unknown>[]> {
    const client = new Client({ url: this.config.url });
    try {
      await client.bind(this.config.bindDN, this.config.bindPassword);
      const { searchEntries } = await client.search(this.config.searchBase, {
        scope: 'sub',
        filter,
      });
      return searchEntries as Record<string, unknown>[];
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Authenticate with LDAP: admin bind → search → user bind → User-shaped result.
   * AUTH_063 on connection/admin-bind failure; AUTH_064 when the user is not
   * found or their bind is rejected.
   */
  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { username, password } = (credentials ?? {}) as {
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return this.errorResult('AUTH_064', 'LDAP authentication requires username and password');
    }

    logger.debug({ username }, 'LDAP authentication attempt');

    const filter = this.buildFilter(username);

    // Step 1-2: admin bind + search (AUTH_063 on failure)
    let entries: Record<string, unknown>[];
    try {
      entries = await this.adminSearch(filter);
    } catch (err) {
      logger.warn({ err }, 'LDAP admin bind/search failed');
      return this.errorResult('AUTH_063', 'LDAP service unavailable');
    }

    // Step 3: user entry must exist (AUTH_064)
    const entry = entries[0];
    if (!entry) {
      return this.errorResult('AUTH_064', 'User not found in LDAP directory');
    }
    const dn = typeof entry['dn'] === 'string' ? entry['dn'] : '';
    if (!dn) {
      return this.errorResult('AUTH_064', 'LDAP entry has no DN');
    }

    // Step 4: verify credentials by binding as the user (AUTH_064 on rejection)
    const verified = await this.bind(dn, password);
    if (!verified) {
      return this.errorResult('AUTH_064', 'LDAP credentials rejected');
    }

    const user: LdapIdentityClaims = this.mapAttributes(entry);
    return { success: true, user };
  }

  /** Build the configured searchFilter with {username} escaped per RFC 4515. */
  private buildFilter(username: string): string {
    return this.config.searchFilter.replaceAll('{username}', escapeLdapFilter(username));
  }

  /**
   * Search for user in LDAP using the admin bind.
   */
  async searchUser(
    username: string,
  ): Promise<{ dn: string; attributes: Record<string, unknown> } | null> {
    logger.debug({ username }, 'Searching LDAP for user');

    let entries: Record<string, unknown>[];
    try {
      entries = await this.adminSearch(this.buildFilter(username));
    } catch (err) {
      logger.warn({ err, username }, 'LDAP searchUser failed');
      throw err;
    }

    const entry = entries[0];
    if (!entry) return null;
    const { dn, ...attributes } = entry;
    if (typeof dn !== 'string') return null;
    return { dn, attributes };
  }

  /**
   * Bind with user credentials. ldapts bind throws on failure (R1), so a
   * resolved promise means success and any rejection maps to false.
   */
  async bind(dn: string, password: string): Promise<boolean> {
    logger.debug({ dn }, 'Binding to LDAP with DN');

    const client = new Client({ url: this.config.url });
    try {
      await client.bind(dn, password);
      return true;
    } catch (err) {
      logger.debug({ err, dn }, 'LDAP user bind rejected');
      return false;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Sync user attributes from LDAP: map mail→email, cn/displayName→name.
   * Returns the shaped record; the route layer persists it (Task 3).
   */
  async syncAttributes(
    userId: string,
    ldapAttributes: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    logger.info({ userId }, 'Syncing LDAP attributes');

    const out: Record<string, unknown> = {};
    const mail = ldapAttributes[this.config.attributeMapping.mail];
    const cn = ldapAttributes[this.config.attributeMapping.cn];
    if (typeof mail === 'string') out['email'] = mail;
    if (typeof cn === 'string') out['name'] = cn;
    if (typeof ldapAttributes['displayName'] === 'string' && !('name' in out)) {
      out['name'] = ldapAttributes['displayName'];
    }
    return out;
  }

  /**
   * Auto-provision user from LDAP: shape attributes into a User-creatable
   * payload. Pure data-shaping — no DB access (R3); route layer (Task 3)
   * does find-or-provision.
   */
  async autoProvision(ldapAttributes: Record<string, unknown>): Promise<Record<string, unknown>> {
    logger.info({ email: ldapAttributes['mail'] }, 'Auto-provisioning user from LDAP');

    const email = ldapAttributes[this.config.attributeMapping.mail];
    const name = ldapAttributes['displayName'] ?? ldapAttributes[this.config.attributeMapping.cn];

    return {
      email: typeof email === 'string' ? email : '',
      name: typeof name === 'string' ? name : '',
      status: 'active',
      passwordHash: null,
    };
  }
}
