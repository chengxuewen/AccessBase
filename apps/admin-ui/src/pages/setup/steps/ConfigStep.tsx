import { Form, Input, InputNumber, Button, Collapse, Grid, notification } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSetupStore } from '../../../stores/setup';
import { saveConfig } from '../../../api/setup';

interface ConfigFormData {
  siteName: string;
  siteUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
}

interface StepProps {
  next: () => void;
  prev: () => void;
  stepTitleRef: React.RefObject<HTMLHeadingElement | null>;
}

export default function ConfigStep({ next, prev, stepTitleRef }: StepProps) {
  const { t } = useTranslation();
  const { md } = Grid.useBreakpoint();
  const { setConfigData, isLoading, setLoading, setError } = useSetupStore();
  const [form] = Form.useForm<ConfigFormData>();

  const handleSubmit = async (values: ConfigFormData) => {
    setLoading(true);
    setError(null);
    try {
      await saveConfig(values);
      setConfigData(values);
      next();
    } catch (err: unknown) {
      const error = err as { message?: string };
      notification.error({
        message: t('setup.errors.invalidConfig'),
        description: error.message,
      });
      setError(t('setup.errors.setupFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    next();
  };

  return (
    <div role="region" aria-labelledby="config-title">
      <h2 id="config-title" ref={stepTitleRef} tabIndex={-1}>
        {t('setup.config.title')}
      </h2>

      <Form
        form={form}
        onFinish={handleSubmit}
        layout={md ? 'horizontal' : 'vertical'}
        aria-label={t('setup.config.title')}
        style={{ maxWidth: 600 }}
      >
        <Form.Item
          label={t('setup.config.siteName')}
          name="siteName"
          rules={[{ required: true, message: t('setup.config.siteNameRequired') }]}
        >
          <Input aria-required="true" placeholder={t('setup.config.siteNamePlaceholder')} />
        </Form.Item>

        <Form.Item label={t('setup.config.siteUrl')} name="siteUrl">
          <Input placeholder={t('setup.config.siteUrlPlaceholder')} />
        </Form.Item>

        <Collapse
          ghost
          items={[
            {
              key: 'smtp',
              label: t('setup.config.smtp'),
              children: (
                <>
                  <Form.Item label={t('setup.config.smtpHost')} name="smtpHost">
                    <Input placeholder={t('setup.config.smtpHostPlaceholder')} />
                  </Form.Item>
                  <Form.Item label={t('setup.config.smtpPort')} name="smtpPort">
                    <InputNumber
                      placeholder={t('setup.config.smtpPortPlaceholder')}
                      style={{ width: '100%' }}
                      min={1}
                      max={65535}
                    />
                  </Form.Item>
                  <Form.Item label={t('setup.config.smtpUser')} name="smtpUser">
                    <Input placeholder={t('setup.config.smtpUserPlaceholder')} />
                  </Form.Item>
                  <Form.Item label={t('setup.config.smtpPassword')} name="smtpPassword">
                    <Input.Password placeholder={t('setup.config.smtpPasswordPlaceholder')} />
                  </Form.Item>
                  <Form.Item label={t('setup.config.smtpFrom')} name="smtpFrom">
                    <Input placeholder={t('setup.config.smtpFromPlaceholder')} />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />

        <Form.Item style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={prev}>{t('setup.navigation.previous')}</Button>
            <Button onClick={handleSkip}>{t('setup.config.skip')}</Button>
            <Button type="primary" htmlType="submit" loading={isLoading}>
              {t('setup.navigation.next')}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </div>
  );
}
