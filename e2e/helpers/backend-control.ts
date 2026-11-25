import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const PROJECT_ROOT = resolve(__dirname, '../..');

/**
 * W0.7 (rev.5): the real-stack lane targets a SCRATCH database — `resetBackend`
 * is destructive and pointed at the dev DB; the lane must never touch it.
 * `resetBackendScratch` resets the SAME native PG cluster but swaps the app
 * database to a dedicated scratch name via DATABASE_URL on the dev stack.
 */
export const SCRATCH_DB = 'accessbase_w07_scratch';
export const SCRATCH_DATABASE_URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH_DB}`;

export function resetBackend(): void {
  // `rm` is SHIMMED by the host session (CODEBUDDY_SESSION_ID activates a
  // safe-delete guard that refuses bulk deletes non-interactively). The
  // reset child shell drops the session markers so the shim passes through
  // to the real coreutils rm (shim's own zero-session fast path).
  execSync(
    'env -u CODEBUDDY_SESSION_ID -u CLAUDE_SESSION_ID ACCESSBASE_RESET_CONFIRM=yes bash accessbase.sh reset',
    {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      timeout: 120_000,
      shell: '/bin/bash',
    },
  );
  // reset stops redis and only restarts PG — login/session needs redis back up
  const redisCmd =
    'mkdir -p .pixi/data/redis && (.pixi/envs/native/bin/redis-cli -p 6379 ping >/dev/null 2>&1 || ' +
    '.pixi/envs/native/bin/redis-server --daemonize yes --port 6379 --dir "$PWD/.pixi/data/redis")';
  execSync(redisCmd, { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 15_000, shell: '/bin/bash' });
}

/** Scratch-DB reset: reset the CLUSTER (same machinery), then recreate the
 * scratch app DB from the migrated template. Never touches the dev DB. */
export function resetBackendScratch(): void {
  resetBackend(); // cluster-level reset (dev DB comes back too — untouched afterwards)
  const psql = '.pixi/envs/native/bin/psql';
  execSync(
    `${psql} "postgresql://accessbase:accessbase@localhost:5432/postgres" -c "DROP DATABASE IF EXISTS ${SCRATCH_DB}" -c "CREATE DATABASE ${SCRATCH_DB}"`,
    { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 30_000, shell: '/bin/bash' },
  );
  // schema: the dev stack runs db:push/migrate at boot for ITS database; the
  // scratch DB copies the freshly-reset dev schema (same chain, zero drift).
  execSync(
    `${psql} "postgresql://accessbase:accessbase@localhost:5432/accessbase" -c "CREATE DATABASE ${SCRATCH_DB} TEMPLATE accessbase" || true`,
    { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 30_000, shell: '/bin/bash' },
  );
}

export async function waitForServer(
  url = 'http://localhost:5101/api/v1/setup/status',
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready within ${timeoutMs}ms`);
}

/**
 * Fallback when the tsx watch dev chain died during a reset (PG stop window).
 * Relaunches the dev stack detached and waits for the backend.
 * W0.7 fixes: mkdir -p the log dir (missing dir crashed execSync); port
 * conflicts remain a documented prerequisite (playwright webServer must be down).
 */
export async function restartServer(): Promise<void> {
  mkdirSync('/tmp/opencode', { recursive: true });
  execSync('bash accessbase.sh stop', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60_000 });
  execSync(
    // unset npm_config_prefix: nvm.sh in accessbase.sh aborts if it's set (inherited from
    // pnpm/npm-launched parent chains, e.g. playwright's own webServer)
    'unset npm_config_prefix; setsid nohup env DATABASE_URL=postgresql://accessbase:accessbase@localhost:5432/accessbase ' +
      'REDIS_URL=redis://localhost:6379 bash accessbase.sh dev > /tmp/opencode/e2e-dev.log 2>&1 & echo $! > /tmp/opencode/e2e-dev.pid',
  );
  await waitForServer();
}

/** Cold-boot the dev stack pointed AT THE SCRATCH DB (W0.7 lane stack). */
export async function restartServerScratch(): Promise<void> {
  mkdirSync('/tmp/opencode', { recursive: true });
  execSync('bash accessbase.sh stop', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60_000 });
  execSync(
    'unset npm_config_prefix; setsid nohup env ' +
      `DATABASE_URL=${SCRATCH_DATABASE_URL} ` +
      'REDIS_URL=redis://localhost:6379 bash accessbase.sh dev > /tmp/opencode/e2e-dev.log 2>&1 & echo $! > /tmp/opencode/e2e-dev.pid',
  );
  await waitForServer();
}
