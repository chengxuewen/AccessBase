import { useEffect, useRef } from 'react';
import { Steps, Card, Grid } from 'antd';
import { SmileOutlined, UserOutlined, SettingOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSetupStore } from '../../stores/setup';
import WelcomeStep from './steps/WelcomeStep';
import AdminStep from './steps/AdminStep';
import ConfigStep from './steps/ConfigStep';
import CompleteStep from './steps/CompleteStep';

const stepIcons = [
  <SmileOutlined key="welcome" />,
  <UserOutlined key="admin" />,
  <SettingOutlined key="config" />,
  <CheckCircleOutlined key="complete" />,
];

export default function SetupWizard() {
  const { t } = useTranslation();
  const { md } = Grid.useBreakpoint();
  const current = useSetupStore((s) => s.currentStep);
  const setCurrentStep = useSetupStore((s) => s.setCurrentStep);
  const stepTitleRef = useRef<HTMLHeadingElement>(null);

  const next = () => setCurrentStep(current + 1);
  const prev = () => setCurrentStep(current - 1);

  useEffect(() => {
    stepTitleRef.current?.focus();
  }, [current]);

  const steps = [
    { title: t('setup.welcome.title'), icon: stepIcons[0] },
    { title: t('setup.admin.title'), icon: stepIcons[1] },
    { title: t('setup.config.title'), icon: stepIcons[2] },
    { title: t('setup.complete.title'), icon: stepIcons[3] },
  ];

  const stepProps = { next, prev, stepTitleRef };

  const stepComponents: React.ReactNode[] = [
    <WelcomeStep key="welcome" {...stepProps} />,
    <AdminStep key="admin" {...stepProps} />,
    <ConfigStep key="config" {...stepProps} />,
    <CompleteStep key="complete" {...stepProps} />,
  ];

  return (
    <div
      role="main"
      aria-label={t('setup.welcome.title')}
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: '#f0f2f5',
        padding: md ? 0 : 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 800 }}>
        <Steps
          current={current}
          items={steps.map((s, i) => ({
            ...s,
            ariaLabel: `Step ${i + 1}: ${s.title}`,
          }))}
          direction={md ? 'horizontal' : 'vertical'}
          style={{ marginBottom: 24 }}
          aria-label={t('setup.welcome.title')}
        />
        <div style={{ minHeight: 400 }}>{stepComponents[current]}</div>
      </Card>
    </div>
  );
}
