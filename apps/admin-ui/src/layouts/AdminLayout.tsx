import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProLayout } from '@ant-design/pro-components';
import {
  DashboardOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Dropdown } from 'antd';
import { useAuthStore } from '../stores/auth';

const menuRoutes = {
  path: '/',
  routes: [
    {
      path: '/dashboard',
      name: 'menu.dashboard',
      icon: <DashboardOutlined />,
    },
    {
      path: '/users',
      name: 'menu.users',
      icon: <UserOutlined />,
    },
  ],
};

export default function AdminLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleLanguage = () => {
    const next = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(next);
  };

  return (
    <ProLayout
      title="AccessBase"
      logo={null}
      fixSiderbar
      collapsed={collapsed}
      onCollapse={setCollapsed}
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
        <SettingOutlined key="settings" onClick={toggleLanguage} />,
        <LogoutOutlined key="logout" onClick={handleLogout} />,
      ]}
      menuFooterRender={(props) => {
        if (props?.collapsed) return undefined;
        return (
          <div style={{ textAlign: 'center', paddingBlockEnd: 12 }}>
            <div style={{ fontSize: 12, color: '#999' }}>AccessBase v0.1.0</div>
          </div>
        );
      }}
    >
      <Outlet />
    </ProLayout>
  );
}
