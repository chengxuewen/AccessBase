/**
 * Login SMS-OTP section (T3/G7 pure-move extraction from Login.tsx).
 * Renders the trigger button + request/verify two-state forms + error alert.
 * All state and handlers stay in Login.tsx; this component is render-only.
 */
import { Alert, Button, Form, Input } from 'antd';
import { KeyOutlined, MobileOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type React from 'react';

export interface SmsSectionProps {
  smsEnabled: boolean;
  smsOpen: boolean;
  smsToken: string | null;
  smsBusy: boolean;
  smsMessage: string | null;
  captchaNode: React.ReactNode;
  setSmsOpen: (open: boolean) => void;
  handleSmsRequest: (values: { phone: string }) => Promise<void> | void;
  handleSmsVerify: (values: { code: string }) => Promise<void> | void;
}

export function SmsSection({
  smsEnabled,
  smsOpen,
  smsToken,
  smsBusy,
  smsMessage,
  captchaNode,
  setSmsOpen,
  handleSmsRequest,
  handleSmsVerify,
}: SmsSectionProps): React.ReactElement {
  const { t } = useTranslation();
  if (!smsEnabled) return <></>;
  return (
    <>
      {!smsOpen && !smsToken && (
        <Button
          block
          size="large"
          type="text"
          icon={<MobileOutlined />}
          onClick={() => setSmsOpen(true)}
          style={{ marginTop: 8 }}
          data-testid="sms-trigger"
        >
          {t('login.smsTrigger')}
        </Button>
      )}

      {smsOpen && !smsToken && (
        <Form layout="vertical" onFinish={handleSmsRequest} style={{ marginTop: 16 }}>
          <Form.Item
            name="phone"
            rules={[{ required: true, message: t('login.smsPhoneRequired') }]}
          >
            <Input
              prefix={<MobileOutlined />}
              placeholder={t('login.smsPhonePlaceholder')}
              size="large"
              autoComplete="tel"
              data-testid="sms-phone"
            />
          </Form.Item>
          {captchaNode}
          <Button
            type="primary"
            htmlType="submit"
            loading={smsBusy}
            block
            size="large"
            data-testid="sms-send"
          >
            {t('login.smsSend')}
          </Button>
        </Form>
      )}

      {smsToken && (
        <Form layout="vertical" onFinish={handleSmsVerify} style={{ marginTop: 16 }}>
          <Alert
            type="info"
            showIcon
            message={t('login.smsSent')}
            style={{ marginBottom: 12 }}
            data-testid="sms-sent"
          />
          <Form.Item name="code" rules={[{ required: true, message: t('login.smsCodeRequired') }]}>
            <Input
              prefix={<KeyOutlined />}
              placeholder={t('login.smsCodePlaceholder')}
              size="large"
              maxLength={6}
              autoComplete="one-time-code"
              data-testid="sms-code"
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={smsBusy}
            block
            size="large"
            data-testid="sms-submit"
          >
            {t('login.smsSubmit')}
          </Button>
        </Form>
      )}

      {smsMessage && (
        <Alert
          type="error"
          showIcon
          message={smsMessage}
          style={{ marginTop: 16 }}
          data-testid="sms-error"
        />
      )}
    </>
  );
}
