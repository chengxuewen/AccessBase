import { buildApp } from './app.js';
import { setDraining } from './utils/drain.js';
import { config, warnDegradedChecks } from './config.js';
import { initializeAdmin } from './init.js';
import { selfHealSeed } from './routes/permissions-seed.js';
import { getOptionsManager } from './routes/options.js';

async function main() {
  const app = await buildApp();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server...');
    // Q2a(F): fail readiness FIRST so LB/proxies shed traffic for the
    // duration of the close chain (the k8s preStop window is the ops story).
    setDraining();
    try {
      await app.close();
      app.log.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Process defenses (D4): deterministic exit on an unhandled crash — the
  // container restart policy / deploy restart loop recovers the process,
  // the fault is logged either way. No logger import: entry logs via app.log.
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    app.log.fatal({ err }, 'unhandled rejection');
    process.exit(1);
  });

  // Boot degrade sweep (D5): warn once per silently-disabled optional feature,
  // no fail-fast (K-T4 R3). Env-only — options-table config is invisible here.
  for (const line of warnDegradedChecks(process.env, config.nodeEnv === 'production')) {
    app.log.warn(line);
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Server listening on ${config.host}:${config.port}`);

    // Initialize admin user on first run
    try {
      await initializeAdmin(app);
    } catch (initErr) {
      app.log.error(initErr, 'Admin initialization failed (server still running)');
    }

    // Best-effort: re-seed builtin permissions onto a pre-existing admin role
    // (covers env-bypass admins created above / pre-seeding deployments).
    // Entry-point only — buildApp must stay side-effect-free (no PG dial in tests).
    void selfHealSeed(config.databaseUrl);

    // Best-effort: warm the options cache and log the resolved site name.
    // Startup must not fail if the options table is unreachable.
    try {
      const siteName = await getOptionsManager().get('site.name', undefined, 'AccessBase');
      app.log.info({ siteName }, '[options] site.name resolved from option|default');
    } catch (err) {
      app.log.warn({ err }, 'Failed to resolve site.name at startup');
    }
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
