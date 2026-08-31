import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from './stores/auth';
import { checkSetupStatus } from './api/setup';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Audit from './pages/Audit';
import Profile from './pages/Profile';
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

function SetupGuard({ children }: { children: React.ReactNode }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    checkSetupStatus()
      .then((status) => setNeedsSetup(status.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  if (needsSetup === null) {
    return <Spin size="large" style={{ display: 'block', margin: '40vh auto' }} />;
  }

  if (!needsSetup) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function GlobalGuard({ children }: { children: React.ReactNode }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    checkSetupStatus()
      .then((status) => setNeedsSetup(status.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  if (needsSetup === null) {
    return <Spin size="large" style={{ display: 'block', margin: '40vh auto' }} />;
  }

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <GlobalErrorBoundary>
  return (
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
      </Route>
      <Route path="403" element={<Forbidden />} />
      <Route path="404" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </GlobalErrorBoundary>
  );
}
