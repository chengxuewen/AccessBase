/**
 * Batch P W1-1 (P-fix wave 1, report F2): the key generator must produce a
 * private key readable ONLY by its owner. Pre-fix the script wrote with no
 * mode option (umask 022 => world-readable 0644) and hardcoded the output
 * directory, so this RED test could not even run hermetically — it now drives
 * the real script via --out into a tmpdir and asserts the resulting modes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterAll } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'generate-keys.mjs');

describe('generate-keys.mjs key material permissions (F2)', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'ab-keys-'));

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes private key 0600, public key 0644, dir 0700 when run with --out', () => {
    execFileSync('node', [SCRIPT, '--out', outDir], { stdio: 'pipe' });

    const privateMode = statSync(path.join(outDir, 'accessbase-private.pem')).mode & 0o777;
    const publicMode = statSync(path.join(outDir, 'accessbase-public.pem')).mode & 0o777;
    const dirMode = statSync(outDir).mode & 0o777;

    expect(privateMode).toBe(0o600);
    // public key is not secret but must not be writable by group/other
    expect(publicMode & 0o022).toBe(0); // no group/other write; read-only is fine (not secret)
    expect(dirMode).toBe(0o700);
  });

  it('re-running upgrades a previously world-readable private key (idempotent chmod)', () => {
    // Same dir as the first run; the file now exists — Node's write mode
    // option only applies at creation, so the script must chmod explicitly.
    execFileSync('node', [SCRIPT, '--out', outDir, '--force'], { stdio: 'pipe' });
    const mode = statSync(path.join(outDir, 'accessbase-private.pem')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
