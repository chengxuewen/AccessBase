import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Static-source locks for the L-T3 process defenses (precedent: route-guard.test
// startup side-effect containment). Runtime behavior of the restart loop is
// proven live-fire in L-T6; these asserts pin the four B1/B2/L-1 shell facts
// that the live-fire cannot cheaply distinguish from a plausible-but-wrong edit.

const indexSrc = readFileSync(resolve(__dirname, '../index.ts'), 'utf-8');
const startSrc = readFileSync(resolve(__dirname, '../../../../scripts/deploy/start.sh'), 'utf-8');
const stopSrc = readFileSync(resolve(__dirname, '../../../../scripts/deploy/stop.sh'), 'utf-8');

describe('index.ts process defenses (D4)', () => {
  it('registers uncaughtException handler with fatal log + deterministic exit', () => {
    expect(indexSrc).toMatch(
      /process\.on\('uncaughtException'[\s\S]*?app\.log\.fatal\(\{ err \}, 'uncaught exception'\)[\s\S]*?process\.exit\(1\)/,
    );
  });

  it('registers unhandledRejection handler with fatal log + deterministic exit', () => {
    expect(indexSrc).toMatch(
      /process\.on\('unhandledRejection'[\s\S]*?app\.log\.fatal\(\{ err \}, 'unhandled rejection'\)[\s\S]*?process\.exit\(1\)/,
    );
  });

  it('handlers are registered before listen()', () => {
    expect(indexSrc.indexOf("process.on('uncaughtException'")).toBeGreaterThan(-1);
    expect(indexSrc.indexOf("process.on('uncaughtException'")).toBeLessThan(
      indexSrc.indexOf('app.listen('),
    );
  });

  it('logs via app.log — no logger package import sneaks into the entrypoint', () => {
    expect(indexSrc).not.toMatch(/@accessbase\/logging/);
  });

  it('boot degrade sweep uses the single config nodeEnv prod flag', () => {
    expect(indexSrc).toMatch(
      /warnDegradedChecks\(process\.env, config\.nodeEnv === 'production'\)/,
    );
  });
});

describe('start.sh restart loop (B1/B2/L-1 pinned facts)', () => {
  it('fact 1 (B1): wait status captured via `|| code=$?` under global set -e', () => {
    expect(startSrc).toMatch(/^set -eo pipefail$/m);
    expect(startSrc).toMatch(/code=0;\s*\n?\s*wait "\$SERVER_PID" \|\| code=\$\?/);
  });

  it('fact 2 (B2): wrapper $$ written to .startpid early; cleanup sets stop flag and removes the file', () => {
    expect(startSrc).toMatch(/echo \$\$ > "\$\{DATA_DIR\}\/\.startpid"/);
    expect(startSrc).toMatch(/cleanup\(\)\s*\{[\s\S]{0,80}?DEPLOY_STOPPING=1/);
    expect(startSrc).toMatch(/rm -f "\$\{DATA_DIR\}\/\.startpid"/);
    // Human Ctrl-C path unchanged: trap shape identical.
    expect(startSrc).toMatch(/trap cleanup EXIT INT TERM/);
    // .startpid write must precede the server launch (stop.sh needs it anytime).
    expect(startSrc.indexOf('.startpid')).toBeLessThan(
      startSrc.indexOf('node "${OUT_DIR}/server/index.js"'),
    );
  });

  it('fact 2 (B2): loop consults DEPLOY_STOPPING after wait and breaks', () => {
    expect(startSrc).toMatch(/\[ "\$DEPLOY_STOPPING" = "1" \][\s\S]{0,40}?break/);
  });

  it('fact 3: every loop iteration rewrites the live server PID into PIDFILE', () => {
    expect(startSrc).toMatch(
      /while \[ "\$DEPLOY_STOPPING" != "1" \][\s\S]*?node "\$\{OUT_DIR\}\/server\/index\.js" &[\s\S]*?echo "\$SERVER_PID" > "\$PIDFILE"[\s\S]*?\ndone/,
    );
  });

  it('fact 4 (L-1): 3 exits within 15s aborts the loop with a crash-loop error', () => {
    expect(startSrc).toMatch(/RESET_TIMES=\(\)/);
    expect(startSrc).toMatch(/RESET_TIMES\+=\("\$SECONDS"\)/);
    expect(startSrc).toMatch(/-ge 15/);
    expect(startSrc).toMatch(/"\$\{#RESET_TIMES\[@\]\}" -ge 3/);
    expect(startSrc).toMatch(/log_error "crash loop — aborting"/);
    expect(startSrc).toMatch(/sleep 3/);
  });

  it('LOW-1: NODE_ENV defaults BEFORE the production pre-flight JWT/ADMIN block', () => {
    const idx = startSrc.indexOf('export NODE_ENV=');
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(startSrc.indexOf('JWT_SECRET must be set in production'));
  });

  it('Task-1 migrate gate intact and sequenced before the loop', () => {
    expect(startSrc).toMatch(
      /bash "\$\{PROJECT_ROOT\}\/scripts\/migrate\.sh" "\$\{PROJECT_ROOT\}\/packages\/migration\/drizzle" \|\| \{ log_error "Migrations failed — aborting"; exit 1; \}/,
    );
    expect(startSrc.indexOf('migrate.sh')).toBeLessThan(
      startSrc.indexOf('while [ "$DEPLOY_STOPPING"'),
    );
  });
});

describe('stop.sh wrapper-first (B2)', () => {
  it('consults .startpid and TERMs the wrapper BEFORE the existing PIDFILE/PG/Redis flow', () => {
    expect(stopSrc).toMatch(/STARTPID="\$\{DATA_DIR\}\/\.startpid"/);
    const wrapperKill = stopSrc.search(/kill -15 "\$WRAPPER_PID"/);
    const pidfileKill = stopSrc.search(/if \[ -f "\$PIDFILE" \]/);
    expect(wrapperKill).toBeGreaterThan(-1);
    expect(pidfileKill).toBeGreaterThan(-1);
    expect(wrapperKill).toBeLessThan(pidfileKill);
    expect(stopSrc).toMatch(/rm -f "\$STARTPID"/);
  });
});
