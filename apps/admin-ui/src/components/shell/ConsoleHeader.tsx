import { Breadcrumb, Button, Dropdown, Segmented } from 'antd';
import {
  BuildOutlined,
  GlobalOutlined,
  LogoutOutlined,
  MoonOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { PackPreference } from '../../stores/ui';
import { usePageLabel } from './usePageLabel';

/**
 * S3' contract component (adjudication 1=C, G3): the topbar — crumb on the
 * left ("Admin / Page"), action zone on the right in the prototype's order:
 * language · style pack · theme · tenant tag · avatar dropdown. Styled with
 * contract cssVars; rendered through ProLayout's headerRender slot.
 */
export function ConsoleHeader({
  theme,
  onToggleTheme,
  pack,
  onPackChange,
  language,
  onToggleLanguage,
  tenantName,
  userName,
  onNavigate,
  onLogout,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  pack: PackPreference;
  onPackChange: (p: PackPreference) => void;
  language: string;
  onToggleLanguage: () => void;
  tenantName?: string;
  userName?: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}): React.ReactNode {
  const { t } = useTranslation();
  const pageLabel = usePageLabel();
  const initials = (userName || 'Admin')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const iconBtn: React.CSSProperties = {
    width: 'var(--ctl-h-sm)',
    height: 'var(--ctl-h-sm)',
    borderRadius: 'var(--r4)',
    border: '1px solid var(--bd)',
    background: 'var(--surface)',
    color: 'var(--tx2)',
    display: 'grid',
    placeItems: 'center',
  };
  return (
    <header
      data-testid="console-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp16)',
        padding: '0 var(--sp24)',
        height: 'var(--top-h)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--bd-hair)',
      }}
    >
      <Breadcrumb
        style={{ fontSize: 'var(--fs12)' }}
        items={[{ title: 'Admin' }, { title: <b style={{ color: 'var(--tx1)', fontWeight: 500 }}>{pageLabel}</b> }]}
      />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--sp8)' }}>
        <Button
          size="small"
          data-testid="lang-toggle"
          icon={<GlobalOutlined />}
          onClick={onToggleLanguage}
          title={t('common.language')}
          aria-label={t('common.language')}
        >
          {language === 'zh' ? '中文' : 'EN'}
        </Button>
        <Segmented
          data-testid="pack-select"
          aria-label={t('common.stylePack')}
          value={pack}
          onChange={(v) => onPackChange(v as PackPreference)}
          options={[
            { label: 'Ant', value: 'ant' },
            { label: 'Broadsheet', value: 'broadsheet' },
          ]}
        />
        <button
          type="button"
          data-testid="theme-toggle"
          style={iconBtn}
          title={t('common.theme')}
          aria-label={t('common.theme')}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        </button>
        {tenantName && (
          <span
            data-testid="tenant-tag"
            title="Tenant partition is set by your sign-in token (read-only)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              border: '1px solid var(--bd)',
              borderRadius: 'var(--r4)',
              background: 'var(--surface)',
              fontSize: 'var(--fs12)',
              color: 'var(--tx1)',
            }}
          >
            <BuildOutlined style={{ fontSize: 'var(--ic-m)' }} />
            <span>{tenantName}</span>
          </span>
        )}
        <Dropdown
          menu={{
            items: [
              { key: 'profile', label: t('menu.profile'), icon: <UserOutlined /> },
              { type: 'divider' },
              { key: 'logout', label: t('menu.logout'), icon: <LogoutOutlined />, danger: true },
            ],
            onClick: ({ key }) => {
              if (key === 'profile') onNavigate('/profile');
              if (key === 'logout') onLogout();
            },
          }}
        >
          <span
            data-testid="user-dropdown"
            style={{
              width: 'var(--ctl-h-sm)',
              height: 'var(--ctl-h-sm)',
              borderRadius: 'var(--r4)',
              background: 'var(--sunken)',
              border: '1px solid var(--bd)',
              color: 'var(--tx2)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 500,
              fontSize: 'var(--fs11)',
              cursor: 'pointer',
            }}
          >
            {initials}
          </span>
        </Dropdown>
      </div>
    </header>
  );
}
