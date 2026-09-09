import { buildApp } from './app.js';
import { config } from './config.js';
import { initializeAdmin } from './init.js';
import { selfHealSeed } from './routes/permissions-seed.js';

async function main() {
  const app = await buildApp();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, closing server...');
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
    try {
      await initializeAdmin(app);
    } catch (initErr) {
      app.log.error(initErr, 'Admin initialization failed (server still running)');
    }
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
