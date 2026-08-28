#!/usr/bin/env node
// Generates RSA-2048 PEM pair into keys/ for JWT RS256 signing.
// Usage: node scripts/generate-keys.mjs [--force]
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const keysDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'keys');
mkdirSync(keysDir, { recursive: true });

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

writeFileSync(privatePath, privateKey);
writeFileSync(publicPath, publicKey);
console.log(`Keys generated in ${keysDir}`);
console.log(`
Next steps:
  export JWT_PRIVATE_KEY_PATH=${privatePath}
  export JWT_PUBLIC_KEY_PATH=${publicPath}
Then restart the server — JWT switches to RS256 automatically (HMAC fallback when unset).
`);
