/**
 * Login MFA step-up arm (T3/G7 pure-move extraction from Login.tsx).
 * Render-only: every value/handler arrives as a prop; the state hooks and
 * the exchanged-code effects stay in Login.tsx (PIT-086 e2e gates are the
 * regression net for that wiring).
 */
import { Alert, Button, Card, Form, Input } from 'antd';
import type { FormInstance } from 'antd';
import type React from 'react';
import { KeyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { theme } from 'antd';


export interface MfaArmProps {
  mfaForm: FormInstance<{ code: string }>;
  mfaError: boolean;
  isLoading: boolean;
  handleMfaSubmit: (values: { code: string }) => Promise<void> | void;
  handleCancelMfa: () => void;
}

export function MfaArm({ mfaForm, mfaError, isLoading, handleMfaSubmit, handleCancelMfa }: MfaArmProps): React.ReactElement {
  const { t } = useTranslation();
  const { token: themeToken } = theme.useToken();
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: themeToken.colorBgLayout,
      }}
    >
      <Card
        title={t('login.mfaTitle')}
        style={{ width: '100%', maxWidth: 400 }}
        styles={{ header: { textAlign: 'center' } }}
      >
        {mfaError && (
          <Alert
            type="error"
            showIcon
            message={t('login.mfaError')}
            style={{ marginBottom: 16 }}
            data-testid="mfa-error"
          />
        )}
        <Form form={mfaForm} layout="vertical" onFinish={handleMfaSubmit}>
          <Form.Item
            name="code"
            rules={[{ required: true, message: t('login.mfaCodeRequired') }]}
          >
            <Input
              prefix={<KeyOutlined />}
              placeholder={t('login.mfaCodePlaceholder')}
              size="large"
              autoFocus
              data-testid="mfa-code-input"
              autoComplete="one-time-code"
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isLoading} block size="large">
              {t('login.mfaSubmit')}
            </Button>
          </Form.Item>
        </Form>
        <Button block size="large" onClick={handleCancelMfa}>
          {t('login.mfaCancel')}
        </Button>
      </Card>
    </div>
  );
}
