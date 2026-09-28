/**
 * routes/auth split (batch R2, DG-5 pure move): passwordless lane — magic
 * link request/consume, SMS OTP request/verify, captcha pair, sms status
 * probe (F2 + Batch I + Q1 + Q3E blocks, monolith order preserved).
 */
import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { Mailer, SmsProviderImpl } from '@accessbase/identity';
import type { SmsProvider } from '@accessbase/identity';
import { getUserManager } from '../../utils/managers.js';
import {
  captchaFeatureOn,
  checkCaptcha,
  newCaptcha,
  storeCaptchaAnswer,
} from '../../utils/captcha.js';
import { config } from '../../config.js';
import { getOptionsManager } from '../options.js';
import { renderEmailFor } from '../../utils/email-templates.js';
import { DEFAULT_TENANT } from '../../utils/constants.js';
import { logger } from '@accessbase/logging';
import type { AuthContext } from './context.js';
import {
  getHostFallbackWarned,
  readSmsConfig,
  setHostFallbackWarned,
} from './shared.js';

export async function magicRequestRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/magic/request — passwordless sign-in link (F2).
  // Enumeration-safe: identical 202 body whether or not the account exists.
  // R7: per-IP rate limit only (no email+IP keyGenerator — no in-repo precedent).
  app.post<{ Body: { email: string } }>(
    '/magic/request',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        description: 'Request a magic sign-in link. Always succeeds regardless of account existence.',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body;

      if (await ctx.cidrGate(request, reply)) return;
      const captchaErr = await checkCaptcha(request.body as unknown as Record<string, unknown>);
      if (captchaErr !== null) {
        return reply.status(400).send({
          success: false,
          error: { code: captchaErr, message: 'Complete the captcha challenge first' },
        });
      }
      const options = getOptionsManager();
      const userManager = await getUserManager();
      const user = await userManager.findByEmail(email);
      if (user && user.status === 'active') {
        const token = await ctx.flowTokens.issue('magic_login', { userId: user.id, email: user.email }, 900);
        // R8: identical SMTP keys to forgot-password — no second config source.
        const host = await options.get('smtp_host', process.env['SMTP_HOST'], '');
        const port = Number(await options.get('smtp_port', process.env['SMTP_PORT'] ? Number(process.env['SMTP_PORT']) : undefined, 587));
        const smtpUser = await options.get('smtp_user', process.env['SMTP_USER'], '');
        const pass = await options.get('smtp_password', process.env['SMTP_PASSWORD'], '');
        const from = await options.get('smtp_from', process.env['SMTP_FROM'], '');
        const mailer = host ? Mailer.fromConfig({ host, port, user: smtpUser, pass, from }) : null;
        if (mailer) {
          // H′3 origin chain: options site.url → env SITE_URL → request origin.
          // Raw Host arm is attacker-controllable → loud one-time warn on fallthrough
          // (production MUST set SITE_URL); x-forwarded-host only wins with TRUST_PROXY.
          const siteUrl = await options.get('site.url', process.env['SITE_URL'], '');
          let origin: string;
          if (siteUrl) {
            origin = siteUrl;
          } else {
            // x-forwarded-host only wins when TRUST_PROXY is set (H′3).
            const forwardedHost = config.trustProxy
              ? (request.headers['x-forwarded-host'] as string | undefined)
              : undefined;
            const proto = request.headers['x-forwarded-proto'] ?? request.protocol;
            if (forwardedHost) {
              origin = `${proto}://${forwardedHost}`;
            } else {
              origin = `${proto}://${request.headers.host ?? ''}`;
              if (!getHostFallbackWarned()) {
                setHostFallbackWarned(true);
                logger.warn(
                  'magic-link origin falling back to request Host — production MUST set SITE_URL (poisoning risk)',
                );
              }
            }
          }
          const link = `${origin}/login/magic?token=${token}`;
          // Async: response returns immediately — SMTP RTT is an enumeration timing side-channel (batch F review)
          const rendered = await renderEmailFor('magic', { link, name: user.name }, options);
          mailer.send(email, rendered.subject, rendered.html).catch((err: unknown) => {
            logger.warn({ err }, 'Magic link delivery failed (degraded to log)');
          });
        } else {
          // Never log the token — it grants a full session.
          logger.warn('magic link: SMTP not configured, link not sent');
        }
      }
      return reply.status(202).send({
        success: true,
        data: { message: 'If an account exists, a sign-in link has been sent.' },
      });
    },
  );
}


