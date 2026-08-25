#!/usr/bin/env node
import { Command } from 'commander';
import { config as dotenvConfig } from 'dotenv';
import { createMigrationRunner } from './runner.js';
import type { MigrationConfig } from './types.js';

dotenvConfig();

const program = new Command();

function getConfig(): MigrationConfig {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  return {
    database: {
      url,
      ssl: process.env['DATABASE_SSL'] === 'true',
      maxConnections: parseInt(process.env['DATABASE_MAX_CONNECTIONS'] ?? '10', 10),
    },
    migrations: {
      directory: process.env['MIGRATIONS_DIR'] ?? './migrations',
      tableName: process.env['MIGRATIONS_TABLE'] ?? '_migrations',
      lockTimeout: parseInt(process.env['MIGRATION_LOCK_TIMEOUT'] ?? '30000', 10),
    },
    backup: {
      enabled: process.env['MIGRATION_BACKUP_ENABLED'] !== 'false',
      directory: process.env['MIGRATION_BACKUP_DIR'] ?? './backups',
      retentionDays: parseInt(process.env['MIGRATION_BACKUP_RETENTION_DAYS'] ?? '30', 10),
    },
    logging: {
      level: (process.env['MIGRATION_LOG_LEVEL'] as MigrationConfig['logging']['level']) ?? 'info',
      file: process.env['MIGRATION_LOG_FILE'],
    },
  };
}

program
  .name('accessbase-migrate')
  .description('AccessBase database migration tool')
  .version('0.1.0');

program
  .command('up')
  .description('Execute pending migrations')
  .option('--dry-run', 'Show migrations without executing')
  .action(async (opts) => {
    const config = getConfig();
    const runner = await createMigrationRunner(config);
    if (opts.dryRun) {
      const status = await runner.status();
      const pending = status.filter((s) => s.status === 'pending');
      console.log(`Would execute ${pending.length} migration(s):`);
      for (const m of pending) {
        console.log(`  - ${m.version}_${m.name} [${m.phase}]`);
      }
    } else {
      await runner.up();
      console.log('Migrations completed');
    }
    process.exit(0);
  });

program
  .command('down')
  .description('Rollback the last migration')
  .option('--to <version>', 'Rollback to specific version')
  .action(async (opts) => {
    const config = getConfig();
    const runner = await createMigrationRunner(config);
    if (opts.to) {
      await runner.downTo(opts.to);
    } else {
      await runner.down();
    }
    console.log('Rollback completed');
    process.exit(0);
  });

program
  .command('status')
  .description('Show migration status')
  .action(async () => {
    const config = getConfig();
    const runner = await createMigrationRunner(config);
    const status = await runner.status();
    console.table(
      status.map((s) => ({
        Version: s.version,
        Name: s.name,
        Phase: s.phase,
        Status: s.status,
        'Executed At': s.executedAt?.toISOString() ?? '-',
        'Duration (ms)': s.duration ?? '-',
      })),
    );
    process.exit(0);
  });

program
  .command('generate <name>')
  .description('Generate a new migration file')
  .option('--phase <phase>', 'Migration phase (preload|postsync|postload)', 'postsync')
  .action(async (name, opts) => {
    const config = getConfig();
    const runner = await createMigrationRunner(config);
    const filepath = await runner.generate(name, opts.phase);
    console.log(`Generated: ${filepath}`);
    process.exit(0);
  });

program
  .command('validate')
  .description('Validate migration files')
  .action(async () => {
    const config = getConfig();
    const runner = await createMigrationRunner(config);
    const result = await runner.validate();
    if (result.valid) {
      console.log('All migrations are valid');
    } else {
      console.error('Validation failed:');
      for (const e of result.errors) {
        console.error(`  ERROR: ${e.file} - ${e.message}`);
      }
    }
    for (const w of result.warnings) {
      console.warn(`  WARN: ${w.file} - ${w.message}`);
    }
    process.exit(result.valid ? 0 : 1);
  });

program.parse();
