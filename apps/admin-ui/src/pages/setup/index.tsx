import { useEffect, useRef } from 'react';
import { Steps, Card, Grid, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSetupStore } from '../../stores/setup';
import { ConsoleBrand } from '../../components/shell/ConsoleBrand';
import WelcomeStep from './steps/WelcomeStep';
import AdminStep from './steps/AdminStep';
import ConfigStep from './steps/ConfigStep';
import CompleteStep from './steps/CompleteStep';

export default function SetupWizard() {
  const { t } = useTranslation();
  const { token: themeToken } = theme.useToken();
  const { md } = Grid.useBreakpoint();
  const current = useSetupStore((s) => s.currentStep);
  const setCurrentStep = useSetupStore((s) => s.setCurrentStep);
  const stepTitleRef = useRef<HTMLHeadingElement>(null);

  const next = () => setCurrentStep(current + 1);
  const prev = () => setCurrentStep(current - 1);

  // Always start at step 0 when entering setup wizard
  // (stale localStorage may have a higher currentStep from a previous session)
  useEffect(() => {
    setCurrentStep(0);
  }, [setCurrentStep]);

  useEffect(() => {
    stepTitleRef.current?.focus();
  }, [current]);

  const steps = [
    // S10.1: antd's NUMBERED step icons — the custom outlined icons rendered
    // at step-icon size with inconsistent weight and read as clutter.
    { title: t('setup.welcome.title') },
    { title: t('setup.admin.title') },
    { title: t('setup.config.title') },
    { title: t('setup.complete.title') },
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
        background: themeToken.colorBgLayout,
        padding: md ? 0 : 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 760, boxShadow: 'var(--shadow-card)' }} styles={{ body: { padding: 0 } }}>
        {/* S10.1: brand block (contract G2) — the wizard is the first surface a
            fresh install ever sees; it carries the product identity. */}
        <ConsoleBrand name="AccessBase" collapsed={false} centered />
        <div style={{ padding: md ? '24px 48px 32px' : '16px' }}>
          <Steps
            current={current}
            items={steps.map((s, i) => ({
              ...s,
              'aria-label': `Step ${i + 1}: ${s.title}`,
            }))}
            direction={md ? 'horizontal' : 'vertical'}
            style={{ marginBottom: 32 }}
            aria-label={t('setup.welcome.title')}
          />
          {/* no fixed min-height: a short step must not leave dead space */}
          <div>{stepComponents[current]}</div>
        </div>
      </Card>
    </div>
  );
}
