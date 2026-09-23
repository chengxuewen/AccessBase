import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Form, Input, Button, Card, Alert, theme } from 'antd';
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { registerUser } from '../api/auth';
import { apiErrorMessage } from '../api/errors';

/**
 * /register — self-service sign-up landing in PENDING status (batch A backend
 * semantics; gap-audit C: "frontend never built"). Approval lives with an
 * admin (Users list pending filter), not here.
 */
export default function Register() {
  const { t } = useTranslation();
  const { token: themeToken } = theme.useToken();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: {
    email: string;
    name: string;
    password: string;
    confirm: string;
  }) => {
    setBusy(true);
    setError(null);
    try {
      await registerUser({ email: values.email, name: values.name, password: values.password });
      setPending(true);
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
        title={pending ? t('register.pendingTitle') : t('register.title')}
        style={{ width: '100%', maxWidth: 400 }}
        styles={{ header: { textAlign: 'center' } }}
      >
        {pending ? (
          <>
            <Alert
              type="success"
              showIcon
              message={t('register.pending')}
              style={{ marginBottom: 16 }}
              data-testid="register-pending"
            />
            <Link to="/login" data-testid="register-back">
              {t('register.back')}
            </Link>
          </>
        ) : (
          <>
            {error && (
              <Alert
                type="error"
                showIcon
                message={error}
                style={{ marginBottom: 16 }}
                data-testid="register-error"
              />
            )}
            <Form form={form} layout="vertical" onFinish={handleSubmit}>
              <Form.Item
                name="name"
                label={t('register.name')}
                rules={[{ required: true, message: t('login.emailRequired') }]}
              >
                <Input prefix={<UserOutlined />} size="large" data-testid="register-name" />
              </Form.Item>
              <Form.Item
                name="email"
                label={t('register.email')}
                rules={[
                  { required: true, message: t('login.emailRequired') },
                  { type: 'email', message: t('login.emailInvalid') },
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  size="large"
                  autoComplete="username"
                  data-testid="register-email"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label={t('register.password')}
                rules={[{ required: true, message: t('login.passwordRequired') }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  size="large"
                  autoComplete="new-password"
                  data-testid="register-password"
                />
              </Form.Item>
              <Form.Item
                name="confirm"
                label={t('register.confirm')}
                dependencies={['password']}
                rules={[
                  { required: true, message: t('login.passwordRequired') },
                  ({ getFieldValue }) => ({
                    validator(_, value: string) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error(t('register.mismatch')));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  size="large"
                  autoComplete="new-password"
                  data-testid="register-confirm"
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={busy}
                block
                size="large"
                data-testid="register-submit"
              >
                {t('register.submit')}
              </Button>
            </Form>
            <div style={{ marginTop: 16 }}>
              <Link to="/login">{t('register.back')}</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
