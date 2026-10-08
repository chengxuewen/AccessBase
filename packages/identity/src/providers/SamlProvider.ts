/**
 * SamlProvider - SAML 2.0 SP login via @node-saml/node-saml (Batch F Task 1)
 *
 * Pure protocol provider, same seam as LdapProvider: no tenantId, no
 * UserManager - the route layer (Task 2/3) provisions the user row and owns
 * options-driven config mapping.
 *
 * R5: @node-saml/node-saml is NEVER imported at top level. It is loaded
 * lazily via a module-level cached dynamic import, so deployments with SAML
 * disabled never pay the module load.
 */
import { logger } from '@accessbase/logging';

/** Config mirrors the options keys the route layer (Task 2) will read. */
export interface SamlProviderConfig {
  enabled: boolean;
  entryPoint: string;
  idpCert: string;
  entityId: string;
  callbackUrl: string;
  idpIssuer?: string;
  privateKey?: string;
  publicCert?: string;
  clockSkewMs?: number;
  /**
   * Logout-coherence §3.6: Redis-backed request-ID cache injected by the
   * server layer (identity stays redis-free — dispatcher-deps precedent).
   * Structurally compatible with @node-saml/node-saml CacheProvider
   * (types.d.ts:22-25); absent -> node-saml's per-instance in-memory default.
   */
  cacheProvider?: SamlCacheProvider;
  /** IdP SLO endpoint (option saml_logout_url); defaults to entryPoint at the read site (B3). */
  logoutUrl?: string;
  /** Our public SLO callback URL advertised in SP metadata (option saml_slo_callback_url). */
  logoutCallbackUrl?: string;
}
/** node-saml CacheProvider shape re-declared here to keep the seam dependency-free. */
export interface SamlCacheProvider {
  saveAsync(key: string, value: string): Promise<{ value: string; createdAt: number } | null>;
  getAsync(key: string): Promise<string | null>;
  removeAsync(key: string | null): Promise<string | null>;
}
/** Successful SAML POST assertion outcome. */
export interface SamlIdentity {
  email: string;
  nameId: string;
  displayName?: string;
  /** AuthnStatement SessionIndex — required later for SP-initiated SLO (§3.1). */
  sessionIndex?: string;
}
/** Minimal view of a validated inbound SLO LogoutRequest (node-saml Profile subset). */
export interface SamlSloProfile {
  /** Message ID -> InResponseTo when answering the request. */
  id?: string;
  nameId: string;
  sessionIndex?: string;
}
/** SLO inbound-message validation input: binding-selective, never throws. */
export type SamlSloInput =
  | { binding: 'redirect'; query: Record<string, unknown>; originalQuery: string }
  | { binding: 'post'; container: Record<string, string> };
/** SLO validation outcome: request (with profile), response (nothing to echo), or uniform error. */
export type SamlSloResult = { kind: 'request'; profile: SamlSloProfile } | { kind: 'response' } | SamlValidationError;

/** Uniform failure result: validateResponse NEVER throws. */
export interface SamlValidationError {
  error: 'AUTH_SAML_002';
  message: string;
}

/** Module-level lazy cache (R5): zero load when SAML is disabled. */
let cached: typeof import('@node-saml/node-saml') | null = null;

async function getSamlModule(): Promise<typeof import('@node-saml/node-saml')> {
  cached ??= await import('@node-saml/node-saml');
  return cached;
}

export class SamlProvider {
  name = 'saml';
  type = 'oidc' as const; // Same convention as LdapProvider (SDD).
  enabled: boolean;
  private config: SamlProviderConfig;
  private samlInstance: InstanceType<(typeof import('@node-saml/node-saml'))['SAML']> | null = null;

  constructor(config: SamlProviderConfig) {
    this.enabled = config.enabled;
    this.config = config;
  }

  /**
   * Resolve the lazily-imported module and construct the SAML instance once.
   * Constructor options follow the brief verbatim; privateKey/publicCert/
   * idpIssuer keys are only included when non-empty (node-saml may reject
   * empty strings).
   */
  private async getSaml(): Promise<InstanceType<(typeof import('@node-saml/node-saml'))['SAML']>> {
    const mod = await getSamlModule();
    if (!this.samlInstance) {
      const options: Record<string, unknown> = {
        issuer: this.config.entityId,
        callbackUrl: this.config.callbackUrl,
        idpCert: this.config.idpCert,
        entryPoint: this.config.entryPoint,
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: true,
        // Request-ID cache: a Redis CacheProvider is injected by the server layer
        // (§3.6, saml.ts buildProvider). The node-saml default is per-instance —
        // dead between /saml/login and /saml/acs because buildProvider constructs
        // per request (R6 precondition, spec 2026-10-08 logout-coherence).
        validateInResponseTo: 'always',
        acceptedClockSkewMs: this.config.clockSkewMs ?? 300000,
        identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        audience: this.config.entityId,
      };
      if (this.config.privateKey) options['privateKey'] = this.config.privateKey;
      if (this.config.publicCert) options['publicCert'] = this.config.publicCert;
      if (this.config.idpIssuer) options['idpIssuer'] = this.config.idpIssuer;
      if (this.config.cacheProvider) options['cacheProvider'] = this.config.cacheProvider;
      // LogoutRequest/Response destination; node-saml defaults it to entryPoint (saml.js:95).
      if (this.config.logoutUrl) options['logoutUrl'] = this.config.logoutUrl;
      this.samlInstance = new mod.SAML(options as unknown as ConstructorParameters<typeof mod.SAML>[0]);
    }
    return this.samlInstance;
  }

  /** Build the IdP redirect URL for SP-initiated login (Task 2 route uses this). */
  async loginUrl(relayState: string, host?: string): Promise<string> {
    const saml = await this.getSaml();
    logger.debug({ relayState }, 'Generating SAML login URL');
    return saml.getAuthorizeUrlAsync(relayState, host, {});
  }

