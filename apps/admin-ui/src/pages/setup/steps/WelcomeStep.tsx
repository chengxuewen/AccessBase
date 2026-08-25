import { useState } from 'react';
import { Button, Space, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { runSystemChecks } from '../../../api/setup';
import { useSetupStore } from '../../../stores/setup';

interface CheckItem {
  name: string;
  label: string;
  status: 'pending' | 'checking' | 'success' | 'error';
  message?: string;
  recovery?: string;
}

interface StepProps {
  next: () => void;
  prev: () => void;
  stepTitleRef: React.RefObject<HTMLHeadingElement | null>;
}

export default function WelcomeStep({ next, stepTitleRef }: StepProps) {
  const { t } = useTranslation();
  const { systemChecks, setSystemChecks } = useSetupStore();
  const [checks, setChecks] = useState<CheckItem[]>(
    systemChecks.length > 0
      ? systemChecks
      : [
          { name: 'database', label: t('setup.checks.database'), status: 'pending' },
          { name: 'redis', label: t('setup.checks.redis'), status: 'pending' },
          { name: 'disk', label: t('setup.checks.disk'), status: 'pending' },
          { name: 'migrations', label: t('setup.checks.migrations'), status: 'pending' },
        ],
  );
  const [running, setRunning] = useState(false);

  const allPassed = checks.every((c) => c.status === 'success');

  const handleStartChecks = async () => {
    setRunning(true);
    // Mark all as checking
    setChecks((prev) => prev.map((c) => ({ ...c, status: 'checking' as const })));

    try {
      const results = await runSystemChecks();
      setChecks(results);
      setSystemChecks(results);
    } catch {
      setChecks((prev) =>
        prev.map((c) => ({
          ...c,
          status: 'error' as const,
          message: t('setup.errors.networkError'),
        })),
      );
    } finally {
      setRunning(false);
    }
  };

  const retryCheck = async (name: string) => {
    setChecks((prev) =>
      prev.map((c) => (c.name === name ? { ...c, status: 'checking' as const } : c)),
    );
    try {
      const results = await runSystemChecks();
      setChecks(results);
      setSystemChecks(results);
    } catch {
      setChecks((prev) =>
        prev.map((c) =>
          c.name === name
            ? { ...c, status: 'error' as const, message: t('setup.errors.networkError') }
            : c,
        ),
      );
    }
  };

  const recoveryMap: Record<string, string> = {
    database: t('setup.checks.databaseRecovery'),
    redis: t('setup.checks.redisRecovery'),
    disk: t('setup.checks.diskRecovery'),
    migrations: t('setup.checks.migrationsRecovery'),
  };

  return (
    <div role="region" aria-labelledby="welcome-title">
      <h2 id="welcome-title" ref={stepTitleRef} tabIndex={-1}>
        {t('setup.welcome.title')}
      </h2>
      <p style={{ color: '#666', marginBottom: 24 }}>{t('setup.welcome.subtitle')}</p>

      <div role="list" aria-label={t('setup.checks.title')} style={{ marginBottom: 24 }}>
        {checks.map((check) => (
          <div
            key={check.name}
            role="listitem"
            style={{ display: 'flex', alignItems: 'flex-start', padding: '8px 0' }}
          >
            <span aria-hidden="true" style={{ marginRight: 8, marginTop: 2 }}>
              {check.status === 'success' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
              {check.status === 'error' && <CloseCircleOutlined style={{ color: '#cf1322' }} />}
              {check.status === 'checking' && <Spin size="small" />}
              {check.status === 'pending' && <ClockCircleOutlined style={{ color: '#999' }} />}
            </span>
            <span>{check.label}</span>
            <span className="sr-only">
              {check.status === 'success'
                ? t('setup.checks.success')
                : check.status === 'error'
                  ? `${t('setup.checks.error')}: ${check.message}`
                  : check.status === 'checking'
                    ? t('setup.checks.checking')
                    : ''}
            </span>
            {check.status === 'error' && (
              <div role="alert" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <span style={{ color: '#cf1322', fontSize: 12 }}>{check.message}</span>
                <p style={{ color: '#666', fontSize: 12, margin: '4px 0' }}>
                  {recoveryMap[check.name]}
                </p>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => retryCheck(check.name)}
                >
                  {t('setup.checks.retry')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Space>
        {!allPassed && (
          <Button type="primary" loading={running} onClick={handleStartChecks}>
            {t('setup.welcome.startButton')}
          </Button>
        )}
        {allPassed && (
          <Button type="primary" onClick={next}>
            {t('setup.navigation.next')}
          </Button>
        )}
      </Space>
    </div>
  );
}
