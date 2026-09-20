import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProLayout } from '@ant-design/pro-components';
import {
  DashboardOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  GlobalOutlined,
  SafetyOutlined,
  FileSearchOutlined,
  SolutionOutlined,
  TeamOutlined,
  ApiOutlined,
  MoonOutlined,
  KeyOutlined,
  SunOutlined,
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Tag, Typography } from 'antd';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import Breadcrumbs from '../components/Breadcrumbs';
import { loadSiteSettings, SITE_SETTINGS_EVENT } from '../siteSettings';


export default function AdminLayout() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useUiStore();
  // auto resolves to light/dark; toggling from auto lands on the opposite side
  const resolvedTheme = theme === 'auto' ? 'light' : theme;
  // C7 fix: ProLayout renders route `name` verbatim — labels must go through i18next
  // (raw keys like "menu.dashboard" used to show in the sidebar; confirmed in real-browser snapshot).
  // Permission codes gate menu entries; profile/settings are always visible.
  const permissions = useAuthStore((s) => s.user?.permissions);
  const menuRoutes = useMemo(() => {
    const codeOf: Record<string, string> = {
      '/dashboard': 'stats:read',
      '/users': 'users:read',
      '/roles': 'roles:read',
      '/audit': 'audit:read',
      '/clients': 'clients:read',
      '/api-keys': 'apikeys:read',
      '/tenants': 'tenants:read',
    };
    const routes = [
      { path: '/dashboard', name: t('menu.dashboard'), icon: <DashboardOutlined /> },
      { path: '/users', name: t('menu.users'), icon: <UserOutlined /> },
      { path: '/roles', name: t('menu.roles'), icon: <SafetyOutlined /> },
      { path: '/audit', name: t('menu.audit'), icon: <FileSearchOutlined /> },
      { path: '/clients', name: t('menu.clients'), icon: <ApiOutlined /> },
      { path: '/api-keys', name: t('menu.apiKeys'), icon: <KeyOutlined /> },
      { path: '/tenants', name: t('menu.tenants'), icon: <TeamOutlined /> },
      { path: '/profile', name: t('menu.profile'), icon: <SolutionOutlined /> },
      { path: '/settings', name: t('menu.settings'), icon: <SettingOutlined /> },
    ].filter((r) => {
      const code = codeOf[r.path];
      return code === undefined || (permissions?.includes(code) ?? true);
    });
    return { path: '/', routes };
  }, [t, permissions]);

  const navigate = useNavigate();
  const location = useLocation();
  const { user, error, fetchUser, logoutWithServer } = useAuthStore();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('admin-layout-collapsed') === 'true'; } catch { return false; }
  });
  const [loggingOut, setLoggingOut] = useState(false);
  const [site, setSite] = useState(loadSiteSettings);

  useEffect(() => {
    const refresh = () => setSite(loadSiteSettings());
    window.addEventListener(SITE_SETTINGS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SITE_SETTINGS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => {
    if (useAuthStore.getState().token) void fetchUser().catch(() => {});
  }, [fetchUser]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutWithServer();
    } finally {
      setLoggingOut(false);
      navigate('/login');
    }
  };

  const toggleLanguage = () => {
    const next = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('lng', next);
  };

  const handleCollapse = (next: boolean) => {
    setCollapsed(next);
    try { localStorage.setItem('admin-layout-collapsed', String(next)); } catch { /* noop */ }
  };

  return (
    <ProLayout
      title={site.siteName || 'AccessBase'}
      logo={site.logoUrl || null}
      fixSiderbar
      collapsed={collapsed}
      onCollapse={handleCollapse}
      location={{ pathname: location.pathname }}
      route={menuRoutes}
      menuItemRender={(item, dom) => (
        <div onClick={() => item.path && navigate(item.path)}>{dom}</div>
      )}
      avatarProps={{
        src: undefined,
        // L′ D4: tenant identity is data-driven — Tag renders only for a
        // non-default tenant whose name resolved (fields absent on legacy /me
        // payloads = hidden, fail-closed). No UUID literals, no new locale key:
        // the tag content is the tenant NAME data.
        title: (
          <>
            {user?.name || 'Admin'}
            {user?.tenantIsDefault === false && user?.tenantName ? (
              <Tag data-testid="tenant-tag" style={{ marginInlineStart: 8 }}>
                {user.tenantName}
              </Tag>
            ) : null}
          </>
        ),
        size: 'small',
        render: (_, defaultDom) => (
          <Dropdown
            menu={{
              items: [
                { key: 'profile', label: t('menu.profile'), icon: <UserOutlined /> },
                { type: 'divider' },
                { key: 'logout', label: t('menu.logout'), icon: <LogoutOutlined />, danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'profile') navigate('/profile');
                if (key === 'logout') handleLogout();
              },
            }}
          >
            <span data-testid="user-dropdown">{defaultDom}</span>
          </Dropdown>
        ),
      }}
      actionsRender={() => [
        <Button
          type="text"
          size="small"
          key="theme"
          data-testid="theme-toggle"
          icon={resolvedTheme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          title={t('common.theme')}
          aria-label={t('common.theme')}
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        />,
        <Button type="text" size="small" icon={<GlobalOutlined />} key="lang" data-testid="lang-toggle" onClick={toggleLanguage} title={t('common.language')} aria-label={t('common.language')}>
          {i18n.language === 'zh' ? '中文' : 'EN'}
        </Button>,
      ]}
      menuFooterRender={(props) => {
        if (props?.collapsed) return undefined;
        return (
          <div style={{ textAlign: 'center', paddingBlockEnd: 12 }}>
            <div style={{ fontSize: 12 }}><Typography.Text type="secondary">AccessBase v0.1.0</Typography.Text></div>
          </div>
        );
      }}
      >
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" onClick={() => void fetchUser()}>
              {t('common.retry')}
            </Button>
          }
        />
      )}

      <Breadcrumbs />
      <Outlet />
    </ProLayout>
  );
}
