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
}

/** Successful SAML POST assertion outcome. */
export interface SamlIdentity {
  email: string;
  nameId: string;
  displayName?: string;
}

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
        acceptedClockSkewMs: this.config.clockSkewMs ?? 300000,
        identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        audience: this.config.entityId,
      };
      if (this.config.privateKey) options['privateKey'] = this.config.privateKey;
      if (this.config.publicCert) options['publicCert'] = this.config.publicCert;
      if (this.config.idpIssuer) options['idpIssuer'] = this.config.idpIssuer;
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
      return identity;
    } catch (err) {
      logger.warn({ err }, 'SAML response validation failed');
      return { error: 'AUTH_SAML_002', message: 'SAML sign-in failed' };
    }
  }

  /** SP metadata XML via the standalone generator (logoutCallbackUrl omitted). */
  async metadataXml(): Promise<string> {
    const { generateServiceProviderMetadata } = await getSamlModule();
    logger.debug({ entityId: this.config.entityId }, 'Generating SAML SP metadata');
    return generateServiceProviderMetadata({
      issuer: this.config.entityId,
      callbackUrl: this.config.callbackUrl,
    });
  }
}
