import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Spin } from 'antd';
import { useAuthStore } from './stores/auth';
import { useSetupGuardState } from './hooks/useSetupGuardState';
import { i18nReady as i18nReadyPromise } from './i18n';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Audit from './pages/Audit';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import UserCreate from './pages/users/UserCreate';
import UserDetail from './pages/users/UserDetail';
import UserEdit from './pages/users/UserEdit';
import SetupWizard from './pages/setup';
import Forbidden from './pages/errors/Forbidden';
import NotFound from './pages/errors/NotFound';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuthStore();
  // Check token directly — isAuthenticated may not be rehydrated yet
  return (token || isAuthenticated) ? <>{children}</> : <Navigate to="/login" replace />;
}

function SetupGuardRetry() {
  const { t } = useTranslation();
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '40vh' }}
      data-testid="setup-guard-retry"
    >
      <Spin size="large" />
      <p style={{ marginTop: 16 }}>{t('common.connecting')}</p>
    </div>
  );
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const { needsSetup } = useSetupGuardState();
  if (needsSetup === null) return <SetupGuardRetry />;
  if (!needsSetup) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function GlobalGuard({ children }: { children: React.ReactNode }) {
  const { needsSetup } = useSetupGuardState();
  if (needsSetup === null) return <SetupGuardRetry />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export default function App() {
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => { i18nReadyPromise.then(() => setI18nReady(true)); }, []);

  if (!i18nReady) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <GlobalErrorBoundary>
    <Routes>
      <Route
        path="/setup"
        element={
          <SetupGuard>
            <SetupWizard />
          </SetupGuard>
        }
      />
      <Route
        path="/login"
        element={
          <GlobalGuard>
            <Login />
          </GlobalGuard>
        }
      />
      <Route
        path="/"
        element={
          <GlobalGuard>
            <PrivateRoute>
              <AdminLayout />
            </PrivateRoute>
          </GlobalGuard>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="users/create" element={<UserCreate />} />
        <Route path="users/:id" element={<UserDetail />} />
        <Route path="users/:id/edit" element={<UserEdit />} />
        <Route path="roles" element={<Roles />} />
        <Route path="audit" element={<Audit />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="403" element={<Forbidden />} />
      <Route path="404" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </GlobalErrorBoundary>
  );
}
