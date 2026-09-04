import { useEffect, useRef } from 'react';
import { Alert, Button, Result, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircleOutlined,
  UserOutlined,
  TeamOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useSetupStore } from '../../../stores/setup';
import { useAuthStore } from '../../../stores/auth';
import { completeSetup } from '../../../api/setup';

interface StepProps {
  next: () => void;
  prev: () => void;
  stepTitleRef: React.RefObject<HTMLHeadingElement | null>;
}

export default function CompleteStep({ stepTitleRef }: StepProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formData, reset, isLoading, setLoading, setError, error } = useSetupStore();
  const { setTokens, fetchUser } = useAuthStore();

  const completedRef = useRef(false);

  useEffect(() => {
    if (completedRef.current) return; // Prevent double execution in StrictMode
    completedRef.current = true;

    const finalize = async () => {
      setLoading(true);
      try {
        const result = await completeSetup();
        setTokens(result.accessToken, result.refreshToken);
        await fetchUser();
        reset();
        navigate('/', { replace: true });
      } catch (err: unknown) {
        const error = err as { message?: string };
        setError(error.message || t('setup.errors.setupFailed'));
      } finally {
        setLoading(false);
      }
    };
    finalize();
    // All deps are stable refs (zustand actions, react-router navigate);
    // completedRef guard makes the effect run-once regardless of re-runs.
    // t is included for the error-message fallback only.
  }, [reset, setLoading, setError, setTokens, fetchUser, navigate, t]);

  const handleEnterDashboard = () => {
    navigate('/', { replace: true });
  };

  return (
    <div role="region" aria-labelledby="complete-title" style={{ textAlign: 'center' }}>
      <h2
        id="complete-title"
        ref={stepTitleRef}
        tabIndex={-1}
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}
      >
        {t('setup.complete.title')}
      </h2>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ maxWidth: 480, margin: '0 auto 16px', textAlign: 'left' }}
          data-testid="complete-error"
        />
      )}
      <Result
        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
        title={t('setup.complete.title')}
        subTitle={t('setup.complete.subtitle')}
        extra={
          <Button
            type="primary"
            size="large"
            onClick={handleEnterDashboard}
            loading={isLoading}
            disabled={Boolean(error)}
          >
            {t('setup.complete.enterDashboard')}
          </Button>
        }
      />

      <div style={{ maxWidth: 400, margin: '0 auto', textAlign: 'left' }}>
        <Typography.Title level={5}>{t('setup.complete.summary')}</Typography.Title>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography.Text type="secondary">{t('setup.complete.siteName')}</Typography.Text>
            <Typography.Text>{formData.config?.siteName || '—'}</Typography.Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography.Text type="secondary">{t('setup.complete.adminEmail')}</Typography.Text>
            <Typography.Text>{formData.admin?.email || '—'}</Typography.Text>
          </div>
        </Space>

        <Typography.Title level={5} style={{ marginTop: 24 }}>
          {t('setup.complete.quickLinks')}
        </Typography.Title>
        <Space>
          <Button icon={<UserOutlined />} onClick={() => navigate('/users')}>
            {t('setup.complete.createUser')}
          </Button>
          <Button icon={<TeamOutlined />} onClick={() => navigate('/roles')}>
            {t('setup.complete.createRole')}
          </Button>
          <Button icon={<FileTextOutlined />} href="https://docs.accessbase.io" target="_blank">
            {t('setup.complete.viewDocs')}
          </Button>
        </Space>
      </div>
    </div>
  );
}
