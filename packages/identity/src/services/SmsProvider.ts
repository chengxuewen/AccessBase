/**
 * SmsProvider - SMS OTP code delivery abstraction (Batch I Task 0)
 *
 * Two adapters: aliyun Dysmsapi (official SDK, V3 signing not worth hand-rolling)
 * and twilio (raw REST fetch per R5 - the twilio npm package is ~50MB for one
 * endpoint, so it is NOT a dependency).
 *
 * R4: both @alicloud packages are CJS. Under ESM `await import()` the named
 * exports depend on cjs-module-lexer static detection; vi.mock interception in
 * unit tests means the real interop never executes there. Adapters resolve
 * exports via interopExport() which handles every observed shape (verified
 * live: dysmsapi module.exports = { ...models, default: Client }; openapi-client
 * module.exports.default = Config), and a real import smoke test proves the
 * real packages resolve (SamlProvider.test.ts:25 precedent).
 *
 * Lazy client construction mirrors SamlProvider: config-only construction, the
 * SDK client materializes on the first send.
 */
import { logger } from '@accessbase/logging';

export interface SmsConfig {
  provider: 'aliyun' | 'twilio';
  /** aliyun: approved signature */
  signName?: string;
  /** aliyun: template code */
  templateCode?: string;
  /** twilio */
  accountSid?: string;
  /** twilio */
  authToken?: string;
  /** twilio */
  fromNumber?: string;
  /** aliyun */
  accessKeyId?: string;
  /** aliyun */
  accessKeySecret?: string;
}

export interface SmsSendParams {
  to: string;
  code: string;
}

export interface SmsProvider {
  send(params: SmsSendParams): Promise<void>;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK module shapes are reached through CJS interop fallbacks; static types would defeat the m.default?.X ?? m.X chain (R4) */

/**
 * Resolve a named export from a possibly-CJS package under ESM interop (R4).
 * Observed shapes (live-verified):
 * - Pure-Node ESM import of dysmsapi: module.exports = { ...models, default: Client } → ns.default.default = Client
 * - Vitest (vite-node) CJS interop: ns.default = Client directly (hoisted default export)
 * - openapi-client: ns.default.Config = Config class
 * - vitest mock factories: plain named exports
 * Priority: named hit → default-as-object hit → default IS the class (prototype sniff).
 */
function interopExport(mod: any, name: string): any {
  if (mod?.[name] !== undefined) return mod[name];
  const d = mod?.default;
  if (d && typeof d === 'object') {
    if (d[name] !== undefined) return d[name];
    if (name === 'Client' && d['default'] !== undefined) return d['default'];
  }
  // vite-node sometimes hoists the CJS default export itself to ns.default.
  if (d && typeof d === 'function' && typeof d.prototype?.sendSms === 'function') {
    return d;
  }
  return undefined;
}

/** Module-level lazy caches (zero SDK load when SMS is disabled). */
let cachedDysmsapi: any = null;
let cachedOpenApi: any = null;

async function getDysmsapiModule(): Promise<any> {
  cachedDysmsapi ??= await import('@alicloud/dysmsapi20170525');
  return cachedDysmsapi;
}

async function getOpenApiModule(): Promise<any> {
  cachedOpenApi ??= await import('@alicloud/openapi-client');
  return cachedOpenApi;
}


export class AliyunSmsAdapter implements SmsProvider {
  private readonly config: SmsConfig;
  private client: any = null;

  constructor(config: SmsConfig) {
    this.config = config;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const [dysmsapi, openapi] = await Promise.all([getDysmsapiModule(), getOpenApiModule()]);
    const Client = interopExport(dysmsapi, 'Client');
    const Config = interopExport(openapi, 'Config');
    this.client = new Client(
      new Config({
        accessKeyId: this.config.accessKeyId,
        accessKeySecret: this.config.accessKeySecret,
        endpoint: 'dysmsapi.aliyuncs.com',
      }),
    );
    return this.client;
  }

  async send({ to, code }: SmsSendParams): Promise<void> {
    const client = await this.getClient();
    const dysmsapi = await getDysmsapiModule();
    const SendSmsRequest = interopExport(dysmsapi, 'SendSmsRequest');
    const response = await client.sendSms(
      new SendSmsRequest({
        phoneNumbers: to,
        signName: this.config.signName,
        templateCode: this.config.templateCode,
        templateParam: JSON.stringify({ code }),
      }),
    );
    // Aliyun SDK puts the business result under body; Code === 'OK' means accepted.
    const bizCode: string | undefined = response?.body?.code ?? response?.Code;
    if (bizCode !== 'OK') {
      logger.warn({ provider: 'aliyun', to, code: bizCode }, 'Aliyun SMS send failed');
      throw new Error(`Aliyun SMS send failed: ${bizCode ?? 'unknown'}`);
    }
    logger.info({ provider: 'aliyun', to }, 'SMS sent');
  }
}

export class TwilioSmsAdapter implements SmsProvider {
  private readonly config: SmsConfig;

  constructor(config: SmsConfig) {
    this.config = config;
  }

  async send({ to, code }: SmsSendParams): Promise<void> {
    const { accountSid, authToken, fromNumber } = this.config;
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber ?? '',
          Body: `您的验证码是 ${code}，5分钟内有效`,
        }),
      },
    );
    if (!response.ok) {
      logger.warn({ provider: 'twilio', to, status: response.status }, 'Twilio SMS send failed');
      throw new Error(`Twilio SMS send failed: ${response.status}`);
    }
    logger.info({ provider: 'twilio', to }, 'SMS sent');
  }
}

export class SmsProviderImpl {
  /** Returns null when required credentials absent per provider (mailer.fromConfig precedent). */
  static fromConfig(cfg: SmsConfig): SmsProvider | null {
    if (cfg.provider === 'aliyun') {
      if (!cfg.accessKeyId || !cfg.accessKeySecret || !cfg.signName || !cfg.templateCode) {
        return null;
      }
      return new AliyunSmsAdapter(cfg);
    }
    if (cfg.provider === 'twilio') {
      if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
        return null;
      }
      return new TwilioSmsAdapter(cfg);
    }
    return null;
  }
}
