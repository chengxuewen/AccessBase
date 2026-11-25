import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProLayout } from '@ant-design/pro-components';
import {
  DashboardOutlined,
  UserOutlined,
  SettingOutlined,
  SafetyOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  SolutionOutlined,
  TeamOutlined,
  UsergroupAddOutlined,
  ApiOutlined,
  KeyOutlined,
  FunctionOutlined,
} from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { ConsoleBrand } from '../components/shell/ConsoleBrand';
import { ConsoleHeader } from '../components/shell/ConsoleHeader';
import { fetchBranding } from '../branding';

// S3' (G1): prototype sidebar sections — path membership mirrors admin-console.html:731-747
const GROUPS: Array<{ key: string; paths: string[] }> = [
  { key: 'overview', paths: ['/dashboard'] },
  { key: 'identity', paths: ['/users', '/roles', '/groups'] },
  { key: 'access', paths: ['/tenants', '/clients', '/api-keys'] },
  { key: 'operations', paths: ['/webhooks', '/audit', '/events', '/profile'] },
  { key: 'system', paths: ['/settings'] },
];

export default function AdminLayout() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme, pack, setPack } = useUiStore();
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
      '/groups': 'groups:read',
      '/audit': 'audit:read',
      '/events': 'audit:read',
      '/clients': 'clients:read',
      '/api-keys': 'apikeys:read',
      '/webhooks': 'webhooks:read',
      '/tenants': 'tenants:read',
    };
    const routes = [
      { path: '/dashboard', name: t('menu.dashboard'), icon: <DashboardOutlined /> },
      { path: '/users', name: t('menu.users'), icon: <UserOutlined /> },
      { path: '/roles', name: t('menu.roles'), icon: <SafetyOutlined /> },
      { path: '/groups', name: t('menu.groups'), icon: <UsergroupAddOutlined /> },
      { path: '/audit', name: t('menu.audit'), icon: <FileSearchOutlined /> },
      { path: '/events', name: t('menu.events'), icon: <HistoryOutlined /> },
      { path: '/clients', name: t('menu.clients'), icon: <ApiOutlined /> },
      { path: '/api-keys', name: t('menu.apiKeys'), icon: <KeyOutlined /> },
      { path: '/webhooks', name: t('menu.webhooks'), icon: <FunctionOutlined /> },
      { path: '/tenants', name: t('menu.tenants'), icon: <TeamOutlined /> },
      { path: '/profile', name: t('menu.profile'), icon: <SolutionOutlined /> },
      { path: '/settings', name: t('menu.settings'), icon: <SettingOutlined /> },
    ].filter((r) => {
      const code = codeOf[r.path];
      return code === undefined || (permissions?.includes(code) ?? true);
    });
    return routes;
  }, [t, permissions]);

  // S3' (adjudication 1=C, G1): prototype sidebar GROUPS — Overview / Identity /
  // Access / Operations / System — rendered as antd Menu item groups via
  // menuDataRender. Permission-filtered; an emptied group is dropped.
  const menuData = useMemo(() => {
    const byPath = new Map(menuRoutes.map((r) => [r.path, r]));
    return GROUPS.map((g) => ({
      type: 'group' as const,
      key: `g-${g.key}`,
      name: t(`menu.group.${g.key}`),
      children: g.paths
        .map((p) => byPath.get(p))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => ({ key: r.path, path: r.path, name: r.name, icon: r.icon })),
    })).filter((g) => g.children.length > 0);
  }, [menuRoutes, t]);

  const navigate = useNavigate();
  const location = useLocation();
  const { user, error, fetchUser, logoutWithServer } = useAuthStore();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('admin-layout-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [loggingOut, setLoggingOut] = useState(false);
  const [site, setSite] = useState({ siteName: '', logoUrl: '' });

  useEffect(() => {
    void fetchBranding().then((b) => setSite({ siteName: b.siteName, logoUrl: b.logoUrl }));
  }, []);

  useEffect(() => {
    if (useAuthStore.getState().token) void fetchUser().catch(() => {});
  }, [fetchUser]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    let idpLogoutUrl: string | null = null;
    try {
      idpLogoutUrl = await logoutWithServer();
    } finally {
      setLoggingOut(false);
    }
    // §3.4 SPA one-hop: hand the browser to the IdP when the composer found
    // a logout leg; otherwise the current SPA-side /login navigation, unchanged.
    if (idpLogoutUrl) {
      window.location.assign(idpLogoutUrl);
    } else {
      navigate('/login');
    }
  };

  const toggleLanguage = () => {
    const next = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('lng', next);
  };

  // Mount signal: ProLayout's breakpoint fires synthetic onCollapse calls on
  // first render. Side layout emits TWO expand-noise signals (ProLayout +
  // antd Sider) — a first-signal-only guard lets the second clobber the
  // persisted restore (S3' battery-caught). Discriminator: an EXPAND signal
  // is genuine only when (a) the user clicked the trigger (intent) or (b) the
  // viewport has actually been below the breakpoint during this mount (a
  // real narrow→wide restore). Collapse signals always apply.
  const collapseIntent = useRef(false);
  const brokenSeen = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767.98px)'); // antd 'md'
    const onChange = (): void => {
      if (mq.matches) brokenSeen.current = true;
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const handleCollapse = (next: boolean) => {
    if (!next && !collapseIntent.current && !brokenSeen.current) return; // expand noise
    setCollapsed(next);
    if (collapseIntent.current) {
      collapseIntent.current = false;
      try {
        localStorage.setItem('admin-layout-collapsed', String(next));
      } catch {
        /* noop */
      }
    }
  };

  return (
    <ProLayout
      // S3': explicit SIDE layout (the default 'mix' parked the action zone at
      // the sider foot — conformance G3 catch)
      layout="side"
      // groups come from the MENU PROP (BaseMenu.js:105-108), not item fields
      menu={{ type: 'group' }}
      contentStyle={{ padding: 0 }}
      title={site.siteName || 'AccessBase'}
      logo={site.logoUrl || null}
      fixSiderbar
      collapsed={collapsed}
      onCollapse={handleCollapse}
      // S3 (P-6=A erratum): KEY-name breakpoint ('md' ≈ 768px) — the pixel
      // form was a phantom (verified ProLayout.d.ts:22 GlobalTypes & SiderMenuProps).
      // disableMobile: the contract wants a collapsed ICON nav, not a drawer —
      // recorded in the divergence ledger (drawer mode = ledger).
      disableMobile={true}
      breakpoint="md"
      collapsedButtonRender={(_collapsedBtn, defaultDom) => (
        <div
          data-testid="sider-collapse-trigger"
          // capture phase: mark intent BEFORE the inner trigger's own onClick
          onClickCapture={() => {
            collapseIntent.current = true;
          }}
          // prototype .side-foot .collapse-btn: bordered full-width trigger
          style={{
            margin: 'var(--sp8)',
            padding: 6,
            border: '1px solid var(--bd)',
            borderRadius: 'var(--r4)',
            background: 'var(--surface)',
            color: 'var(--tx2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 'var(--fs12)',
          }}
        >
          {defaultDom}
          {!collapsed && <span>{t('common.collapse')}</span>}
        </div>
      )}
      location={{ pathname: location.pathname }}
      route={{ path: '/', routes: menuRoutes }}
      menuItemRender={(item, dom) => (
        <div onClick={() => item.path && navigate(item.path)}>{dom}</div>
      )}
      // S3' (adjudication 1=C): the three shell contract slots — brand block
      // (G2), grouped menu (G1), topbar (G3). Page interiors untouched.
      menuHeaderRender={(_logo, _title, props) => (
        <ConsoleBrand
          name={site.siteName || 'AccessBase'}
          logoUrl={site.logoUrl || null}
          collapsed={Boolean(props?.collapsed)}
        />
      )}
      menuDataRender={() => menuData}
      headerRender={() => (
        <ConsoleHeader
          theme={resolvedTheme}
          onToggleTheme={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          pack={pack}
          onPackChange={setPack}
          language={i18n.language}
          onToggleLanguage={toggleLanguage}
          tenantName={user?.tenantIsDefault === false ? user?.tenantName : undefined}
          userName={user?.name}
          onNavigate={navigate}
          onLogout={() => void handleLogout()}
        />
      )}
    >
      {/* S3' (G3): the topbar is rendered HERE — ProLayout's side layout never
          renders a header (Header/index.js:93), so ConsoleHeader owns the
          content column's first row (prototype grid: sider full-height,
          topbar spanning the right column). */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <ConsoleHeader
          theme={resolvedTheme}
          onToggleTheme={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          pack={pack}
          onPackChange={setPack}
          language={i18n.language}
          onToggleLanguage={toggleLanguage}
          tenantName={user?.tenantIsDefault === false ? user?.tenantName : undefined}
          userName={user?.name}
          onNavigate={navigate}
          onLogout={() => void handleLogout()}
        />
        <main style={{ padding: 24, flex: 1 }}>
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

      <Outlet />
        </main>
      </div>
    </ProLayout>
  );
}