export async function magicConsumeRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/magic/consume — exchange a magic link token for a session.
  // R13 failure order: bad token → deleted user → email mismatch all return the
  // same generic 401 (token is already burned by consume); suspended is 403.
  app.post<{ Body: { token: string } }>(
    '/magic/consume',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        description: 'Consume a magic sign-in link token (or receive an MFA step-up).',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 1 } },
        },
        response: {
          // R2 lesson: declare the FULL union or fast-json-stringify strips fields.
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  // mfa step-up arm
                  mfaRequired: { type: 'boolean' },
                  enroll: { type: 'boolean' },
                  flowToken: { type: 'string' },
                  // token-pair arm
                  accessToken: { type: 'string' },
                  refreshToken: { type: 'string' },
                  expiresIn: { type: 'number' },
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      email: { type: 'string' },
                      name: { type: 'string' },
                      // R2: declare item fields or fast-json-stringify strips them.
                      roles: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          403: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const payload = await ctx.flowTokens.consume<{ userId: string; email: string }>(
        request.body.token,
        'magic_login',
      );
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MAGIC_001', message: 'Invalid or expired sign-in link' },
        });
      }
      const userManager = await getUserManager();
      const user = await userManager.findById(payload.userId, request.tenantId ?? DEFAULT_TENANT);
      if (!user || user.email !== payload.email) {
        // Token already burned above — same generic 401 (R13).
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_MAGIC_001', message: 'Invalid or expired sign-in link' },
        });
      }
      if (user.status !== 'active') {
        request.log.warn({ userId: user.id }, 'Magic link consume rejected: account suspended');
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_004', message: 'Account suspended' },
        });
      }
      // R1-T10: magic-link delivery proves mailbox possession → mark verified
      // (exempt channel; the mark also carries the user through the gated
      // /mfa/verify arm when TOTP is bound).
      if (user.emailVerified !== true) await userManager.markEmailVerified(user.id);
      // MFA step-up: six-way uniform {userId}/300s/mfa_verify.
      if (user.totpEnabled) {
        const flowToken = await ctx.flowTokens.issue('mfa_verify', { userId: user.id }, 300);
        return {
          success: true,
          data: { mfaRequired: true, flowToken },
        };
      }
      const { accessToken, refreshToken } = await ctx.issueTokenPair(request, user);
      request.log.info({ userId: user.id }, 'Magic link sign-in successful');
      return {
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn: 900,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles: await ctx.rolesOf(user.id),
          },
        },
      };
    },
  );
}


export async function smsOtpRequestRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/sms-otp/request — passwordless OTP delivery (Batch I).
  // Enumeration-safe: identical 202 body regardless of account/config state.
  // R2: no lockout anywhere in the SMS flow (burn-first FlowToken + rate limit
  // carry brute-force protection; phone lockout would be a cross-user DoS).
  app.post<{ Body: { phone: string } }>(
    '/sms-otp/request',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        description: 'Request an SMS OTP sign-in code. Always succeeds regardless of account existence.',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['phone'],
          // R6: double-escaped in TS source (backslash-plus in the regex).
          properties: { phone: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' } },
        },
        // Q1-b1: declare the 202 shape incl. token (R2 batch-E lesson —
        // fast-json-stringify strips undeclared fields once a schema exists).
        response: {
          202: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  token: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { phone } = request.body;

      if (await ctx.cidrGate(request, reply)) return;
      const captchaErr = await checkCaptcha(request.body as unknown as Record<string, unknown>);
      if (captchaErr !== null) {
        return reply.status(400).send({
          success: false,
          error: { code: captchaErr, message: 'Complete the captcha challenge first' },
        });
      }
      const options = getOptionsManager();
      const smsConfig = await readSmsConfig(options);
      const smsProvider: SmsProvider | null = smsConfig ? SmsProviderImpl.fromConfig(smsConfig) : null;
      // Q1-b1 wire-chain fix: ALL arms issue a token and return it (the client
      // needs it at verify time). Non-eligible arms carry userId:null (dummy;
      // verify burns them to a generic 401 before any lookup). Constant-shape
      // 202 = the same enumeration immunity as before, now with a usable token.
      const code = randomInt(100000, 1000000).toString();
      let userId: string | null = null;
      if (!smsProvider) {
        logger.warn('sms-otp request: SMS provider not configured, code not sent');
      } else {
        const userManager = await getUserManager();
        const user = await userManager.findByPhone(phone);
        if (user && user.status === 'active') {
          userId = user.id;
          // Async: response returns immediately — gateway RTT is an enumeration timing side-channel (magic-link precedent)
          smsProvider.send({ to: phone, code }).catch((err: unknown) => {
            logger.warn({ err }, 'SMS delivery failed (degraded to log)');
          });
        }
      }
      const token = await ctx.flowTokens.issue('sms_otp', { userId, phone, code }, 300);
      return reply.status(202).send({
        success: true,
        data: { message: 'If an account exists, a verification code has been sent.', token },
      });
    },
  );
}


