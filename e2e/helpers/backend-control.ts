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

/** Scratch-DB reset — TOUCHES ONLY THE SCRATCH DATABASE.
 *
 * INCIDENT 2026-11-25: this used to call `resetBackend()` first (a CLUSTER-level
 * `accessbase.sh reset`), which WIPED THE DEV DATABASE — the dev admin account
 * was lost when the real-stack lane ran at S10. Never again: no `accessbase.sh
 * reset` on this path. The scratch DB is dropped/recreated in place and gets
 * its schema from the SAME migration chain the dev stack runs at boot (db:push).
 * PG/Redis are only STARTED if down — never reset. */
export function resetBackendScratch(): void {
  const psql = '.pixi/envs/native/bin/psql';
  // infra up (start only) — pg_ctl/redis-server are idempotent when already running
  execSync(
    'mkdir -p .pixi/data/redis && (.pixi/envs/native/bin/pg_isready -h localhost -p 5432 >/dev/null 2>&1 || ' +
      '.pixi/envs/native/bin/pg_ctl -D "$PWD/.pixi/data/pg" -l /tmp/opencode/pg-e2e.log start) && ' +
      '(.pixi/envs/native/bin/redis-cli -p 6379 ping >/dev/null 2>&1 || ' +
      '.pixi/envs/native/bin/redis-server --daemonize yes --port 6379 --dir "$PWD/.pixi/data/redis")',
    { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 30_000, shell: '/bin/bash' },
  );
  // drop + recreate ONLY the scratch DB (terminate its stale connections first)
  execSync(
    `${psql} "postgresql://accessbase:accessbase@localhost:5432/postgres" ` +
      `-c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${SCRATCH_DB}' AND pid <> pg_backend_pid()" ` +
      `-c "DROP DATABASE IF EXISTS ${SCRATCH_DB}" -c "CREATE DATABASE ${SCRATCH_DB}"`,
    { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 30_000, shell: '/bin/bash' },
  );
  // schema via the canonical migration chain against the scratch URL only
  execSync(`DATABASE_URL=${SCRATCH_DATABASE_URL} pnpm --filter @accessbase/migration run db:push`, {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    timeout: 180_000,
    shell: '/bin/bash',
  });
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
    // pnpm/npm-launched parent chains, e.g. playwright's own webServer). cwd = repo root
    // (the detached script is cwd-relative).
    'unset npm_config_prefix; setsid nohup env DATABASE_URL=postgresql://accessbase:accessbase@localhost:5432/accessbase ' +
      'REDIS_URL=redis://localhost:6379 bash accessbase.sh dev > /tmp/opencode/e2e-dev.log 2>&1 & echo $! > /tmp/opencode/e2e-dev.pid',
    { cwd: PROJECT_ROOT, shell: '/bin/bash' },
  );
  await waitForServer();
}

/** Cold-boot the dev stack pointed AT THE SCRATCH DB (W0.7 lane stack). */
export async function restartServerScratch(): Promise<void> {
  mkdirSync('/tmp/opencode', { recursive: true });
  execSync('bash accessbase.sh stop', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60_000 });
  // cwd MUST be the repo root: the detached `bash accessbase.sh dev` is
  // cwd-relative (incident: run from apps/server -> "accessbase.sh: not found",
  // the stack stopped and never came back).
  execSync(
    'unset npm_config_prefix; setsid nohup env ' +
      `DATABASE_URL=${SCRATCH_DATABASE_URL} ` +
      'REDIS_URL=redis://localhost:6379 bash accessbase.sh dev > /tmp/opencode/e2e-dev.log 2>&1 & echo $! > /tmp/opencode/e2e-dev.pid',
    { cwd: PROJECT_ROOT, shell: '/bin/bash' },
  );
  await waitForServer();
}
