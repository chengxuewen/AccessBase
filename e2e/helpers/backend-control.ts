import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(__dirname, '../..');

export function resetBackend(): void {
  execSync('ACCESSBASE_RESET_CONFIRM=yes bash accessbase.sh reset', {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    timeout: 120_000,
  });
  // reset stops redis and only restarts PG — login/session needs redis back up
  const redisCmd =
    'mkdir -p .pixi/data/redis && (.pixi/envs/native/bin/redis-cli -p 6379 ping >/dev/null 2>&1 || ' +
    '.pixi/envs/native/bin/redis-server --daemonize yes --port 6379 --dir "$PWD/.pixi/data/redis")';
  execSync(redisCmd, { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 15_000, shell: '/bin/bash' });
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
 */
export async function restartServer(): Promise<void> {
  execSync('bash accessbase.sh stop', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60_000 });
  execSync(
    // unset npm_config_prefix: nvm.sh in accessbase.sh aborts if it's set (inherited from
    // pnpm/npm-launched parent chains, e.g. playwright's own webServer)
    'unset npm_config_prefix; setsid nohup env DATABASE_URL=postgresql://accessbase:accessbase@localhost:5432/accessbase ' +
      'REDIS_URL=redis://localhost:6379 bash accessbase.sh dev > /tmp/opencode/e2e-dev.log 2>&1 & echo $! > /tmp/opencode/e2e-dev.pid',
  );
  await waitForServer();
}
