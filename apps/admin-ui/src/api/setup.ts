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

/** Check if the system needs initial setup */
export async function checkSetupStatus(): Promise<{ needsSetup: boolean }> {
  const { data } = await client.get('/v1/setup/status');
  // Backend returns { success, data: { isInitialized, adminExists, configComplete } }
  return { needsSetup: !data.data?.isInitialized };
}

/** Run system environment checks */
export async function runSystemChecks(): Promise<CheckItem[]> {
  const { data } = await client.get('/v1/setup/checks');
  return data;
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
  user: { id: string; email: string; name: string; roles: string[] };
}> {
  const { data } = await client.post('/v1/setup/complete');
  return data;
}
