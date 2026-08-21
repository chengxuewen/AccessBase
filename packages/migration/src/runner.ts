import type { MigrationConfig, MigrationLifecycle } from './types.js';
import { MigrationManagerImpl } from './manager.js';

/**
 * Create and initialize a migration runner
 */
export async function createMigrationRunner(
  config: MigrationConfig,
  lifecycle?: MigrationLifecycle,
): Promise<MigrationManagerImpl> {
  const manager = new MigrationManagerImpl(config, lifecycle);
  await manager.ensureMigrationsTable();
  return manager;
}
