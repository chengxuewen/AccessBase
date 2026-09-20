/**
 * buildOidcProvider — provider factory + keystore (Task 4b, B1/B2 landing).
 *
 * Configuration is ratified (plan R1): pkce.required = true explicit (the
 * default only forces PKCE for token_endpoint_auth_method=none); cookies.keys
 * derived from JWT_SECRET (restart-stable, multi-instance shared); RS256
 * keystore from JWT_*_KEY_PATH files with production fail-fast and a dev
 * ephemeral fallback. Adapter is the Task 4a OidcAdapter class.
 */
import { createHash, createPrivateKey } from 'node:crypto';
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
  /** SPA origin for interaction redirects (dev topology, review B3). */
  frontendOrigin?: string;
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
  const jwk = createPrivateKey(privateKeyPem).export({ format: 'jwk' }) as Record<string, unknown>;
  return { keys: [{ ...jwk, use: 'sig', alg: 'RS256' }] };
}

export async function buildOidcProvider(opts: BuildOidcProviderOptions): Promise<{
  provider: Provider;
  oidcHandler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>;
}> {
  const jwks = loadJwks(opts);

  // Adapter as a FACTORY (not the class itself): oidc-provider instantiates
  // `new AdapterCtor(kind)` / calls `Adapter(kind)` and then invokes the
  // SINGLE-ARG form — find(id) / upsert(id, payload, ttl) / destroy(id) —
  // with the kind fixed at construction (models/client.js and base_model.js
  // both call adapter.find(jti) with no kind). OidcAdapter's methods take
  // (kind, ...) instead, so the factory returns a per-kind partial that
  // binds the kind. One shared instance serves all kinds.
  const adapterInstance = new OidcAdapter(...opts.adapterCtorArgs);
  const accountAdapter = new OidcAdapter(...opts.adapterCtorArgs);
  const kindAdapter = (kind: string) => ({
    upsert: (id: string, payload: Record<string, unknown>, expiresIn?: number) =>
      adapterInstance.upsert(kind, id, payload, expiresIn),
    find: (id: string) => adapterInstance.find(kind, id),
    findByUid: (uid: string) => adapterInstance.findByUid(kind, uid),
    findByUserCode: (userCode: string) => adapterInstance.findByUserCode(kind, userCode),
    destroy: (id: string) => adapterInstance.destroy(kind, id),
    consume: (id: string) => adapterInstance.consume(kind, id),
    revokeByGrantId: (grantId: string) => adapterInstance.revokeByGrantId(grantId),
  });
  const frontendOrigin = opts.frontendOrigin ?? 'http://localhost:5173';

  const configuration: Configuration = {
    adapter: ((kind: string) => kindAdapter(kind)) as unknown as Configuration['adapter'],
    // M2: account claims come from the adapter's user mapping (sub/name/email).
    // Cast: OidcAccount is structurally the {accountId, claims} pair provider
    // consumes, but the lib's Account type demands an index signature.
    findAccount: (async (_ctx: unknown, accountId: string) =>
      accountAdapter.findAccount(_ctx, accountId)) as unknown as Configuration['findAccount'],
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
      introspection: { enabled: true },
      clientCredentials: { enabled: true },
    },
    // M2: scope + claims mapping — `openid profile email` must be declared or
    // authorize requests requesting those scopes fail with invalid_client_metadata
    // ("scope must only contain Authorization Server supported scope values").
    claims: {
      profile: ['name'],
      email: ['email', 'email_verified'],
    },
    // Explicit: the default only forces PKCE for token_endpoint_auth_method=none.
    pkce: { required: () => true },
    // B3 topology: the provider 302s to our frontend for login (dev: absolute
    // FRONTEND_ORIGIN URL; deploy single-port: relative) and to /consent for
    // the consent prompt (Task 6 renders both routes).
    interactions: {
      url: (_ctx, interaction) => {
        if (interaction.prompt.name === 'login') {
          const target = `/login?redirect=${encodeURIComponent(`/oidc/auth/${interaction.uid}`)}`;
          return opts.nodeEnv === 'production' ? target : `${frontendOrigin}${target}`;
        }
        return `/consent?uid=${interaction.uid}`;
      },
    },
    cookies: {
      keys: [createHash('sha256').update(`oidc-cookies:${opts.jwtSecret}`).digest('hex')],
      // Interaction/resume cookies must reach every consumer regardless of the
      // interaction destination path (/login on the SPA origin, /consent) and
      // the /oidc mount prefix-strip — site-wide path is the only setting that
      // survives both topologies. Scoped paths would drop the interaction
      // cookie on the consent contract endpoints (verified by the flow tests).
      short: { path: '/' },
      long: { path: '/' },
    },
  };

  const jwksConfig: JWKS | undefined = jwks ? { keys: jwks.keys as JWKS['keys'] } : undefined;
  const provider = new Provider(opts.issuer, jwksConfig ? { ...configuration, jwks: jwksConfig } : configuration);

  // B1/B2: callback() is a Koa factory — build the http handler ONCE.
  const oidcHandler = provider.callback();

  return { provider, oidcHandler };
}
