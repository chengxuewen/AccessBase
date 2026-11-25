import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// First path segment → i18n key (menu-level page). Unknown segments render as-is.
export const SEGMENT_KEYS: Record<string, string> = {
  dashboard: 'menu.dashboard',
  users: 'menu.users',
  roles: 'menu.roles',
  groups: 'menu.groups',
  audit: 'menu.audit',
  events: 'menu.events',
  profile: 'menu.profile',
  tenants: 'menu.tenants',
  settings: 'menu.settings',
  clients: 'menu.clients',
  'api-keys': 'menu.apiKeys',
  webhooks: 'menu.webhooks',
};

/** S3' crumb label: the MENU-LEVEL page (prototype crumb = "Admin / Page"). */
export function usePageLabel(): string {
  const { t } = useTranslation();
  const location = useLocation();
  const first = location.pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
  const key = SEGMENT_KEYS[first];
  return key ? t(key) : first;
}
