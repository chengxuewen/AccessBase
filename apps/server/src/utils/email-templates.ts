/**
 * Q4c-T4 email templates: bilingual transactional templates backed by the
 * options table + a minimal {{var}} renderer.
 *
 * Value shape pin (spec §7 / F19 batch-B trap): the stored option value is a
 * jsonb OBJECT `{subject:{en?,zh?},html:{en?,zh?}}` — never a JSON string.
 * The options table column is jsonb and drizzle hands back parsed objects
 * (locked by email-templates-roundtrip-integration.test.ts). A non-object
 * stored value is IGNORED (defaults win), so junk rows can never crash send.
 *
 * The `hours` placeholder is supported for admin-authored overrides but no
 * default arm uses it — expiry text is baked per-lane into the defaults
 * (today's literal footnotes); callers may pass it when a custom template
 * references it. Unknown placeholders stay literal + warn-once.
 */
import { logger } from '@accessbase/logging';
import type { OptionsManager } from '@accessbase/identity';

export type TemplateId = 'verify' | 'reset' | 'magic' | 'invite';

export const TEMPLATE_IDS: readonly TemplateId[] = ['verify', 'reset', 'magic', 'invite'];

export interface LocalizedArms {
  en?: string;
  zh?: string;
}

/** A stored/edited template override — every arm optional, merged over DEFAULTS. */
export interface TemplateOverride {
  subject?: LocalizedArms;
  html?: LocalizedArms;
}

/** Full built-in arms for one lane. */
export interface DefaultTemplate {
  subject: { en: string; zh: string };
  html: { en: string; zh: string };
}

export const EMAIL_LOCALES = ['en', 'zh'] as const;
export const FALLBACK_LOCALE = 'en';
const SITE_NAME_FALLBACK = 'AccessBase';

/** Minimal inline-style transactional shell: NO external assets. */
function shell(headline: string, intro: string, cta: string, footnote: string): string {
  return [
    '<div style="font-family:-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1f1f1f;background:#ffffff">',
    '<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#8c8c8c">{{siteName}}</p>',
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:600;color:#1f1f1f">${headline}</h1>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#434343">${intro}</p>`,
    `<p style="margin:0 0 28px"><a href="{{link}}" style="display:inline-block;padding:10px 24px;font-size:15px;line-height:1.5;color:#ffffff;background:#1677ff;border-radius:6px;text-decoration:none">${cta}</a></p>`,
    `<p style="margin:0;font-size:12px;line-height:1.6;color:#8c8c8c">${footnote}<br><a href="{{link}}" style="color:#8c8c8c;word-break:break-all">{{link}}</a></p>`,
    '</div>',
  ].join('\n');
}

export const DEFAULTS: Record<TemplateId, DefaultTemplate> = {
  verify: {
    subject: {
      en: 'Verify your email',
      zh: '请验证您的电子邮箱',
    },
    html: {
      en: shell(
        'Confirm your email address',
        'Hi {{name}}, please confirm your email address to finish setting up your account.',
        'Verify email',
        'This link expires in 24 hours. If you did not request it, you can ignore this email.',
      ),
      zh: shell(
        '验证您的电子邮箱',
        '{{name}}，您好。请验证您的邮箱地址以完成账户注册。',
        '验证邮箱',
        '此链接 24 小时内有效。如果您没有提出此请求，请忽略本邮件。',
      ),
    },
  },
  reset: {
    subject: {
      en: 'Reset your password',
      zh: '重置您的密码',
    },
    html: {
      en: shell(
        'Reset your password',
        'Hi {{name}}, we received a request to reset your password.',
        'Reset password',
        'This link expires in 30 minutes and can be used only once. If you did not request a reset, you can safely ignore this email.',
      ),
      zh: shell(
        '重置您的密码',
        '{{name}}，您好。我们收到了重置您密码的请求。',
        '重置密码',
        '此链接 30 分钟内有效，且仅可使用一次。如果您没有申请重置，请忽略本邮件。',
      ),
    },
  },
  magic: {
    subject: {
      en: 'Your sign-in link',
      zh: '您的登录链接',
    },
    html: {
      en: shell(
        'Sign in',
        'Hi {{name}}, click the button below to sign in to your account.',
        'Sign in',
        'This sign-in link expires in 15 minutes and can be used only once. If you did not request it, you can safely ignore this email.',
      ),
      zh: shell(
        '登录您的账户',
        '{{name}}，您好。点击下方按钮即可登录您的账户。',
        '立即登录',
        '此登录链接 15 分钟内有效，且仅可使用一次。如果您没有提出此请求，请忽略本邮件。',
      ),
    },
  },
  invite: {
    subject: {
      en: 'Set your password',
      zh: '请设置您的密码',
    },
    html: {
      en: shell(
        'Set your password',
        '{{inviter}} invited {{invitee}} to this workspace. Please set a password to get started.',
        'Set your password',
        'This invitation link expires in 72 hours. If you were not expecting it, you can safely ignore this email.',
      ),
      zh: shell(
        '设置您的密码',
        '{{inviter}} 已邀请 {{invitee}} 加入本工作区。请设置一个密码以开始使用。',
        '设置密码',
        '此邀请链接 72 小时内有效。如果您并不期待此邀请，请忽略本邮件。',
      ),
    },
  },
};

