/**
 * buildOidcProvider — provider factory + keystore (Task 4b, B1/B2 landing).
 *
 * Configuration is ratified (plan R1): pkce.required = true explicit (the
 * default only forces PKCE for token_endpoint_auth_method=none); cookies.keys
 * derived from JWT_SECRET (restart-stable, multi-instance shared); RS256
 * keystore from JWT_*_KEY_PATH files with production fail-fast and a dev
 * ephemeral fallback. Adapter is the Task 4a OidcAdapter class.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import Provider from 'oidc-provider';
import type { Configuration, JWKS } from 'oidc-provider';
import { logger } from '@accessbase/logging';
import { OidcAdapter } from './adapter.js';

export interface BuildOidcProviderOptions {
  issuer: string;
  jwtSecret: string;
  nodeEnv: string;
  privateKeyPath: string;
  publicKeyPath: string;
  /** Args for the OidcAdapter constructor (databaseUrl + injected deps). */
  adapterCtorArgs: ConstructorParameters<typeof OidcAdapter>;
}

interface JwkSet {
  keys: Array<Record<string, unknown>>;
}

/** RS256 JWK set from JWT key files; throws with a generation hint in production. */
function loadJwks(opts: BuildOidcProviderOptions): JwkSet | undefined {
  if (!opts.privateKeyPath || !opts.publicKeyPath) {
    if (opts.nodeEnv === 'production') {
      throw new Error(
        'OIDC provider requires RS256 keys in production. Set JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH. Generate: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048',
      );
    }
    // ponytail: dev/test ephemeral keystore — restart rotates id_tokens; use
    // JWT_*_KEY_PATH files when RP key pinning matters
    logger.warn('OIDC provider running without JWT key files — ephemeral signing keys in use (dev only)');
    return undefined; // provider falls back to its dev-only keystore
  }
  for (const p of [opts.privateKeyPath, opts.publicKeyPath]) {
    if (!existsSync(p)) {
      if (opts.nodeEnv === 'production') {
        throw new Error(`OIDC provider RS256 key file missing: ${p} (JWT key paths)`);
      }
      logger.warn({ path: p }, 'JWT key file not found — ephemeral OIDC signing keys (dev only)');
      return undefined;
    }
  }
  const privateKeyPem = readFileSync(opts.privateKeyPath, 'utf-8');
  // createPrivateKey accepts PKCS8 PEM; export as private JWK (n/e/d/p/q/dp/dq/qi)
  const { createPrivateKey } = require('node:crypto') as typeof import('node:crypto');
  const jwk = createPrivateKey(privateKeyPem).export({ format: 'jwk' }) as Record<string, unknown>;
  return { keys: [{ ...jwk, use: 'sig', alg: 'RS256' }] };
}

export async function buildOidcProvider(opts: BuildOidcProviderOptions): Promise<{
  provider: Provider;
  oidcHandler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>;
}> {
  const jwks = loadJwks(opts);

  const configuration: Configuration = {
    adapter: OidcAdapter as unknown as Configuration['adapter'],
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
      introspection: { enabled: true },
      clientCredentials: { enabled: true },
    },
    // Explicit: the default only forces PKCE for token_endpoint_auth_method=none.
    pkce: { required: () => true },
    cookies: {
      keys: [createHash('sha256').update(`oidc-cookies:${opts.jwtSecret}`).digest('hex')],
    },
  };

  const jwksConfig: JWKS | undefined = jwks ? { keys: jwks.keys as JWKS['keys'] } : undefined;
  const provider = new Provider(opts.issuer, jwksConfig ? { ...configuration, jwks: jwksConfig } : configuration);

  // B1/B2: callback() is a Koa factory — build the http handler ONCE.
  const oidcHandler = provider.callback();

  return { provider, oidcHandler };
}
