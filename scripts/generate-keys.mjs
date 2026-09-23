#!/usr/bin/env node
// Generates RSA-2048 PEM pair into keys/ for JWT RS256 signing.
// Usage: node scripts/generate-keys.mjs [--force] [--out <dir>]
// --out exists for hermetic tests (P-fix W1-1); default stays ./keys.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outIdx = process.argv.indexOf('--out');
const keysDir = outIdx >= -1 && outIdx !== -1
  ? resolve(process.argv[outIdx + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'keys');
mkdirSync(keysDir, { recursive: true, mode: 0o700 });
// mkdir mode is only applied at creation; chmod makes the dir 0700 idempotently.
chmodSync(keysDir, 0o700);

const privatePath = resolve(keysDir, 'accessbase-private.pem');
const publicPath = resolve(keysDir, 'accessbase-public.pem');

if (!process.argv.includes('--force') && (existsSync(privatePath) || existsSync(publicPath))) {
  console.error('Keys already exist in keys/. Re-run with --force to overwrite.');
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// F2 (batch P): private key must be owner-readable only. writeFileSync mode
// applies at creation only, so chmod both paths explicitly for idempotent
// upgrade of keys generated before this fix.
writeFileSync(privatePath, privateKey, { mode: 0o600 });
chmodSync(privatePath, 0o600);
writeFileSync(publicPath, publicKey, { mode: 0o644 });
chmodSync(publicPath, 0o644);
console.log(`Keys generated in ${keysDir}`);
console.log(`
Next steps:
  export JWT_PRIVATE_KEY_PATH=${privatePath}
  export JWT_PUBLIC_KEY_PATH=${publicPath}
Then restart the server — JWT switches to RS256 automatically (HMAC fallback when unset).
`);
