import client from './client';

interface CheckItem {
  name: string;
  label: string;
  status: 'pending' | 'checking' | 'success' | 'error';
  message?: string;
  recovery?: string;
}

interface AdminFormData {
  name: string;
  email: string;
  password: string;
}

interface ConfigFormData {
  siteName: string;
  siteUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
}

/** Check if the system needs initial setup. Never rejects — network failure → ok:false so guards can retry instead of fail-open. */
export async function checkSetupStatus(): Promise<{ needsSetup: boolean; ok: boolean }> {
  try {
    const { data } = await client.get('/v1/setup/status');
    // Backend returns { success, data: { isInitialized, adminExists, configComplete } }
    return { needsSetup: !data.data?.isInitialized, ok: true };
  } catch {
    return { needsSetup: false, ok: false };
  }
}

/** Run system environment checks */
export async function runSystemChecks(): Promise<CheckItem[]> {
  const { data } = await client.get('/v1/setup/checks');
  // Backend returns { success, data: { checks: [{ name, status: 'pass'|'fail', message }] } }
  // Frontend expects CheckItem[] with status: 'success'|'error'
  const raw = data.data?.checks ?? [];
  return raw.map((c: { name: string; status: string; message?: string }) => ({
    name: c.name,
    label: c.name,
    status: c.status === 'pass' ? 'success' : 'error',
    message: c.message,
  })) as CheckItem[];
}

/** Create the first admin account */
export async function createAdmin(formData: AdminFormData): Promise<void> {
  await client.post('/v1/setup/admin', formData);
}

/** Save basic configuration */
export async function saveConfig(formData: ConfigFormData): Promise<void> {
  await client.post('/v1/setup/config', formData);
}

/** Complete setup and receive tokens */
export async function completeSetup(): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const { data } = await client.post('/v1/setup/complete');
  // Backend wraps tokens in the standard envelope { success, data: { accessToken, refreshToken } } — unwrap
  const payload = data.data ?? {};
  return { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
}
