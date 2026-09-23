import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Form, Input, Button, Card, Alert, theme } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { requestPasswordReset } from '../api/auth';
import { apiErrorMessage } from '../api/errors';

/**
 * /forgot-password — Q1 (gap-audit C: "backend-only flow"). Requests a reset
 * mail; the server arm is enumeration-safe and carries NO message (rev.2 F2),
 * so the success text here is a static i18n string.
 */
export default function ForgotPassword() {
  const { t } = useTranslation();
  const { token: themeToken } = theme.useToken();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: { email: string }) => {
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, t('login.error')));
    } finally {
      setBusy(false);
    }
  };

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
        title={t('forgot.title')}
        style={{ width: '100%', maxWidth: 400 }}
        styles={{ header: { textAlign: 'center' } }}
      >
        {sent ? (
          <>
            <Alert
              type="success"
              showIcon
              message={t('forgot.success')}
              style={{ marginBottom: 16 }}
              data-testid="forgot-success"
            />
            <Link to="/login" data-testid="forgot-back">
              {t('forgot.back')}
            </Link>
          </>
        ) : (
          <>
            <p style={{ color: themeToken.colorTextSecondary }}>{t('forgot.desc')}</p>
            {error && (
              <Alert
                type="error"
                showIcon
                message={error}
                style={{ marginBottom: 16 }}
                data-testid="forgot-error"
              />
            )}
            <Form form={form} layout="vertical" onFinish={handleSubmit}>
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: t('login.emailRequired') },
                  { type: 'email', message: t('login.emailInvalid') },
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder={t('forgot.emailPlaceholder')}
                  size="large"
                  autoComplete="username"
                  data-testid="forgot-email"
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={busy}
                block
                size="large"
                data-testid="forgot-submit"
              >
                {t('forgot.submit')}
              </Button>
            </Form>
            <div style={{ marginTop: 16 }}>
              <Link to="/login">{t('forgot.back')}</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