export async function captchaRoutes(app: FastifyInstance, _ctx: AuthContext) {
  // GET /api/v1/auth/captcha/status + /captcha — Q3E-E1 local challenge.
  app.get(
    '/captcha/status',
    { schema: { description: 'Whether the local captcha challenge is active', tags: ['auth'] } },
    async (_request, reply) => {
      const { on, redis } = await captchaFeatureOn();
      return reply.send({ success: true, data: { enabled: on && redis } });
    },
  );
  app.get(
    '/captcha',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { description: 'Fresh SVG captcha challenge (one-time, 5min)', tags: ['auth'] },
    },
    async (_request, reply) => {
      const { on, redis } = await captchaFeatureOn();
      if (!on || !redis) {
        return reply.status(503).send({
          success: false,
          error: { code: 'CAPTCHA_002', message: 'Captcha not available' },
        });
      }
      const { id, svg, answer } = newCaptcha();
      if (!(await storeCaptchaAnswer(id, answer))) {
        return reply.status(503).send({
          success: false,
          error: { code: 'CAPTCHA_002', message: 'Captcha not available' },
        });
      }
      return reply.send({ success: true, data: { id, svg } });
    },
  );

  // GET /api/v1/auth/sms/status — public enabled-gate probe for the login
  // surface (saml/status pattern; strict gate hides the SMS UI when unconfigured).
  app.get(
    '/sms/status',
    {
      schema: {
        description: 'Whether SMS OTP sign-in is configured (public gate probe).',
        tags: ['auth'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: { enabled: { type: 'boolean' } } },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const enabled = (await readSmsConfig(getOptionsManager())) !== null;
      return reply.send({ success: true, data: { enabled } });
    },
  );
}


export async function smsOtpVerifyRoutes(app: FastifyInstance, ctx: AuthContext) {
  // POST /api/v1/auth/sms-otp/verify — exchange an OTP for a session.
  // R3 exact mirror of magic consume with two corrections: findByIdAny (public
  // route has no tenant context — refresh-gate precedent) and phone-match
  // re-validation. R2: zero lockout — failures only 401/403, never 423.
  app.post<{ Body: { token: string; code: string } }>(
    '/sms-otp/verify',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        description: 'Verify an SMS OTP code (or receive an MFA step-up).',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['token', 'code'],
          properties: {
            token: { type: 'string', minLength: 1 },
            code: { type: 'string', pattern: '^\\d{6}$' },
          },
        },
        response: {
          // R2 batch-E lesson: declare the FULL union or fast-json-stringify strips fields.
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  // mfa step-up arm
                  mfaRequired: { type: 'boolean' },
                  enroll: { type: 'boolean' },
                  flowToken: { type: 'string' },
                  // token-pair arm
                  accessToken: { type: 'string' },
                  refreshToken: { type: 'string' },
                  expiresIn: { type: 'number' },
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      email: { type: 'string' },
                      name: { type: 'string' },
                      roles: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          403: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const payload = await ctx.flowTokens.consume<{ userId: string | null; phone: string; code: string }>(
        request.body.token,
        'sms_otp',
      );
      if (!payload) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_SMS_001', message: 'Invalid or expired verification code' },
        });
      }
      // Q1-b1/F5: dummy tokens (constant-shape arms) die here — burn happened
      // above, no DB lookup, byte-identical generic 401.
      if (!payload.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_SMS_001', message: 'Invalid or expired verification code' },
        });
      }
      const userManager = await getUserManager();
      const user = await userManager.findByIdAny(payload.userId);
      if (!user || user.phone !== payload.phone || payload.code !== request.body.code) {
        // Token already burned above — same generic 401 (magic R13 order).
        return reply.status(401).send({
          success: false,
          error: { code: 'AUTH_SMS_001', message: 'Invalid or expired verification code' },
        });
      }
      if (user.status !== 'active') {
        request.log.warn({ userId: user.id }, 'SMS OTP verify rejected: account suspended');
        return reply.status(403).send({
          success: false,
          error: { code: 'AUTH_004', message: 'Account suspended' },
        });
      }
      // R1-T10 (DG-8a ruling): OTP delivery proves possession → mark verified
      // (same exempt-channel semantics as the magic-link consume above).
      if (user.emailVerified !== true) await userManager.markEmailVerified(user.id);
      // MFA step-up: uniform {userId}/300s/mfa_verify (magic consume mirror).
      if (user.totpEnabled) {
        const flowToken = await ctx.flowTokens.issue('mfa_verify', { userId: user.id }, 300);
        return {
          success: true,
          data: { mfaRequired: true, flowToken },
        };
      }
      const { accessToken, refreshToken } = await ctx.issueTokenPair(request, user);
      request.log.info({ userId: user.id }, 'SMS OTP sign-in successful');
      return {
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn: 900,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles: await ctx.rolesOf(user.id),
          },
        },
      };
    },
  );
}
