import { isAxiosError } from 'axios';

/** 从任意 catch 值提取服务端信封 error.message；无则返回 fallback。
 *  调用方对 401/429 可先查 apiErrorStatus() 做专门文案。 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const msg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return fallback;
}

export function apiErrorStatus(err: unknown): number | undefined {
  return isAxiosError(err) ? err.response?.status : undefined;
}

/** Envelope error.code extractor — for status-level arms (403 AUTH_EMAIL_003) */
export function apiErrorCode(err: unknown): string | undefined {
  if (isAxiosError(err)) {
    const code = (err.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return undefined;
}
