/**
 * SmsProvider tests (Batch I Task 0)
 *
 * Mock model mirrors SamlProvider.test.ts: the aliyun SDK modules are mocked
 * with factories. The FIRST tests are the R4 smoke: they bypass the mocks via
 * vi.doUnmock + dynamic import to prove the REAL packages (CJS named-export
 * interop) resolve under our moduleResolution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAliyunClientInstance = {
  sendSms: vi.fn(),
};
const MockAliyunClient = vi.fn().mockImplementation(() => mockAliyunClientInstance);
const MockSendSmsRequest = vi.fn().mockImplementation((params: Record<string, unknown>) => params);
const MockOpenApiConfig = vi.fn().mockImplementation((params: Record<string, unknown>) => params);

vi.mock('@alicloud/dysmsapi20170525', () => ({
  // Vitest factory mocks must cover every shape interopExport() probes.
  default: { Client: MockAliyunClient, SendSmsRequest: MockSendSmsRequest },
  Client: MockAliyunClient,
  SendSmsRequest: MockSendSmsRequest,
}));
vi.mock('@alicloud/openapi-client', () => ({
  default: { Config: MockOpenApiConfig },
  Config: MockOpenApiConfig,
}));

import {
  AliyunSmsAdapter,
  SmsProviderImpl,
  TwilioSmsAdapter,
  type SmsConfig,
} from '../services/SmsProvider.js';

function makeConfig(overrides: Partial<SmsConfig> = {}): SmsConfig {
  return {
    provider: 'aliyun',
    signName: 'AccessBase',
    templateCode: 'SMS_12345678',
    accessKeyId: 'ak-id',
    accessKeySecret: 'ak-secret',
    ...overrides,
  };
}

describe('R4 smoke: real @alicloud CJS named imports resolve', () => {
  it('imports the real dysmsapi package (not mocked) and Client is a function', async () => {
    vi.resetModules();
    vi.doUnmock('@alicloud/dysmsapi20170525');
    try {
      const m = await import('@alicloud/dysmsapi20170525');
      // Real package shape (live-verified): module.exports = { ...models, default: Client }.
      // Under vite-node ns.default IS the Client class; under pure Node the class
      // lands at ns.default.default. Detect the class by its sendSms prototype.
      const Client =
        m.default?.Client ??
        m.default?.default ??
        (typeof m.default === 'function' && typeof m.default.prototype?.sendSms === 'function'
          ? m.default
          : undefined) ??
        m.Client;
      expect(typeof Client).toBe('function');
    } finally {
      // Re-register with the SAME shape as the top-level factory (default key
      // included) - subsequent tests must not see a default-less mock.
      vi.doMock('@alicloud/dysmsapi20170525', () => ({
        default: { Client: MockAliyunClient, SendSmsRequest: MockSendSmsRequest },
        Client: MockAliyunClient,
        SendSmsRequest: MockSendSmsRequest,
      }));
    }
  });

  it('imports the real openapi-client package and Config is a function', async () => {
    vi.resetModules();
    vi.doUnmock('@alicloud/openapi-client');
    try {
      const m = await import('@alicloud/openapi-client');
      expect(typeof (m.default?.Config ?? m.Config)).toBe('function');
    } finally {
      vi.doMock('@alicloud/openapi-client', () => ({
        default: { Config: MockOpenApiConfig },
        Config: MockOpenApiConfig,
      }));
    }
  });
});

describe('SmsProviderImpl.fromConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when provider is aliyun and accessKeyId absent', () => {
    const cfg = makeConfig();
    delete (cfg as Record<string, unknown>)['accessKeyId'];
    expect(SmsProviderImpl.fromConfig(cfg)).toBeNull();
  });

  it('returns null when provider is aliyun and accessKeySecret absent', () => {
    const cfg = makeConfig();
    delete (cfg as Record<string, unknown>)['accessKeySecret'];
    expect(SmsProviderImpl.fromConfig(cfg)).toBeNull();
  });

  it('returns null when provider is aliyun and signName absent', () => {
    const cfg = makeConfig();
    delete (cfg as Record<string, unknown>)['signName'];
    expect(SmsProviderImpl.fromConfig(cfg)).toBeNull();
  });

  it('returns null when provider is aliyun and templateCode absent', () => {
    const cfg = makeConfig();
    delete (cfg as Record<string, unknown>)['templateCode'];
    expect(SmsProviderImpl.fromConfig(cfg)).toBeNull();
  });

  it('returns an aliyun adapter when all aliyun credentials present', () => {
    const p = SmsProviderImpl.fromConfig(makeConfig());
    expect(p).not.toBeNull();
    expect(p).toBeInstanceOf(AliyunSmsAdapter);
  });

  it('returns null when provider is twilio and accountSid absent', () => {
    const cfg = makeConfig({ provider: 'twilio', authToken: 'tok', fromNumber: '+15550001' });
    expect(SmsProviderImpl.fromConfig(cfg)).toBeNull();
  });

  it('returns null when provider is twilio and authToken absent', () => {
    const cfg = makeConfig({ provider: 'twilio', accountSid: 'AC123', fromNumber: '+15550001' });
    expect(SmsProviderImpl.fromConfig(cfg)).toBeNull();
  });

  it('returns null when provider is twilio and fromNumber absent', () => {
    const cfg = makeConfig({ provider: 'twilio', accountSid: 'AC123', authToken: 'tok' });
    expect(SmsProviderImpl.fromConfig(cfg)).toBeNull();
  });

  it('returns a twilio adapter when all twilio credentials present', () => {
    const p = SmsProviderImpl.fromConfig({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'tok',
      fromNumber: '+15550001',
    });
    expect(p).not.toBeNull();
    expect(p).toBeInstanceOf(TwilioSmsAdapter);
  });

  it('returns null for an unknown provider value', () => {
    const p = SmsProviderImpl.fromConfig({ provider: 'carrier-pigeon' } as unknown as SmsConfig);
    expect(p).toBeNull();
  });
});

describe('AliyunSmsAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAliyunClientInstance.sendSms.mockReset();
  });

  it('is lazy: constructor does not build the SDK client; client built on first send and cached', async () => {
    const adapter = new AliyunSmsAdapter(makeConfig());
    expect(MockAliyunClient).not.toHaveBeenCalled();

    mockAliyunClientInstance.sendSms.mockResolvedValueOnce({ body: { code: 'OK' } });
    await adapter.send({ to: '+8613800000001', code: '123456' });

    expect(MockAliyunClient).toHaveBeenCalledTimes(1);

    // Second send reuses the cached client.
    mockAliyunClientInstance.sendSms.mockResolvedValueOnce({ body: { code: 'OK' } });
    await adapter.send({ to: '+8613800000001', code: '654321' });
    expect(MockAliyunClient).toHaveBeenCalledTimes(1);
  });

  it('sends with aliyun config + templateParam JSON {code}', async () => {
    const adapter = new AliyunSmsAdapter(makeConfig());
    mockAliyunClientInstance.sendSms.mockResolvedValueOnce({ body: { code: 'OK' } });

    await adapter.send({ to: '+8613800000001', code: '123456' });

    expect(MockOpenApiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ accessKeyId: 'ak-id', accessKeySecret: 'ak-secret' }),
    );
    expect(MockSendSmsRequest).toHaveBeenCalledTimes(1);
    const req = MockSendSmsRequest.mock.calls[0][0] as Record<string, unknown>;
    expect(req['phoneNumbers']).toBe('+8613800000001');
    expect(req['signName']).toBe('AccessBase');
    expect(req['templateCode']).toBe('SMS_12345678');
    expect(req['templateParam']).toBe(JSON.stringify({ code: '123456' }));
    expect(mockAliyunClientInstance.sendSms).toHaveBeenCalledTimes(1);
  });

  it('throws when aliyun response Code is not OK', async () => {
    const adapter = new AliyunSmsAdapter(makeConfig());
    mockAliyunClientInstance.sendSms.mockResolvedValueOnce({
      body: { code: 'isv.BUSINESS_LIMIT_CONTROL', message: 'limit' },
    });

    await expect(adapter.send({ to: '+8613800000001', code: '123456' })).rejects.toThrow(
      /isv\.BUSINESS_LIMIT_CONTROL/,
    );
  });

  it('throws when aliyun sendSms rejects (network error)', async () => {
    const adapter = new AliyunSmsAdapter(makeConfig());
    mockAliyunClientInstance.sendSms.mockRejectedValueOnce(new Error('timeout'));

    await expect(adapter.send({ to: '+8613800000001', code: '123456' })).rejects.toThrow('timeout');
  });
});

describe('TwilioSmsAdapter', () => {
  const twilioConfig: SmsConfig = {
    provider: 'twilio',
    accountSid: 'AC1234567890',
    authToken: 'auth-token',
    fromNumber: '+15550001111',
  };

  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs raw REST Messages.json with Basic auth and urlencoded body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));

    const adapter = new TwilioSmsAdapter(twilioConfig);
    await adapter.send({ to: '+8613800000001', code: '123456' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1234567890/Messages.json');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic ' + btoa('AC1234567890:auth-token'));
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('To')).toBe('+8613800000001');
    expect(body.get('From')).toBe('+15550001111');
    expect(body.get('Body')).toBe('您的验证码是 123456，5分钟内有效');
  });

  it('throws with status when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'invalid number' }), { status: 400 }),
    );

    const adapter = new TwilioSmsAdapter(twilioConfig);
    await expect(adapter.send({ to: '+8613800000001', code: '123456' })).rejects.toThrow(
      /Twilio SMS send failed: 400/,
    );
  });
});