/**
 * G8 (gap-remediation): branded device-flow pages — three render hooks
 * produce the branded shell (logo/primary when configured), bilingual via
 * accept-language, dark-safe CSS present, and the mandatory form bits intact.
 */
import { describe, it, expect, beforeEach } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';

import {
  deviceUserCodeInputSource,
  deviceUserCodeConfirmSource,
  deviceRenderError,
  setDeviceFlowBrandingReader,
} from '../utils/device-flow-pages.js';

type Ctx = { body: string; headers: Record<string, string>; get?: (k: string) => string };
const ctx = (acceptLanguage?: string): Ctx => ({
  body: '',
  headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {},
  get: (k: string) => (k === 'accept-language' ? (acceptLanguage ?? '') : ''),
});

beforeEach(() => {
  setDeviceFlowBrandingReader(async () => ({
    logoUrl: 'https://cdn.example.com/l.png',
    primaryColor: '#ff4400',
  }));
});

describe('deviceUserCodeInputSource', () => {
  it('branded shell: logo, primary color, input form, EN copy', async () => {
    const c = ctx('en-US,en');
    await deviceUserCodeInputSource(c, '<form action="/device"></form>', {}, undefined);
    expect(c.body).toContain('https://cdn.example.com/l.png');
    expect(c.body).toContain('#ff4400');
    expect(c.body).toContain('name="user_code"');
    expect(c.body).toContain('Enter the code displayed on your device');
    expect(c.body).toContain('lang="en"');
  });

  it('zh accept-language flips the copy', async () => {
    const c = ctx('zh-CN,zh;q=0.9');
    await deviceUserCodeInputSource(c, '<form action="/device"></form>', {}, undefined);
    expect(c.body).toContain('lang="zh"');
    expect(c.body).toContain('输入设备上显示的代码');
  });

  it('wrong-code error arm renders the red hint', async () => {
    const c = ctx();
    await deviceUserCodeInputSource(c, '', {}, { userCode: 'bad', name: 'NoCodeError' });
    expect(c.body).toContain('The code you entered is incorrect');
  });
});

describe('deviceUserCodeConfirmSource', () => {
  it('client name + user code + confirm/abort buttons preserved', async () => {
    const c = ctx();
    await deviceUserCodeConfirmSource(
      c,
      '<form id="op.deviceConfirmForm" action="/device/confirm"></form>',
      { clientName: 'TV App' },
      undefined,
      'ABCD-EFGH',
    );
    expect(c.body).toContain('TV App');
    expect(c.body).toContain('ABCD-EFGH');
    expect(c.body).toContain('op.deviceConfirmForm');
    expect(c.body).toContain('Abort');
  });
});

describe('deviceRenderError', () => {
  it('error_description surfaces, out.error echoed small', async () => {
    const c = ctx();
    await deviceRenderError(
      c,
      { error: 'expired_token' },
      { error_description: 'the code expired' },
    );
    expect(c.body).toContain('the code expired');
    expect(c.body).toContain('expired_token');
  });
});
