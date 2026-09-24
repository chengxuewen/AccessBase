/**
 * Q3E-CAPTCHA: local self-hosted SVG challenge (no external service — the
 * reference new-api box and CN networks make Turnstile unreliable).
 * Shape mirrors the W1-3 flow-token discipline: GETDEL one-time consume,
 * constant-shape failures, Redis-absent => feature inert (fail-OPEN with one
 * warn: a captcha outage must never lock legitimate users out; lockout +
 * rate limits remain the hard floors).
 */
import svgCaptcha from 'svg-captcha';
import { logger } from '@accessbase/logging';
import { getOptionsManager } from '../routes/options.js';
import { getRedis } from './redis.js';

const TTL_SECONDS = 300;

function truthy(v: unknown): boolean {
  return v === '1' || v === 'true' || v === 1 || v === true;
}

export async function captchaFeatureOn(): Promise<{ on: boolean; redis: boolean }> {
  let redisClient: Awaited<ReturnType<typeof getRedis>> = null;
  let flag: unknown = 'off';
  try {
    redisClient = await getRedis();
    flag = await getOptionsManager().get('captcha_enabled', process.env['CAPTCHA_ENABLED'], 'off');
  } catch {
    return { on: false, redis: false }; // config-plane down = feature inert
  }
  return { on: truthy(flag), redis: redisClient !== null };
}

export function newCaptcha(): { id: string; svg: string; answer: string } {
  const c = svgCaptcha.create({ size: 5, noise: 2 });
  return { id: cryptoRandom(), svg: c.data, answer: c.text.toLowerCase() };
}

function cryptoRandom(): string {
  // id doubles as the redis key salt — reuse node crypto via dynamic import cache
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

/** Store the answer under captcha:{id}. Call right after newCaptcha(). */
export async function storeCaptchaAnswer(id: string, answer: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  await redis.set(`captcha:${id}`, answer.toLowerCase(), 'EX', TTL_SECONDS);
  return true;
}

/**
 * Verify when the feature is ON. Returns an error code or null.
 *  - ON + no Redis: inert (warn once) — fail-open by design (see header)
 *  - missing/wrong/expired answer: 'CAPTCHA_001'
 */
let warnedNoRedis = false;
export async function checkCaptcha(body: Record<string, unknown>): Promise<string | null> {
  const { on, redis } = await captchaFeatureOn();
  if (!on || !redis) {
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      logger.warn('captcha_enabled set but Redis is unavailable — captcha checks skipped (fail-open)');
    }
    return null;
  }
  const id = typeof body['captchaId'] === 'string' ? body['captchaId'] : '';
  const answer = typeof body['captchaAnswer'] === 'string' ? body['captchaAnswer'] : '';
  if (!id || !answer) return 'CAPTCHA_001';
  const client = await getRedis();
  if (!client) return null;
  const key = `captcha:${id}`;
  // one-time consume: GETDEL where the client has it, get+del fallback
  const withGetdel = client as typeof client & { getdel?: (k: string) => Promise<string | null> };
  let stored: string | null;
  if (typeof withGetdel.getdel === 'function') {
    stored = await withGetdel.getdel(key);
  } else {
    stored = await client.get(key);
    if (stored !== null) await client.del(key);
  }
  if (stored === null || stored !== answer.toLowerCase()) return 'CAPTCHA_001';
  return null;
}
