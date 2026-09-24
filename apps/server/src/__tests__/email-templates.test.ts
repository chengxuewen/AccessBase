/**
 * Q4c-T4 email-templates unit: renderer arms/fallbacks/escaping, validator
 * matrix, DEFAULTS parity, renderEmailFor option resolution.
 */
import { describe, it, expect, vi } from 'vitest';
import { logger } from '@accessbase/logging';
import type { OptionsManager } from '@accessbase/identity';
import {
  DEFAULTS,
  TEMPLATE_IDS,
  escapeHtml,
  renderEmail,
  renderEmailFor,
  validateEmailTemplate,
  validateEmailLocale,
} from '../utils/email-templates.js';
import type { TemplateId } from '../utils/email-templates.js';

function fakeOm(rows: Record<string, unknown>): Pick<OptionsManager, 'get'> {
  return {
    get: async <T>(key: string, envValue: T | undefined, defaultValue: T): Promise<T> =>
      envValue !== undefined ? envValue : key in rows ? (rows[key] as T) : defaultValue,
  };
}

describe('escapeHtml', () => {
  it('escapes & < > " (amp first)', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('DEFAULTS parity', () => {
  it('all 4 ids × {en,zh} subject+html non-empty', () => {
    for (const id of TEMPLATE_IDS) {
      expect(DEFAULTS[id].subject.en.length).toBeGreaterThan(0);
      expect(DEFAULTS[id].subject.zh.length).toBeGreaterThan(0);
      expect(DEFAULTS[id].html.en.length).toBeGreaterThan(0);
      expect(DEFAULTS[id].html.zh.length).toBeGreaterThan(0);
      expect(DEFAULTS[id].html.en).toContain('{{link}}');
      expect(DEFAULTS[id].html.zh).toContain('{{link}}');
      expect(DEFAULTS[id].html.en).toContain('{{siteName}}');
    }
  });

  it('en subjects are exactly the pre-migration literals', () => {
    expect(DEFAULTS.verify.subject.en).toBe('Verify your email');
    expect(DEFAULTS.reset.subject.en).toBe('Reset your password');
    expect(DEFAULTS.magic.subject.en).toBe('Your sign-in link');
    expect(DEFAULTS.invite.subject.en).toBe('Set your password');
  });

  it('zh subjects are Simplified Chinese (non-ASCII)', () => {
    for (const id of TEMPLATE_IDS) {
      expect(/[\u4e00-\u9fff]/.test(DEFAULTS[id].subject.zh)).toBe(true);
    }
  });
});

describe('renderEmail', () => {
  it('defaults to the en arm with site name fallback', () => {
    const r = renderEmail('reset', { link: 'https://x.test/reset?t=1' });
    expect(r.subject).toBe('Reset your password');
    expect(r.html).toContain('>AccessBase<');
    expect(r.html).toContain('href="https://x.test/reset?t=1"');
  });

  it('locale zh picks the Chinese arms', () => {
    const r = renderEmail('reset', { link: 'https://x.test/r', name: 'Alex' }, { locale: 'zh' });
    expect(r.subject).toBe(DEFAULTS.reset.subject.zh);
    expect(r.html).toContain(DEFAULTS.reset.html.zh.slice(0, 20));
  });

  it('unknown locale falls back to en', () => {
    const r = renderEmail('magic', { link: 'https://x.test/m' }, { locale: 'fr' });
    expect(r.subject).toBe('Your sign-in link');
  });

  it('per-arm merge: en-only override is ignored under zh (default zh wins); zh override honored', () => {
    const onlyEn = renderEmail('reset', { link: 'https://x.test/r' }, {
      locale: 'zh',
      overrides: { reset: { subject: { en: 'Only English' } } },
    });
    expect(onlyEn.subject).toBe(DEFAULTS.reset.subject.zh);
    const withZh = renderEmail('reset', { link: 'https://x.test/r' }, {
      locale: 'zh',
      overrides: { reset: { subject: { zh: '中文覆盖' } } },
    });
    expect(withZh.subject).toBe('中文覆盖');
  });

  it('HTML-escapes variable substitutions (invariant 5: <script> name inert)', () => {
    const r = renderEmail('verify', {
      link: 'https://x.test/v',
      name: '<script>x</script>',
    });
    expect(r.html).not.toContain('<script>x</script>');
    expect(r.html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('link with & query renders &amp; inside href (attr-correct)', () => {
    const r = renderEmail('magic', { link: 'https://x.test/p?a=1&b=2' });
    expect(r.html).toContain('href="https://x.test/p?a=1&amp;b=2"');
  });

  it('quotes in variables are escaped', () => {
    const r = renderEmail('invite', {
      link: 'https://x.test/i',
      invitee: 'a"b@test.io',
      inviter: 'He & "She"',
    });
    expect(r.html).toContain('a&quot;b@test.io');
    expect(r.html).toContain('He &amp; &quot;She&quot;');
  });

  it('unknown placeholder stays literal and warns once', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const id = `zquant${Math.random().toString(36).slice(2, 8)}` as never;
    const r = renderEmail('reset', { link: 'https://x.test/r' }, {
      overrides: { reset: { html: { en: `{{${id}}} {{${id}}}` } } },
    });
    expect(r.html).toBe(`{{${id}}} {{${id}}}`);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('override merges per arm; non-string junk arms fall back', () => {
    const r = renderEmail('reset', { link: 'https://x.test/r' }, {
      overrides: { reset: { subject: { en: 'Custom subject' }, html: { en: 42 as unknown as string } } },
    });
    expect(r.subject).toBe('Custom subject');
    expect(r.html).toContain('Reset your password'); // default html shell headline
  });

  it('siteName option flows into the shell (escaped)', () => {
    const r = renderEmail('reset', { link: 'https://x.test/r' }, { siteName: 'Acme & Co' });
    expect(r.html).toContain('Acme &amp; Co');
  });
});

describe('renderEmailFor', () => {
  it('no stored rows → built-in defaults, en, AccessBase', async () => {
    const r = await renderEmailFor('reset', { link: 'https://x.test/r' }, fakeOm({}));
    expect(r.subject).toBe('Reset your password');
    expect(r.html).toContain('>AccessBase<');
  });

  it('stored object override is consumed', async () => {
    const r = await renderEmailFor('reset', { link: 'https://x.test/r' }, fakeOm({
      email_tmpl_reset: { subject: { en: 'Stored reset' } },
    }));
    expect(r.subject).toBe('Stored reset');
    expect(r.html).toContain('Reset your password'); // html still default
  });

  it('legacy STRING stored value is ignored (object shape pinned)', async () => {
    const r = await renderEmailFor('magic', { link: 'https://x.test/m' }, fakeOm({
      email_tmpl_magic: '{"subject":{"en":"nope"}}',
    }));
    expect(r.subject).toBe('Your sign-in link');
  });

  it('email_locale_default drives the arm', async () => {
    const r = await renderEmailFor('magic', { link: 'https://x.test/m' }, fakeOm({
      email_locale_default: 'zh',
    }));
    expect(r.subject).toBe(DEFAULTS.magic.subject.zh);
  });

  it('site.name option reaches the shell', async () => {
    const r = await renderEmailFor('verify', { link: 'https://x.test/v', name: 'Bo' }, fakeOm({
        'site.name': 'ACME',
    }));
    expect(r.html).toContain('>ACME<');
  });

  it('invite lane substitutes invitee/inviter', async () => {
    const r = await renderEmailFor('invite', {
      link: 'https://x.test/i',
      invitee: 'new@test.io',
      inviter: 'An administrator',
    }, fakeOm({}));
    expect(r.subject).toBe('Set your password');
    expect(r.html).toContain('An administrator invited new@test.io');
    expect(r.html).not.toContain('{{invitee}}');
  });

  it('undefined vars are skipped without crashing', async () => {
    const ids: TemplateId[] = ['verify', 'reset', 'magic', 'invite'];
    for (const id of ids) {
      const r = await renderEmailFor(id, { link: 'https://x.test', name: undefined }, fakeOm({}));
      expect(r.html.length).toBeGreaterThan(0);
    }
  });
});

describe('validateEmailTemplate', () => {
  it('accepts valid shapes', () => {
    expect(validateEmailTemplate({ subject: { en: 'Hi' }, html: { en: '<p>x</p>' } })).toBeNull();
    expect(validateEmailTemplate({ subject: { zh: '你好' }, html: { zh: '<p>哈</p>' } })).toBeNull();
    expect(validateEmailTemplate({ subject: { en: 'A', zh: 'B' }, html: { en: 'C', zh: 'D' } })).toBeNull();
    expect(validateEmailTemplate({ html: { en: 'only html' } })).toBeNull();
  });

  it('rejects non-objects', () => {
    for (const bad of ['string', null, undefined, 42, [], [{ subject: { en: 'x' } }]]) {
      expect(validateEmailTemplate(bad)).toBeTypeOf('string');
    }
  });

  it('rejects unknown fields and locales', () => {
    expect(validateEmailTemplate({ subject: { en: 'x' }, bogus: 1 })).toContain('unknown field');
    expect(validateEmailTemplate({ subject: { fr: 'x' } })).toContain('unknown locale');
  });

  it('rejects non-string / empty arms', () => {
    expect(validateEmailTemplate({ subject: { en: 5 } })).toContain('must be a string');
    expect(validateEmailTemplate({ subject: { en: '   ' } })).toContain('must not be empty');
  });

  it('rejects over-length arms (subject 200 / html 20000)', () => {
    expect(validateEmailTemplate({ subject: { en: 'a'.repeat(201) } })).toContain('200');
    expect(validateEmailTemplate({ subject: { en: 'a'.repeat(200) } })).toBeNull();
    expect(validateEmailTemplate({ html: { en: 'a'.repeat(20001) } })).toContain('20000');
  });

  it('rejects <script (case-insensitive) on both fields', () => {
    expect(validateEmailTemplate({ html: { en: '<SCRIPT src=x>' } })).toContain('<script');
    expect(validateEmailTemplate({ subject: { en: 'hi <ScRiPt>' } })).toContain('<script');
  });

  it('rejects inline event handlers (on…=)', () => {
    expect(validateEmailTemplate({ html: { en: '<img src=x onerror=alert(1)>' } })).toContain('event handler');
    expect(validateEmailTemplate({ html: { en: '<a href="x" ONCLICK = y >z</a>' } })).toContain('event handler');
    // no leading-space word-internal "on" must NOT trip the guard
    expect(validateEmailTemplate({ html: { en: 'the button bone=size matters' } })).toBeNull();
  });

  it('rejects objects with zero arms', () => {
    expect(validateEmailTemplate({})).toContain('at least one');
    expect(validateEmailTemplate({ subject: {} })).toContain('at least one');
  });
});

describe('validateEmailLocale', () => {
  it('accepts only en/zh', () => {
    expect(validateEmailLocale('en')).toBeNull();
    expect(validateEmailLocale('zh')).toBeNull();
    expect(validateEmailLocale('fr')).toContain('en');
    expect(validateEmailLocale(undefined)).toContain('en');
  });
});
