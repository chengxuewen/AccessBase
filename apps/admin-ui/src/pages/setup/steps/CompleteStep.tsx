import { useEffect } from 'react';
import { Button, Result, Space, Typography } from 'antd';
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
  const { formData, reset, isLoading, setLoading, setError } = useSetupStore();
  const { setTokens, fetchUser } = useAuthStore();

  useEffect(() => {
    let cancelled = false;
    const finalize = async () => {
      setLoading(true);
      try {
        const result = await completeSetup();
        if (cancelled) return;
        setTokens(result.accessToken, result.refreshToken);
        await fetchUser();
        reset();
        navigate('/', { replace: true });
      } catch (err: unknown) {
        if (cancelled) return;
        const error = err as { message?: string };
        setError(error.message || t('setup.errors.setupFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    finalize();
    return () => { cancelled = true; };
  }, []);

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

      <Result
        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
        title={t('setup.complete.title')}
        subTitle={t('setup.complete.subtitle')}
        extra={
          <Button type="primary" size="large" onClick={handleEnterDashboard} loading={isLoading}>
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
