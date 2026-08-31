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
  lockoutMaxFailures: number;
  lockoutWindowSeconds: number;
}

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config: AppConfig = {
  port: Number(env('PORT', '5101')),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/accessbase'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-do-not-use-in-production'),
  jwtPrivateKeyPath: process.env['JWT_PRIVATE_KEY_PATH'] || '',
  jwtPublicKeyPath: process.env['JWT_PUBLIC_KEY_PATH'] || '',
  nodeEnv: env('NODE_ENV', 'development') as AppConfig['nodeEnv'],
  logLevel: (env('NODE_ENV', 'development') === 'production'
    ? 'info'
    : 'debug') as AppConfig['logLevel'],
  adminPassword: process.env['ADMIN_PASSWORD'] || '',
  staticDir: env('STATIC_DIR', 'out/admin-ui'),
  adminEmail: process.env['ADMIN_EMAIL'] || '',
  corsOrigins: process.env['CORS_ORIGINS'] || '',
  mfaEncryptionKey: process.env['MFA_ENCRYPTION_KEY'] || '',
  lockoutMaxFailures: Number(process.env['LOCKOUT_MAX_FAILURES'] || '5'),
  lockoutWindowSeconds: Number(process.env['LOCKOUT_WINDOW_SECONDS'] || '900'),
};
