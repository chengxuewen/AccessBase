import type { MigrationManager, MigrationStatus, MigrationPhase, ValidationResult, MigrationConfig, MigrationLifecycle, MigrationFile } from './types.js';
import { createLogger } from '@accessbase/logging';
import { Pool } from 'pg';

/**
 * Migration manager implementation
 */
export class MigrationManagerImpl implements MigrationManager {
  private readonly pool: Pool;
  private readonly logger = createLogger({ level: 'info' });
  private readonly config: MigrationConfig;
  private readonly lifecycle?: MigrationLifecycle;

  constructor(config: MigrationConfig, lifecycle?: MigrationLifecycle) {
    this.config = config;
    this.lifecycle = lifecycle;
    this.pool = new Pool({
      connectionString: config.database.url,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      max: config.database.maxConnections ?? 10,
    });
  }

  /**
   * Execute all pending migrations
   */
  async up(): Promise<void> {
    const migrations = await this.loadMigrations();
    const executed = await this.getExecutedMigrations();

    for (const migration of migrations) {
      if (!executed.has(migration.version)) {
        await this.executeMigration(migration);
      }
    }
  }

  /**
   * Rollback the last migration
   */
  async down(): Promise<void> {
    const last = await this.getLastExecuted();
    if (!last) {
      this.logger.info('No migrations to rollback');
      return;
    }
    await this.rollbackMigration(last);
  }

  /**
   * Rollback to a specific version
   */
  async downTo(version: string): Promise<void> {
    const executed = await this.getExecutedVersions();

    for (const v of executed.reverse()) {
      if (v === version) break;
      const migration = await this.loadMigration(v);
      if (migration) {
        await this.rollbackMigration(migration);
      }
    }
  }

  /**
   * Get migration status
   */
  async status(): Promise<MigrationStatus[]> {
    const migrations = await this.loadMigrations();
    const executed = await this.getExecutedMigrations();

    return migrations.map((m) => ({
      version: m.version,
      name: m.name,
      phase: m.phase,
      status: executed.has(m.version) ? 'completed' : 'pending' as const,
      executedAt: executed.get(m.version)?.executedAt,
      duration: executed.get(m.version)?.duration,
    }));
  }

  /**
   * Generate a new migration file
   */
  async generate(name: string, phase: MigrationPhase = 'postsync'): Promise<string> {
    const version = await this.getNextVersion();
    const filename = `${version}_${name}.ts`;
    const content = this.generateTemplate(version, name, phase);
    // Write file to migrations directory
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const filepath = path.join(this.config.migrations.directory, filename);
    await fs.writeFile(filepath, content, 'utf-8');
    this.logger.info(`Generated migration: ${filename}`);
    return filepath;
  }

