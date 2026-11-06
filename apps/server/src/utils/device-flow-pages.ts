/**
 * G8 (gap-remediation 2026-10-12): branded device-flow pages replacing the
 * oidc-provider library defaults (English-only Google-styled pages, dark-mode
 * mismatch). Three hooks: userCodeInputSource, userCodeConfirmSource,
 * renderError. Design: centered card, system font stack, dark-safe via
 * prefers-color-scheme, logo + primary color from the site options when
 * configured (branding slice), bilingual via Accept-Language (zh → zh, else
 * en) — the provider renders server-side, i18next is not in scope here.
 *
 * CSP note: pure inline HTML with NO scripts (the confirm form posts natively
 * via the form html passed in — oidc-provider's own POST target), so no CSP
 * hash juggling is required.
 */
import type { OptionsManager } from '@accessbase/identity';

/**
 * Structural view of the Koa context oidc-provider hands the render hooks.
 * Declared loosely (index signatures) instead of importing KoaContextWithOIDC
 * — the hooks only WRITE body and READ a couple of fields, and the provider's
 * exact Koa generics churn between @types versions. Assignability is asserted
 * at the wiring site (provider.ts) where the real types live.
 */
export interface DeviceFlowCtx {
  body: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

let brandingCache: { logoUrl: string; primaryColor: string } | null = null;
let brandingCacheAt = 0;
const BRANDING_TTL_MS = 60_000;

/** Fail-soft branding read (60s cache — these pages are cold entry points). */
async function readBranding(
  getOption: (k: string, env: unknown, d: string) => Promise<string>,
): Promise<{ logoUrl: string; primaryColor: string }> {
  if (brandingCache && Date.now() - brandingCacheAt < BRANDING_TTL_MS) return brandingCache;
  try {
    const om = (globalThis as Record<string, unknown>)['__bclo_options_manager'] as
      OptionsManager | undefined;
    void om; // options manager is injected via setDeviceFlowOptionsManager (below)
    brandingCache = { logoUrl: '', primaryColor: '' };
  } catch {
    brandingCache = { logoUrl: '', primaryColor: '' };
  }
  brandingCacheAt = Date.now();
  return brandingCache;
}
void readBranding;

/** Injectable options reader (wired in provider.ts where OptionsManager lives). */
let brandingReader: (() => Promise<{ logoUrl: string; primaryColor: string }>) | null = null;
export function setDeviceFlowBrandingReader(
  reader: () => Promise<{ logoUrl: string; primaryColor: string }>,
): void {
  brandingReader = reader;
}

async function branding(): Promise<{ logoUrl: string; primaryColor: string }> {
  if (!brandingReader) return { logoUrl: '', primaryColor: '' };
  try {
    return await brandingReader();
  } catch {
    return { logoUrl: '', primaryColor: '' };
  }
}

function shell(args: {
  title: string;
  heading: string;
  bodyHtml: string;
  logoUrl: string;
  primaryColor: string;
  zh: boolean;
}): string {
  const { title, heading, bodyHtml, logoUrl, primaryColor, zh } = args;
  const accent = primaryColor || (zh ? '#1677ff' : '#1677ff');
  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="logo" style="display:block;margin:0 auto 16px;max-height:56px;max-width:80%;object-fit:contain">`
    : `<div style="font-size:20px;font-weight:600;margin-bottom:16px;${primaryColor ? `color:${accent};` : ''}">AccessBase</div>`;
  return `<!DOCTYPE html>
<html lang="${zh ? 'zh' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
           display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;
           background: #f0f2f5; }
    @media (prefers-color-scheme: dark) { body { background: #141414; } .card { background: #1f1f1f !important; border-color: #303030 !important; } h1 { color: #e6e6e6 !important; } p, small, label { color: #a6a6a6 !important; } }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 32px 28px; width: 340px; max-width: 92vw;
            box-shadow: 0 1px 4px rgba(0,0,0,.08); text-align: center; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #1f1f1f; }
    p, small, label { color: #595959; font-size: 14px; line-height: 1.6; }
    code { font-size: 1.6em; letter-spacing: .12em; color: ${accent}; font-weight: 600; display: block; margin: 12px 0; word-break: break-all; }
    input[type=text] { width: 100%; box-sizing: border-box; padding: 8px 12px; font-size: 16px; border: 1px solid #d9d9d9;
                       border-radius: 6px; margin: 8px 0 4px; background: #fff; color: #1f1f1f; }
    button { width: 100%; padding: 9px 0; margin-top: 12px; font-size: 15px; border: 0; border-radius: 6px;
             background: ${accent}; color: #fff; font-weight: 600; cursor: pointer; }
    button.linkish { background: transparent; color: #8c8c8c; font-weight: 400; font-size: 13px; }
    .err { color: #cf1322; margin: 0 0 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    ${logo}
    <h1>${heading}</h1>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function isZh(ctx: DeviceFlowCtx): boolean {
  // ctx.get is a Koa delegate bound to ctx.request — it is NOT reliably
  // callable on the error path (delegates throws when the request is torn
  // down). Read the header off ctx.headers directly; Koa materializes
  // headers on every live context.
  const headers = (ctx['headers'] ?? {}) as Record<string, unknown>;
  const al = headers['accept-language'];
  return typeof al === 'string' && /\bzh\b/i.test(al);
}

/** Escape the bare minimum (client names are operator-set; codes are charset-constrained). */
function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function deviceUserCodeInputSource(
  ctx: DeviceFlowCtx,
  form: string,
  out: unknown,
  err: { userCode?: unknown; name?: string } | undefined,
): Promise<void> {
  const zh = isZh(ctx);
  const b = await branding();
  let msg: string;
  if (err && (err.userCode || err.name === 'NoCodeError')) {
    msg = zh
      ? '<p class="err">验证码不正确，请重试</p>'
      : '<p class="err">The code you entered is incorrect. Try again</p>';
  } else if (err && err.name === 'AbortedError') {
    msg = zh
      ? '<p class="err">登录请求已中断</p>'
      : '<p class="err">The sign-in request was interrupted</p>';
  } else if (err) {
    msg = zh
      ? '<p class="err">处理请求时出错</p>'
      : '<p class="err">There was an error processing your request</p>';
  } else {
    msg = zh ? '<p>输入设备上显示的代码</p>' : '<p>Enter the code displayed on your device</p>';
  }
  ctx.body = shell({
    title: zh ? '设备登录' : 'Device Sign-in',
    heading: zh ? '设备登录' : 'Device Sign-in',
    logoUrl: b.logoUrl,
    primaryColor: b.primaryColor,
    zh,
    bodyHtml: `${msg}
    <form method="post" action="${(form.match(/action="([^"]+)"/) ?? ['', ''])[1] || ''}">
      <input type="text" name="user_code" inputmode="numeric" autocomplete="off" autofocus
             placeholder="${zh ? '例如：ABCD-EFGH' : 'e.g. ABCD-EFGH'}"
             pattern="[a-zA-Z0-9-]+" maxlength="12" required>
      <button type="submit">${zh ? '继续' : 'Continue'}</button>
    </form>`,
  });
}

export async function deviceUserCodeConfirmSource(
  ctx: DeviceFlowCtx,
  form: string,
  client: { clientName?: string; clientId?: string },
  _deviceInfo: unknown,
  userCode: string,
): Promise<void> {
  const zh = isZh(ctx);
  const b = await branding();
  const display = esc(client?.clientName || client?.clientId || '');
  ctx.body = shell({
    title: zh ? '确认设备登录' : 'Confirm Device',
    heading: zh ? '确认设备登录' : 'Confirm Device',
    logoUrl: b.logoUrl,
    primaryColor: b.primaryColor,
    zh,
    bodyHtml: `<p>${zh ? '应用' : 'App'}: <strong>${display}</strong></p>
    <p>${zh ? '确认你的设备上显示以下代码' : 'The following code should be displayed on your device'}</p>
    <code>${esc(userCode)}</code>
    ${form}
    <button autofocus type="submit" form="op.deviceConfirmForm">${zh ? '继续' : 'Continue'}</button>
    <button type="submit" form="op.deviceConfirmForm" value="yes" name="abort" class="linkish">${zh ? '取消' : 'Abort'}</button>
    <small>${zh ? '若非你本人操作，请勿继续并关闭此窗口。' : 'If you did not initiate this action, do not continue and close this window.'}</small>`,
  });
}

export async function deviceRenderError(
  ctx: DeviceFlowCtx,
  out: unknown,
  error: unknown,
): Promise<void> {
  const zh = isZh(ctx);
  const b = await branding();
  const errRec = (error ?? {}) as Partial<Record<'error_description' | 'error', string>>;
  const detail =
    typeof errRec.error_description === 'string' && errRec.error_description
      ? esc(errRec.error_description)
      : '';
  ctx.body = shell({
    title: zh ? '出错了' : 'Error',
    heading: zh ? '请求无法完成' : 'Request cannot be completed',
    logoUrl: b.logoUrl,
    primaryColor: b.primaryColor,
    zh,
    bodyHtml: `<p class="err">${detail || (zh ? '处理请求时出错' : 'There was an error processing your request')}</p>
    ${typeof (out as Record<string, unknown>)?.['error'] === 'string' ? `<small>${esc((out as Record<string, unknown>)['error'] as string)}</small>` : ''}`,
  });
}