  /**
   * Validate a SAML POST assertion. Never throws: any validation failure
   * (signature, timestamps, audience, status) collapses to a uniform
   * AUTH_SAML_002 error result with a generic message - no IdP detail leak.
   */
  async validateResponse(
    container: Record<string, string>,
  ): Promise<SamlIdentity | SamlValidationError> {
    const saml = await this.getSaml();
    try {
      const { profile } = await saml.validatePostResponseAsync(container);
      if (!profile) {
        return { error: 'AUTH_SAML_002', message: 'SAML sign-in failed' };
      }
      // node-saml Profile: email / mail / nameID all exist; displayName via
      // index signature (undefined-safe, noPropertyAccessFromIndexSignature).
      const email = profile.email ?? profile.mail ?? profile.nameID;
      const displayName = profile['displayName'];
      const identity: SamlIdentity = {
        email,
        nameId: profile.nameID,
      };
      if (typeof displayName === 'string') identity.displayName = displayName;
      if (typeof profile.sessionIndex === 'string' && profile.sessionIndex !== '') {
        identity.sessionIndex = profile.sessionIndex;
      }
      return identity;
    } catch (err) {
      logger.warn({ err }, 'SAML response validation failed');
      return { error: 'AUTH_SAML_002', message: 'SAML sign-in failed' };
    }
  }

  /**
   * Generate the SP-initiated LogoutRequest URL (§3.1): the destination
   * resolves from the logoutUrl config (entryPoint fallback wired at the
   * server read site). nameIDFormat mirrors the identifierFormat above.
   */
  async logoutUrl(nameId: string, sessionIndex: string | null): Promise<string> {
    const saml = await this.getSaml();
    const profile: Record<string, unknown> = {
      nameID: nameId,
      nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    };
    if (sessionIndex) profile['sessionIndex'] = sessionIndex;
    return saml.getLogoutUrlAsync(
      profile as unknown as Parameters<typeof saml.getLogoutUrlAsync>[0],
      '',
      {},
    );
  }

  /**
   * Validate an inbound SLO message (§3.2). Message-type discrimination lives
   * with the caller (container.SAMLRequest vs SAMLResponse selects the
   * validator path, saml.js:650-654). Never throws: any rejection collapses
   * to the uniform AUTH_SAML_002 error result (the route maps it to a 302 —
   * SLO reuses the AUTH_SAML_002 posture, spec §5).
   */
  async validateSlo(input: SamlSloInput): Promise<SamlSloResult> {
    const saml = await this.getSaml();
    try {
      let profile: Awaited<ReturnType<typeof saml.validateRedirectAsync>>['profile'] | null = null;
      if (input.binding === 'redirect') {
        // R10: originalQuery MUST be the raw query string after '?', never the
        // path-prefixed url — the redirect signature base depends on it verbatim.
        ({ profile } = await saml.validateRedirectAsync(
          input.query as Parameters<typeof saml.validateRedirectAsync>[0],
          input.originalQuery,
        ));
        // The redirect validator answers LogoutResponse with a null profile
        // (processValidlySignedSamlLogoutAsync, saml.js:998-1000).
        if (!profile) return { kind: 'response' };
      } else if (input.container['SAMLRequest']) {
        ({ profile } = await saml.validatePostRequestAsync(input.container));
        if (!profile) return { error: 'AUTH_SAML_002', message: 'SAML SLO validation failed' };
      } else {
        // POST-bound LogoutResponse: signature enforced inside the validator;
        // a LogoutResponse parses to profile=null by design (saml.js:615-618).
        await saml.validatePostResponseAsync(input.container);
        return { kind: 'response' };
      }
      const sloProfile = toSloProfile(profile);
      if (sloProfile.nameId === '') {
        return { error: 'AUTH_SAML_002', message: 'SAML SLO validation failed' };
      }
      return { kind: 'request', profile: sloProfile };
    } catch (err) {
      logger.warn({ err }, 'SAML SLO message validation failed');
      return { error: 'AUTH_SAML_002', message: 'SAML SLO validation failed' };
    }
  }

  /** Echo a LogoutResponse back to the IdP for a validated inbound LogoutRequest (§3.2). */
  async logoutResponseUrl(profile: SamlSloProfile, relayState: string): Promise<string> {
    const saml = await this.getSaml();
    return saml.getLogoutResponseUrlAsync(
      { ID: profile.id } as unknown as Parameters<typeof saml.getLogoutResponseUrlAsync>[0],
      relayState,
      {},
      true,
    );
  }

  /**
   * SP metadata XML via the standalone generator. SingleLogoutService is
   * emitted only when logoutCallbackUrl is configured (metadata.js:86-89, B3).
   */
  async metadataXml(): Promise<string> {
    const { generateServiceProviderMetadata } = await getSamlModule();
    logger.debug({ entityId: this.config.entityId }, 'Generating SAML SP metadata');
    return generateServiceProviderMetadata({
      issuer: this.config.entityId,
      callbackUrl: this.config.callbackUrl,
      ...(this.config.logoutCallbackUrl
        ? { logoutCallbackUrl: this.config.logoutCallbackUrl }
        : {}),
    });
  }
}

/** Narrow the node-saml Profile into the SLO profile view. */
function toSloProfile(profile: {
  ID?: string;
  nameID?: string;
  sessionIndex?: string;
}): SamlSloProfile {
  const slo: SamlSloProfile = { nameId: profile.nameID ?? '' };
  if (profile.ID) slo.id = profile.ID;
  if (profile.sessionIndex) slo.sessionIndex = profile.sessionIndex;
  return slo;
}