  /**
   * Validate migration files
   */
  async validate(): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];
    const migrations = await this.loadMigrations();

    // Check for duplicate versions
    const versions = new Set<string>();
    for (const m of migrations) {
      if (versions.has(m.version)) {
        errors.push({ file: `${m.version}_${m.name}`, message: `Duplicate version: ${m.version}` });
      }
      versions.add(m.version);
    }

    // Check for gaps in versions
    const sorted = [...versions].sort();
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseInt(sorted[i - 1]!, 10);
      const curr = parseInt(sorted[i]!, 10);
      if (curr - prev > 1) {
        warnings.push({ file: `version ${sorted[i]}`, message: `Gap in versions: ${sorted[i - 1]} -> ${sorted[i]}` });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(migration: MigrationFile): Promise<void> {
    const start = Date.now();
    this.logger.info(`Executing migration: ${migration.version}_${migration.name} [${migration.phase}]`);

    await this.lifecycle?.onBeforeMigrate?.(migration.version);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up({
        execute: async (sql) => { await client.query(sql); },
        query: async <T>(sql: string) => {
          const result = await client.query(sql);
          return result.rows as T[];
        },
      });
      await client.query(
        `INSERT INTO ${this.config.migrations.tableName} (version, name, phase, executed_at, duration)
         VALUES ($1, $2, $3, NOW(), $4)`,
        [migration.version, migration.name, migration.phase, Date.now() - start]
      );
      await client.query('COMMIT');

      const duration = Date.now() - start;
      this.logger.info(`Migration ${migration.version} completed in ${duration}ms`);
      await this.lifecycle?.onAfterMigrate?.(migration.version, duration);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error({ err: error }, `Migration ${migration.version} failed`);
      await this.lifecycle?.onMigrateError?.(migration.version, error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Rollback a single migration
   */
  private async rollbackMigration(migration: MigrationFile): Promise<void> {
    this.logger.info(`Rolling back migration: ${migration.version}_${migration.name}`);

    await this.lifecycle?.onBeforeRollback?.(migration.version);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await migration.down({
        execute: async (sql) => { await client.query(sql); },
        query: async <T>(sql: string) => {
          const result = await client.query(sql);
          return result.rows as T[];
        },
      });
      await client.query(
        `DELETE FROM ${this.config.migrations.tableName} WHERE version = $1`,
        [migration.version]
      );
      await client.query('COMMIT');

      this.logger.info(`Migration ${migration.version} rolled back`);
      await this.lifecycle?.onAfterRollback?.(migration.version);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error({ err: error }, `Rollback ${migration.version} failed`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Ensure migrations table exists
   */
  async ensureMigrationsTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.migrations.tableName} (
        version VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phase VARCHAR(50) NOT NULL DEFAULT 'postsync',
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration INTEGER
      )
    `);
  }

  /**
   * Load all migration files from directory
   */
  private async loadMigrations(): Promise<MigrationFile[]> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    try {
      const files = await fs.readdir(this.config.migrations.directory);
      const migrationFiles: MigrationFile[] = [];

      for (const file of files.filter((f) => f.endsWith('.ts')).sort()) {
        const filepath = path.join(this.config.migrations.directory, file);
        const mod = await import(filepath);
        const version = file.split('_')[0]!;
        const name = file.replace(/\.ts$/, '').split('_').slice(1).join('_');

        migrationFiles.push({
          version,
          name,
          phase: (mod.phase as MigrationPhase) ?? 'postsync',
          up: mod.up,
          down: mod.down,
        });
      }

      return migrationFiles;
    } catch {
      return [];
    }
  }

  /**
   * Load a specific migration by version
   */
  private async loadMigration(version: string): Promise<MigrationFile | null> {
    const migrations = await this.loadMigrations();
    return migrations.find((m) => m.version === version) ?? null;
  }

  /**
   * Get executed migration versions
   */
  private async getExecutedMigrations(): Promise<Map<string, { executedAt: Date; duration: number }>> {
    try {
      const result = await this.pool.query(
        `SELECT version, executed_at, duration FROM ${this.config.migrations.tableName} ORDER BY version`
      );
      const map = new Map<string, { executedAt: Date; duration: number }>();
      for (const row of result.rows) {
        map.set(row.version as string, {
          executedAt: new Date(row.executed_at as string),
          duration: row.duration as number,
        });
      }
      return map;
    } catch {
      return new Map();
    }
  }

  /**
   * Get executed versions sorted
   */
  private async getExecutedVersions(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT version FROM ${this.config.migrations.tableName} ORDER BY version`
    );
    return result.rows.map((r) => r.version as string);
  }

  /**
   * Get last executed migration
   */
  private async getLastExecuted(): Promise<MigrationFile | null> {
    const result = await this.pool.query(
      `SELECT version FROM ${this.config.migrations.tableName} ORDER BY version DESC LIMIT 1`
    );
    if (result.rows.length === 0) return null;
    return this.loadMigration(result.rows[0]!.version as string);
  }

  /**
   * Get next version number
   */
  private async getNextVersion(): Promise<string> {
    const migrations = await this.loadMigrations();
    if (migrations.length === 0) return '001';
    const last = migrations[migrations.length - 1]!;
    const num = parseInt(last.version, 10) + 1;
    return String(num).padStart(3, '0');
  }

  /**
   * Generate migration file template
   */
  private generateTemplate(version: string, name: string, phase: MigrationPhase): string {
    return `import type { MigrationPhase, Database } from '@accessbase/migration';

export const phase: MigrationPhase = '${phase}';

export async function up(db: Database): Promise<void> {
  // TODO: Implement migration
}

export async function down(db: Database): Promise<void> {
  // TODO: Implement rollback
}
`;
  }
}
