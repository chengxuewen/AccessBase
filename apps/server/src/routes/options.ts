/**
 * Runtime options CRUD routes (/api/v1/options).
 *
 * Audit redaction decision (review M6): PUT bodies can carry secrets, and the
 * global audit onResponse hook records non-GET bodies — so '/api/v1/options'
 * is excluded from auditing in app.ts (same mechanism as '/api/v1/setup')
 * instead of sanitizing request bodies.
 *
 * SENSITIVE_KEY_PATTERN is the single source of truth for server-side GET
 * masking and PUT mask-rejection; the UI mirrors it for display only.
 */
import type { FastifyInstance } from 'fastify';
import { OptionsManager } from '@accessbase/identity';
import { config } from '../config.js';
import { requirePermission } from '../utils/permission.js';

/** Keys matching this pattern are masked in GET and reject '******' on PUT. */
export const SENSITIVE_KEY_PATTERN = /secret|password|token|key/i;

const KEY_FORMAT = /^[a-z][a-zA-Z0-9_.]{1,63}$/;
const MASK = '******';

// Same lazy-singleton + test seam pattern as stats.ts (review M9).
let optionsManager: OptionsManager | undefined;

/** Test seam: inject a mocked OptionsManager (avoids touching PG in unit tests). */
export function setOptionsManager(mock: OptionsManager): void {
  optionsManager = mock;
}

/** Test seam: drop the injected instance so a fresh lazy singleton can be built. */
export function resetOptionsManager(): void {
  optionsManager = undefined;
}

export function getOptionsManager(): OptionsManager {
  optionsManager ??= new OptionsManager(config.databaseUrl);
  return optionsManager;
}

export async function optionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  app.get(
    '/options',
    {
      schema: {
        description: 'List runtime options (sensitive keys masked)',
        security: [{ bearerAuth: [] }],
      },
    },
    async () => {
      const entries = await getOptionsManager().listAll();
      return {
        success: true as const,
        data: entries.map((e) => ({
          key: e.key,
          value: SENSITIVE_KEY_PATTERN.test(e.key) ? MASK : e.value,
          updatedAt: e.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.put(
    '/options',
    {
      schema: {
        description: 'Set a runtime option',
        tags: ['options'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key, value } = (request.body ?? {}) as { key?: unknown; value?: unknown };
      if (typeof key !== 'string' || !KEY_FORMAT.test(key)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'OPT_001',
            message: 'Invalid key format (expected /^[a-z][a-zA-Z0-9_.]{1,63}$/)',
          },
        });
      }
      try {
        JSON.stringify(value ?? null);
      } catch {
        return reply.status(400).send({
          success: false,
          error: { code: 'OPT_002', message: 'Value must be JSON-serializable' },
        });
      }
      if (SENSITIVE_KEY_PATTERN.test(key) && value === MASK) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'OPT_003',
            message: 'Refusing to write the masked placeholder back into storage',
          },
        });
      }
      await getOptionsManager().set(key, value);
      return { success: true as const, data: { key, value } };
    },
  );

  app.delete<{ Params: { key: string } }>(
    '/options/:key',
    {
      schema: {
        description: 'Delete a runtime option',
        tags: ['options'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['key'],
          properties: { key: { type: 'string' } },
        },
      },
    },
    async (_request, reply) => {
      await getOptionsManager().delete(_request.params.key);
      return reply.status(204).send();
    },
  );
}