/** Escape &, <, >, " — attr-correct (&amp; inside hrefs is valid). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const warnedPlaceholders = new Set<string>();
function warnOncePlaceholder(name: string): void {
  if (warnedPlaceholders.has(name)) return;
  warnedPlaceholders.add(name);
  logger.warn({ placeholder: name }, 'email template references unknown placeholder — left literal');
}

/** String arm that wins over a fallback unless it is missing/empty/non-string. */
function pickArm(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export interface RenderEmailOptions {
  /** Resolved language (arg priority is the CALLER's job: per-call → email_locale_default → 'en'). */
  locale?: string;
  overrides?: Partial<Record<TemplateId, TemplateOverride>>;
  siteName?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

export function renderEmail(
  id: TemplateId,
  vars: Record<string, string | undefined>,
  opts: RenderEmailOptions = {},
): RenderedEmail {
  const locale = opts.locale === 'zh' ? 'zh' : FALLBACK_LOCALE;
  const base = DEFAULTS[id];
  const ov = opts.overrides?.[id];
  const subjectEn = pickArm(ov?.subject?.en, base.subject.en);
  const htmlEn = pickArm(ov?.html?.en, base.html.en);
  // Per-arm merge over DEFAULTS; a missing zh arm (possible once DEFAULTS grew
  // partial zh coverage) falls back to the effective en arm.
  const subject = locale === 'zh' ? pickArm(ov?.subject?.zh, base.subject.zh || subjectEn) : subjectEn;
  const html = locale === 'zh' ? pickArm(ov?.html?.zh, base.html.zh || htmlEn) : htmlEn;

  const map = new Map<string, string>([['siteName', escapeHtml(opts.siteName ?? SITE_NAME_FALLBACK)]]);
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) map.set(key, escapeHtml(value));
  }
  const substitute = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
      const value = map.get(name);
      if (value !== undefined) return value;
      warnOncePlaceholder(name);
      return whole;
    });
  return { subject: substitute(subject), html: substitute(html) };
}

/** Stored override? — loose object check; arms are sanitized at render time. */
function asOverride(value: unknown): TemplateOverride | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TemplateOverride)
    : undefined;
}

/**
 * Sender-side helper: resolves the stored override + locale + site name
 * through OptionsManager (env fallback undefined — options-only) so each
 * migrated sender stays a single renderEmailFor call.
 */
export async function renderEmailFor(
  id: TemplateId,
  vars: Record<string, string | undefined>,
  options: Pick<OptionsManager, 'get'>,
): Promise<RenderedEmail> {
  const stored = await options.get<unknown>(`email_tmpl_${id}`, undefined, undefined);
  const override = asOverride(stored);
  const locale = await options.get<string>('email_locale_default', undefined, FALLBACK_LOCALE);
  const siteName = await options.get<string>('site.name', undefined, SITE_NAME_FALLBACK);
  return renderEmail(id, vars, {
    locale,
    overrides: override ? { [id]: override } : undefined,
    siteName,
  });
}

/**
 * Shared validator (spec §7 R8 dual-write closure): BOTH the generic
 * PUT /api/v1/options path and PUT /api/v1/email-templates/:id run this.
 * Returns an error message, or null when the value is acceptable.
 */
export function validateEmailTemplate(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'email template must be an object with subject/html arm objects';
  }
  const v = value as Record<string, unknown>;
  for (const field of Object.keys(v)) {
    if (field !== 'subject' && field !== 'html') return `email template has unknown field '${field}'`;
  }
  let arms = 0;
  for (const field of ['subject', 'html'] as const) {
    const block = v[field];
    if (block === undefined) continue;
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      return `email template ${field} must be an object of optional en/zh string arms`;
    }
    const b = block as Record<string, unknown>;
    for (const locale of Object.keys(b)) {
      if (locale !== 'en' && locale !== 'zh') return `email template ${field} has unknown locale '${locale}'`;
      const arm = b[locale];
      if (typeof arm !== 'string') return `email template ${field}.${locale} must be a string`;
      if (arm.trim().length === 0) return `email template ${field}.${locale} must not be empty`;
      const cap = field === 'subject' ? 200 : 20000;
      if (arm.length > cap) return `email template ${field}.${locale} exceeds ${cap} characters`;
      if (/<script/i.test(arm)) return `email template ${field}.${locale} must not contain <script`;
      if (/\son[a-z0-9_]*\s*=/i.test(arm)) return `email template ${field}.${locale} must not contain inline event handlers (on…=)`;
      arms += 1;
    }
  }
  if (arms === 0) return 'email template must define at least one non-empty arm';
  return null;
}

/** email_locale_default validation (same dispatch point in options.ts). */
export function validateEmailLocale(value: unknown): string | null {
  return value === 'en' || value === 'zh' ? null : 'email_locale_default must be "en" or "zh"';
}
