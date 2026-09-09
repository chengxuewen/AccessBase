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
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Typography } from 'antd';
import { useAuthStore } from '../stores/auth';
import Breadcrumbs from '../components/Breadcrumbs';
import { loadSiteSettings, SITE_SETTINGS_EVENT } from '../siteSettings';


export default function AdminLayout() {
  const { t, i18n } = useTranslation();
  // C7 fix: ProLayout renders route `name` verbatim — labels must go through i18next
  // (raw keys like "menu.dashboard" used to show in the sidebar; confirmed in real-browser snapshot).
  const menuRoutes = useMemo(
    () => ({
      path: '/',
      routes: [
        { path: '/dashboard', name: t('menu.dashboard'), icon: <DashboardOutlined /> },
        { path: '/users', name: t('menu.users'), icon: <UserOutlined /> },
        { path: '/roles', name: t('menu.roles'), icon: <SafetyOutlined /> },
        { path: '/audit', name: t('menu.audit'), icon: <FileSearchOutlined /> },
        { path: '/profile', name: t('menu.profile'), icon: <SolutionOutlined /> },
        { path: '/settings', name: t('menu.settings'), icon: <SettingOutlined /> },
      ],
    }),
    [t],
  );
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
        title: user?.name || 'Admin',
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
