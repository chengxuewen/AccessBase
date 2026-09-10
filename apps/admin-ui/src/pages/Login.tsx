import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Form, Input, Button, Card, Alert, Spin } from 'antd';
import { MailOutlined, LockOutlined, KeyOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/auth';
import { OAuthButtons } from '../components/OAuthButtons';
import {
  getWebAuthnLoginOptions,
  verifyWebAuthnLogin,
} from '../api/auth';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { apiErrorMessage, apiErrorStatus } from '../api/errors';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, isLoading, exchangeOAuthCode, fetchUser, mfaFlowToken, verifyMfa, cancelMfa } =
    useAuthStore();
  const [form] = Form.useForm();
  const [mfaForm] = Form.useForm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [mfaError, setMfaError] = useState(false);

  useEffect(() => {
    const code = searchParams.get('oauthCode');
    const error = searchParams.get('oauthError');
    if (!code && !error) return;
    setSearchParams({}, { replace: true });
    if (error) {
      setOauthError(error);
      return;
    }
    if (code) {
      setOauthBusy(true);
      exchangeOAuthCode(code)
        .then(() => fetchUser())
        .then(() => navigate('/', { replace: true }))
        .catch(() => setOauthError('exchange_failed'))
        .finally(() => setOauthBusy(false));
    }
  }, [searchParams, setSearchParams, exchangeOAuthCode, fetchUser, navigate]);

  const handlePasskeyLogin = async () => {
    setPasskeyError(false);
    setPasskeyBusy(true);
    try {
      const { options, flowToken } = await getWebAuthnLoginOptions();
      const assertion = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      });
      const { accessToken, refreshToken } = await verifyWebAuthnLogin(flowToken, assertion);
      useAuthStore.getState().setTokens(accessToken, refreshToken);
      await useAuthStore.getState().fetchUser();
      navigate('/', { replace: true });
    } catch {
      setPasskeyError(true);
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleMfaSubmit = async (values: { code: string }) => {
    const ok = await verifyMfa(values.code);
    if (ok) {
      navigate('/', { replace: true });
    } else {
      setMfaError(true);
    }
  };

  const handleCancelMfa = () => {
    cancelMfa();
    setMfaError(false);
    mfaForm.resetFields();
  };

  const handleSubmit = async (values: { email: string; password: string }) => {
    try {
      const sessionEstablished = await login(values.email, values.password);
      setLoginError(null);
      if (sessionEstablished) {
        navigate('/');
      }
    } catch (err) {
      const status = apiErrorStatus(err);
      setLoginError(status === 429 ? t('login.tooManyRequests') : apiErrorMessage(err, t('login.error')));
    }
  };

  if (mfaFlowToken) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: '#f0f2f5',
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

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: '#f0f2f5',
      }}
    >
      <Card
        title={t('login.title')}
        style={{ width: '100%', maxWidth: 400 }}
        styles={{ header: { textAlign: 'center' } }}
      >
        {oauthBusy && <Spin data-testid="oauth-busy" style={{ display: 'block', marginBottom: 16 }} />}

        {oauthError && (
          <Alert
            type="error"
            showIcon
            message={t('oauth.failed', { reason: oauthError })}
            style={{ marginBottom: 16 }}
            data-testid="oauth-error"
          />
        )}

        {loginError && (
          <Alert
            type="error"
            showIcon
            message={loginError}
            style={{ marginBottom: 16 }}
            data-testid="login-error"
          />
        )}

        {passkeyError && (
          <Alert
            type="error"
            showIcon
            message={t('login.passkeyError')}
            style={{ marginBottom: 16 }}
            data-testid="passkey-error"
          />
        )}

        <Form form={form} onFinish={handleSubmit} layout="vertical">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: t('login.emailRequired') },
              { type: 'email', message: t('login.emailInvalid') },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder={t('login.emailPlaceholder')}
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login.passwordRequired') }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('login.passwordPlaceholder')}
              size="large"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isLoading} block size="large">
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>

        <Button
          block
          size="large"
          icon={<KeyOutlined />}
          loading={passkeyBusy}
          onClick={handlePasskeyLogin}
          style={{ marginBottom: 16 }}
          data-testid="passkey-login"
        >
          {t('login.passkey')}
        </Button>

        <OAuthButtons />
      </Card>
    </div>
  );
}
