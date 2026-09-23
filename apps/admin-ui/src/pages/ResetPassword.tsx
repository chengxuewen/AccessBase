import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Form, Input, Button, Card, Alert, theme } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { resetPassword } from '../api/auth';
import { apiErrorMessage } from '../api/errors';

/**
 * /reset-password?token= — consumes a forgot-password link (Q1). The token is
 * single-use server-side (flow token); on failure the user must re-request.
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const { token: themeToken } = theme.useToken();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: { password: string; confirm: string }) => {
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, values.password);
      setDone(true);
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
        title={t('reset.title')}
        style={{ width: '100%', maxWidth: 400 }}
        styles={{ header: { textAlign: 'center' } }}
      >
        {done ? (
          <>
            <Alert
              type="success"
              showIcon
              message={t('reset.success')}
              style={{ marginBottom: 16 }}
              data-testid="reset-success"
            />
            <Link to="/login" data-testid="reset-back">
              {t('reset.back')}
            </Link>
          </>
        ) : !token ? (
          <>
            <Alert
              type="error"
              showIcon
              message={t('reset.missing')}
              style={{ marginBottom: 16 }}
              data-testid="reset-missing"
            />
            <Link to="/login">{t('reset.back')}</Link>
          </>
        ) : (
          <>
            {error && (
              <Alert
                type="error"
                showIcon
                message={error}
                style={{ marginBottom: 16 }}
                data-testid="reset-error"
              />
            )}
            <Form form={form} layout="vertical" onFinish={handleSubmit}>
              <Form.Item
                name="password"
                label={t('reset.newPassword')}
                rules={[{ required: true, message: t('login.passwordRequired') }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  size="large"
                  autoComplete="new-password"
                  data-testid="reset-password"
                />
              </Form.Item>
              <Form.Item
                name="confirm"
                label={t('reset.confirmPassword')}
                dependencies={['password']}
                rules={[
                  { required: true, message: t('login.passwordRequired') },
                  ({ getFieldValue }) => ({
                    validator(_, value: string) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error(t('reset.mismatch')));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  size="large"
                  autoComplete="new-password"
                  data-testid="reset-confirm"
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={busy}
                block
                size="large"
                data-testid="reset-submit"
              >
                {t('reset.submit')}
              </Button>
            </Form>
          </>
        )}
      </Card>
    </div>
  );
}
