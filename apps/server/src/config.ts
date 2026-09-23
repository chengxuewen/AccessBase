export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtPrivateKeyPath: string;
  jwtPublicKeyPath: string;
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  adminPassword: string;
  staticDir: string;
  adminEmail: string;
  corsOrigins: string;
  mfaEncryptionKey: string;
  /** L-M D2: optional Bearer token guarding GET /metrics (empty = open scrape; prod-without-token gets a boot WARN). */
  metricsToken: string;
  lockoutMaxFailures: number;
  lockoutWindowSeconds: number;
  oauth: {
    github: { clientId: string; clientSecret: string
};
    google: { clientId: string; clientSecret: string };
  };
  webauthn: {
    rpName: string;
    rpId: string;
    origin: string;
  };
  oauthRedirectBase: string;
  frontendOrigin: string;
  /** Trust x-forwarded-host for magic-link origin derivation (H′3). */
  trustProxy: boolean;
}

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function requireJwtSecret(env: NodeJS.ProcessEnv): string {
  if (env['NODE_ENV'] === 'production' && !env['JWT_SECRET']) {
    throw new Error('JWT_SECRET must be set in production. Generate: openssl rand -hex 32');
  }
  return env['JWT_SECRET'] ?? 'dev-secret-do-not-use-in-production';
}

function requireCorsOrigins(env: NodeJS.ProcessEnv): string {
  if (env['NODE_ENV'] === 'production' && !env['CORS_ORIGINS']) {
    throw new Error('CORS_ORIGINS must be set in production. Provide a comma-separated allowlist, e.g. https://admin.example.com');
  }
  return env['CORS_ORIGINS'] ?? '';
}

export const config: AppConfig = {
  port: Number(env('PORT', '5101')),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/accessbase'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: requireJwtSecret(process.env),
  jwtPrivateKeyPath: process.env['JWT_PRIVATE_KEY_PATH'] || '',
  jwtPublicKeyPath: process.env['JWT_PUBLIC_KEY_PATH'] || '',
  nodeEnv: env('NODE_ENV', 'development') as AppConfig['nodeEnv'],
  logLevel: (env('NODE_ENV', 'development') === 'production'
    ? 'info'
    : 'debug') as AppConfig['logLevel'],
  adminPassword: process.env['ADMIN_PASSWORD'] || '',
  staticDir: env('STATIC_DIR', 'out/admin-ui'),
  adminEmail: process.env['ADMIN_EMAIL'] || '',
  corsOrigins: requireCorsOrigins(process.env),
  mfaEncryptionKey: process.env['MFA_ENCRYPTION_KEY'] || '',
  metricsToken: process.env['METRICS_TOKEN'] || '',
  lockoutMaxFailures: Number(process.env['LOCKOUT_MAX_FAILURES'] || '5'),
  lockoutWindowSeconds: Number(process.env['LOCKOUT_WINDOW_SECONDS'] || '900'),
  oauth: {
    github: {
      clientId: process.env['GITHUB_CLIENT_ID'] || '',
      clientSecret: process.env['GITHUB_CLIENT_SECRET'] || '',
    },
    google: {
      clientId: process.env['GOOGLE_CLIENT_ID'] || '',
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'] || '',
    },
  },
  webauthn: {
    rpName: process.env['WEBAUTHN_RP_NAME'] || 'AccessBase',
    rpId: process.env['WEBAUTHN_RP_ID'] || 'localhost',
    origin: process.env['WEBAUTHN_ORIGIN'] || 'http://localhost:5173',
  },
  oauthRedirectBase: process.env['OAUTH_REDIRECT_BASE'] || 'http://localhost:5101',
  frontendOrigin: process.env['FRONTEND_ORIGIN'] || 'http://localhost:5173',
  // Trust x-forwarded-host when deriving the magic-link origin (H′3). Only set
  // true when running behind a TLS-terminating proxy you control; production
  // MUST set SITE_URL regardless (magic-link Host poisoning mitigation).
  trustProxy: process.env['TRUST_PROXY'] === 'true',
};

/**
 * L-T4 (spec D5): boot degrade-warning checklist. PURE — no logger import, no
 * side effects, never throws, reads only the passed-in `env` (never ambient
 * process.env). Env-only judgements: options-table config is warmed after
 * `listen()` and is invisible at boot, so every "feature off" line carries the
 * options-configured qualifier. Warn-only by design — fail-fast for optional
 * features is rejected per K-T4 R3; the JWT/CORS prod fail-fast above stays.
 */
export function warnDegradedChecks(env: NodeJS.ProcessEnv, isProd: boolean): string[] {
  const lines: string[] = [];

  // W1-6 (N1): an unset NODE_ENV silently defaults to development, disarming
  // every production pre-flight gate; explicit development is respected.
  if (!env['NODE_ENV']) {
    lines.push(
      'NODE_ENV unset — defaulting to development: production pre-flight gates off (JWT/CORS/ADMIN), dev fallback secrets possible (set NODE_ENV=production for real deployments)',
    );
  }

  if (!env['MFA_ENCRYPTION_KEY']) {
    lines.push('MFA_ENCRYPTION_KEY not set — MFA enrollment unavailable (env-only; no options-table fallback)');
  }

  if (!env['SMTP_HOST']) {
    lines.push('SMTP_HOST not set — outbound email disabled unless options-configured');
  }

  const hasEnvOAuth = Boolean(
    env['OAUTH_PROVIDERS'] || env['GITHUB_CLIENT_ID'] || env['GOOGLE_CLIENT_ID'],
  );
  const hasEnvSaml = env['SAML_ENABLED'] === 'true';
  if (!hasEnvOAuth && !hasEnvSaml) {
    lines.push(
      'No env-level OAuth/SAML provider config (options-table config not visible at boot)',
    );
  }

  if (isProd && (!env['WEBAUTHN_ORIGIN'] || env['WEBAUTHN_ORIGIN'].includes('localhost'))) {
    lines.push(
      'WEBAUTHN_ORIGIN unset or localhost in production — passkey login will fail for real origins',
    );
  }

  if (isProd && !env['METRICS_TOKEN']) {
    lines.push(
      'METRICS_TOKEN not set in production — /metrics exposes process + route-pattern metrics unauthenticated (intranet-only placement or set a token)',
    );
  }

  if (isProd && !env['SITE_URL']) {
    lines.push(
      'SITE_URL not set in production — magic-link origin falls back to request host (Host-poisoning risk)',
    );
  }

  return lines;
}
