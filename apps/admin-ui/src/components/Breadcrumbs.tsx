import { Breadcrumb } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Segment → i18n key. Unknown segments render as-is (e.g. user ids).
const SEGMENT_KEYS: Record<string, string> = {
  dashboard: 'menu.dashboard',
  users: 'menu.users',
  roles: 'menu.roles',
  audit: 'menu.audit',
  profile: 'menu.profile',
  create: 'users.create',
  edit: 'common.edit',
  // Batch sync round: pages added after this table's first edition rendered raw
  // URL segments in breadcrumbs — map them to their menu.* keys.
  tenants: 'menu.tenants',
  settings: 'menu.settings',
  clients: 'menu.clients',
  'api-keys': 'menu.apiKeys',
};

export default function Breadcrumbs() {
  const { t } = useTranslation();
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <Breadcrumb
      style={{ margin: '0 0 16px' }}
      items={segments.map((seg, i) => {
        const key = SEGMENT_KEYS[seg];
        const label = key ? t(key) : seg;
        const isLast = i === segments.length - 1;
        const path = '/' + segments.slice(0, i + 1).join('/');
        return {
          title: isLast ? (
            label
          ) : (
            <Link to={path}>{label}</Link>
          ),
          key: path,
        };
      })}
    />
  );
}
