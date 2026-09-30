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
import { validateEmailTemplate, validateEmailLocale } from '../utils/email-templates.js';

/** Keys matching this pattern are masked in GET and reject '******' on PUT. */
export const SENSITIVE_KEY_PATTERN = /secret|password|token|key/i;

const KEY_FORMAT = /^[a-z][a-zA-Z0-9_.-]{1,63}$/;

// W3-2 (report F13): upsert accepts ONLY keys the runtime actually reads —
// arbitrary-key writes were the finding (typo'd config, junk sprawl, phishing
// site.url). This set is the single source; adding an options.get('<key>')
// call site REQUIRES adding the key here (conventions Phase P' check).
const KNOWN_OPTION_KEYS = new Set([
  'site.name',
  'site.url',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_password',
  'smtp_from',
  'sms_provider',
  'sms_sign_name',
  'sms_template_code',
  'oauth_providers',
  'password_min_length',
  'password_require_upper',
  'password_require_lower',
  'password_require_digit',
  'password_require_special',
  // Q3E policy trio (spec 2026-09-23-q3e-policy-trio-design)
  'mfa_enforcement',
  'captcha_enabled',
  'auth_cidr_allow',
  'auth_cidr_deny',
  // Q4c-T4 email templates (spec §7): jsonb-object template overrides +
  // default recipient language. Q4c dispatcher kill-switch (app.ts snapshot
  // closure; 'true'/'false' strings tolerated either way).
  'webhooks_enabled',
  'email_tmpl_verify',
  'email_tmpl_reset',
  'email_tmpl_magic',
  'email_tmpl_invite',
  'email_locale_default',
  // R1-T10 (DG-8a): login gate — 'true'|'false', default false at the reader
  // (verifiedEmailRequired in routes/auth.ts); possession-proven channels are
  // exempt and additionally mark the flag on success.
  'auth.require_verified_email',
  // SL-2 session idle timeout seconds (spec 2026-09-29-session-lifetime):
  // 3-tier env SESSION_IDLE_TIMEOUT_SECONDS > this option > 86400; 0 = off.
  'session.idle_timeout_seconds',
]);
// Batch B dynamic provider secrets: oauth_<name>_client_secret (names are
// lowercase/hyphen by convention — KEY_FORMAT-legal dots/uppercase in a
// provider name would 400 here and the reader would miss it; documented).
const OAUTH_SECRET_KEY = /^oauth_[a-z0-9][a-z0-9_-]{0,40}_client_secret$/;

/** W3-2: site.url is consumed as an ORIGIN (magic-link/reset links). */
export function validateSiteUrl(value: unknown): string | null {
  if (typeof value !== 'string') return 'site.url must be a string';
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return 'site.url must be an absolute URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'site.url must use http(s)';
  if (u.username || u.password) return 'site.url must not embed credentials';
  if (u.pathname !== '' && u.pathname !== '/') return 'site.url must be an origin without path';
  if (u.search || u.hash) return 'site.url must be an origin without query or fragment';
  return null;
}

function isKnownOptionKey(key: string): boolean {
  return KNOWN_OPTION_KEYS.has(key) || OAUTH_SECRET_KEY.test(key);
}
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
            message: 'Invalid key format (expected /^[a-z][a-zA-Z0-9_.-]{1,63}$/)',
          },
        });
      }
      if (!isKnownOptionKey(key)) {
        // Generic message: the allowlist is not enumerable through errors.
        return reply.status(400).send({
          success: false,
          error: { code: 'OPT_001', message: 'Unknown option key' },
        });
      }
      if (key === 'site.url') {
        const urlErr = validateSiteUrl(value);
        if (urlErr) {
          return reply.status(400).send({
            success: false,
            error: { code: 'OPT_001', message: urlErr },
          });
        }
      }
      // Q4c-T4 R8 dual-write closure: the generic PUT path applies the SAME
      // validators the /email-templates routes use.
      if (key.startsWith('email_tmpl_')) {
        const tmplErr = validateEmailTemplate(value);
        if (tmplErr) {
          return reply.status(400).send({
            success: false,
            error: { code: 'OPT_001', message: tmplErr },
          });
        }
      }
      if (key === 'email_locale_default') {
        const localeErr = validateEmailLocale(value);
        if (localeErr) {
          return reply.status(400).send({
            success: false,
            error: { code: 'OPT_001', message: localeErr },
          });
        }
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
      // Return the full row: upsert wrote exactly this timestamp; handler-time
      // ISO string is sub-ms accurate.
      return { success: true as const, data: { key, value, updatedAt: new Date().toISOString() } };
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
