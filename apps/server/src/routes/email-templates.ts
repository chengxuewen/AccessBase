/**
 * Q4c-T4 email template admin routes (/api/v1/email-templates).
 *
 * Permission gates ride EXISTING codes via authorize.ts routePermissions
 * (controller-side mapping: GET → options:read; PUT/:id, POST /:id/preview,
 * POST /:id/test → options:write). requirePermission passes through until the
 * mapping lands — same progressive-enforcement semantics as every other route.
 *
 * Audit posture: unlike /api/v1/options (excluded in app.ts because PUT bodies
 * carry secrets), template bodies are not secrets — no exclusion needed here;
 * the global audit hook recording PUT bodies is accepted behavior.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { logger } from '@accessbase/logging';
import { requirePermission } from '../utils/permission.js';
import { getOptionsManager } from './options.js';
import { getSmtpMailer, resolvePublicOrigin } from './auth.js';
import {
  DEFAULTS,
  TEMPLATE_IDS,
  renderEmail,
  renderEmailFor,
  validateEmailTemplate,
  validateEmailLocale,
} from '../utils/email-templates.js';
import type { TemplateId, TemplateOverride, LocalizedArms } from '../utils/email-templates.js';

function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(value);
}

function asOverride(value: unknown): TemplateOverride | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TemplateOverride)
    : undefined;
}

function mergeArms(stored: LocalizedArms | undefined, fallback: { en: string; zh: string }): { en: string; zh: string } {
  return {
    en: typeof stored?.en === 'string' && stored.en ? stored.en : fallback.en,
    zh: typeof stored?.zh === 'string' && stored.zh ? stored.zh : fallback.zh,
  };
}

/** Sample substitution set for preview; /test swaps link for a real-origin URL. */
const SAMPLE_VARS: Record<TemplateId, Record<string, string>> = {
  verify: { link: 'https://example.com/verify-email?token=sample-token', name: 'Alex Example' },
  reset: { link: 'https://example.com/reset-password?token=sample-token', name: 'Alex Example' },
  magic: { link: 'https://example.com/login/magic?token=sample-token', name: 'Alex Example' },
  invite: {
    link: 'https://example.com/reset-password?token=sample-token',
    invitee: 'alex@example.com',
    inviter: 'An administrator',
  },
};

function badRequest(reply: FastifyReply, message: string) {
  return reply
    .status(400)
    .send({ success: false, error: { code: 'TEMPLATE_INVALID', message } });
}

export async function emailTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePermission());

  app.get(
    '/email-templates',
    {
      schema: {
        description: 'List email templates (built-in defaults merged with stored overrides)',
        tags: ['email-templates'],
        security: [{ bearerAuth: [] }],
      },
    },
    async () => {
      const om = getOptionsManager();
      const data = [];
      for (const id of TEMPLATE_IDS) {
        const override = asOverride(await om.get<unknown>(`email_tmpl_${id}`, undefined, undefined));
        data.push({
          id,
          subject: mergeArms(override?.subject, DEFAULTS[id].subject),
          html: mergeArms(override?.html, DEFAULTS[id].html),
          overridden: override !== undefined,
        });
      }
      return { success: true as const, data };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/email-templates/:id',
    {
      schema: {
        description: 'Store a template override (partial arms allowed; null-value clears)',
        tags: ['email-templates'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!isTemplateId(id)) {
        return badRequest(reply, `Unknown template id '${id}' (expected ${TEMPLATE_IDS.join('|')})`);
      }
      const value = request.body;
      if (value === null || value === undefined || value === '') {
        // Clearing the override restores built-in defaults for this lane.
        await getOptionsManager().delete(`email_tmpl_${id}`);
        return { success: true as const, data: { id, cleared: true } };
      }
      const err = validateEmailTemplate(value);
      if (err) return badRequest(reply, err);
      await getOptionsManager().set(`email_tmpl_${id}`, value);
      return {
        success: true as const,
        data: { id, value, updatedAt: new Date().toISOString() },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/email-templates/:id/preview',
    {
      schema: {
        description: 'Render a preview (stored + request-body overrides, sample vars; never sends)',
        tags: ['email-templates'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!isTemplateId(id)) {
        return badRequest(reply, `Unknown template id '${id}' (expected ${TEMPLATE_IDS.join('|')})`);
      }
      const body = (request.body ?? {}) as {
        locale?: string;
        vars?: unknown;
        overrides?: unknown;
      };
      if (body.locale !== undefined && typeof body.locale !== 'string') {
        return badRequest(reply, 'locale must be a string');
      }
      if (body.locale !== undefined && validateEmailLocale(body.locale)) {
        return badRequest(reply, 'locale must be "en" or "zh"');
      }
      const vars: Record<string, string> = { ...SAMPLE_VARS[id] };
      if (body.vars !== undefined) {
        if (typeof body.vars !== 'object' || body.vars === null || Array.isArray(body.vars)) {
          return badRequest(reply, 'vars must be an object of string values');
        }
        for (const [k, v] of Object.entries(body.vars as Record<string, unknown>)) {
          if (typeof v === 'string') vars[k] = v;
        }
      }
      let draftOverride: TemplateOverride | undefined;
      if (body.overrides !== undefined) {
        const err = validateEmailTemplate(body.overrides);
        if (err) return badRequest(reply, err);
        draftOverride = body.overrides as TemplateOverride;
      }
      const om = getOptionsManager();
      const storedOverride = asOverride(await om.get<unknown>(`email_tmpl_${id}`, undefined, undefined));
      const merged: TemplateOverride = {
        subject: { ...storedOverride?.subject, ...draftOverride?.subject },
        html: { ...storedOverride?.html, ...draftOverride?.html },
      };
      const locale =
        body.locale ?? (await om.get<string>('email_locale_default', undefined, 'en'));
      const siteName = await om.get<string>('site.name', undefined, 'AccessBase');
      const rendered = renderEmail(id, vars, {
        locale,
        overrides: { [id]: merged },
        siteName: typeof siteName === 'string' && siteName ? siteName : 'AccessBase',
      });
      return { success: true as const, data: rendered };
    },
  );

  app.post<{ Params: { id: string }; Body: { to?: string } }>(
    '/email-templates/:id/test',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        description: 'Send the stored template to a test address (fire-and-forget)',
        tags: ['email-templates'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['to'],
          properties: { to: { type: 'string', format: 'email' } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!isTemplateId(id)) {
        return badRequest(reply, `Unknown template id '${id}' (expected ${TEMPLATE_IDS.join('|')})`);
      }
      const om = getOptionsManager();
      const mailer = await getSmtpMailer(om);
      if (!mailer) {
        return reply.status(502).send({
          success: false,
          error: { code: 'SMTP_UNAVAILABLE', message: 'SMTP is not configured' },
        });
      }
      // Sample substitution with a harmless TEST link on the public origin
      // (same three-arm chain as the real senders).
      const origin = await resolvePublicOrigin(request, om);
      const vars = {
        ...SAMPLE_VARS[id],
        link: `${origin}/login?email-template-test=${id}`,
      };
      const { subject, html } = await renderEmailFor(id, vars, om);
      mailer.send(String(request.body?.to), subject, html).catch((err: unknown) => {
        logger.warn({ err, templateId: id }, 'email template test send failed (fire-and-forget)');
      });
      return reply.status(202).send({ success: true as const, data: { sent: true } });
    },
  );
}
