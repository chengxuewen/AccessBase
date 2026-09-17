import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Form, Input, Button, Card, Alert, Spin } from 'antd';
import { MailOutlined, LockOutlined, KeyOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/auth';
import { OAuthButtons } from '../components/OAuthButtons';
import {
  getWebAuthnLoginOptions,
  verifyWebAuthnLogin,
  fetchSamlStatus,
  requestMagicLink,
} from '../api/auth';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { apiErrorMessage, apiErrorStatus } from '../api/errors';
import { landingPath } from '../utils/landing';
import { getInteraction, postInteractionDecision, safeOidcRedirect } from '../api/oidc';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, isLoading, exchangeOAuthCode, exchangeSamlCode, fetchUser, mfaFlowToken, verifyMfa, cancelMfa } =
    useAuthStore();
  const [form] = Form.useForm();
  const [mfaForm] = Form.useForm();
  const [searchParams, setSearchParams] = useSearchParams();
  const oidcRedirect = safeOidcRedirect(searchParams.get('redirect'));

  const navigateAfterAuth = useCallback(() => {
    if (oidcRedirect) {
      const pendingFlow = useAuthStore.getState().mfaFlowToken;
      if (pendingFlow) sessionStorage.setItem('mfaFlowToken', pendingFlow);
      else sessionStorage.removeItem('mfaFlowToken');
      window.location.assign(oidcRedirect);
      return;
    }
    navigate(landingPath(useAuthStore.getState().user?.permissions), { replace: true });
  }, [oidcRedirect, navigate]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [mfaError, setMfaError] = useState(false);
  // SAML: strict enabled gate (addendum) — no fallback semantics like OAuthButtons
  const [samlEnabled, setSamlEnabled] = useState(false);
  const [samlError, setSamlError] = useState<string | null>(null);
  const [magicOpen, setMagicOpen] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicMessage, setMagicMessage] = useState<string | null>(null);

  // Restore MFA flow token from sessionStorage (set before oidcRedirect navigation).
  // Must run before the oauthCode effect to avoid stale re-exchange on mount.
  useEffect(() => {
    const stored = sessionStorage.getItem('mfaFlowToken');
    if (stored) {
      useAuthStore.setState({ mfaFlowToken: stored });
      sessionStorage.removeItem('mfaFlowToken');
    }
  }, []);

  useEffect(() => {
    const code = searchParams.get('oauthCode');
    const error = searchParams.get('oauthError');
    if (!code && !error) return;
    // OAuth MFA step-up: a pending mfaFlowToken means the TOTP form is showing —
    // do not re-exchange or navigate; verifyMfa handles the flow after code entry.
    if (code && useAuthStore.getState().mfaFlowToken) return;
    setSearchParams({}, { replace: true });
    if (error) {
      setOauthError(error);
      return;
    }
    if (code) {
      setAuthBusy(true);
      exchangeOAuthCode(code)
        .then(() => useAuthStore.getState().fetchUser())
        .then(() => navigateAfterAuth())
        .catch(() => setOauthError('exchange_failed'))
        .finally(() => setAuthBusy(false));
    }
  }, [searchParams, setSearchParams, exchangeOAuthCode, fetchUser, navigate, navigateAfterAuth]);

  // SAML: strict enabled gate — probe status on mount; no fallback semantics.
  useEffect(() => {
    let cancelled = false;
    fetchSamlStatus()
      .then((enabled) => {
        if (!cancelled) setSamlEnabled(enabled);
      })
      .catch(() => {
        // Unreachable backend → keep the button hidden (strict gate)
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // SAML flow: mirror the oauthCode effect — one-shot exchange, MFA step-up aware.
  useEffect(() => {
    const code = searchParams.get('samlCode');
    const error = searchParams.get('samlError');
    if (!code && !error) return;
    // SAML MFA step-up: TOTP form showing — do not re-exchange or navigate.
    if (code && useAuthStore.getState().mfaFlowToken) return;
    setSearchParams({}, { replace: true });
    if (error) {
      setSamlError(error);
      return;
    }
    if (code) {
      setAuthBusy(true);
      exchangeSamlCode(code)
        .then(() => useAuthStore.getState().fetchUser())
        .then(() => navigateAfterAuth())
        .catch(() => setSamlError('AUTH_SAML_002'))
        .finally(() => setAuthBusy(false));
    }
  }, [searchParams, setSearchParams, exchangeSamlCode, navigateAfterAuth]);

  // OIDC flow: already-authenticated user landing on /login?redirect=/oidc/auth/:uid
  // auto-approves the LOGIN prompt so the provider flow resumes without retyping
  // credentials. Consent prompts are never auto-approved — hand off to /consent.
  useEffect(() => {
    const { token, isAuthenticated } = useAuthStore.getState();
    if (!(token || isAuthenticated) || !oidcRedirect) return;
    const uid = oidcRedirect.replace('/oidc/auth/', '');
    if (!uid) return;
    let cancelled = false;
    getInteraction(uid)
      .then((details) => {
        if (details.promptName === 'login') return postInteractionDecision(uid, 'approve');
        // Consent (or unknown prompt) must never be auto-granted — render the consent page
        window.location.assign(`/consent?uid=${encodeURIComponent(uid)}`);
        return undefined;
      })
      .then((approved) => {
        if (approved !== undefined && !cancelled) window.location.assign(oidcRedirect);
      })
      .catch(() => {
        // Fall through to the normal login form; user can sign in again manually
      });
    return () => {
      cancelled = true;
    };
  }, [oidcRedirect]);

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
      navigateAfterAuth();
    } catch {
      setPasskeyError(true);
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleMfaSubmit = async (values: { code: string }) => {
    const ok = await verifyMfa(values.code);
    if (ok) {
      // verifyMfa only sets the token — user (and permissions) must be fetched before routing
      await fetchUser();
      navigateAfterAuth();
    } else {
      setMfaError(true);
    }
  };

  const handleCancelMfa = () => {
    cancelMfa();
    setMfaError(false);
    mfaForm.resetFields();
  };

  // Magic link request: the server answers 202 with a fixed enumeration-safe message —
  // show data.message verbatim regardless of account existence.
  const handleMagicRequest = async (values: { email: string }) => {
    setMagicBusy(true);
    setMagicMessage(null);
    try {
      const message = await requestMagicLink(values.email);
      setMagicMessage(message);
    } catch (err) {
      setMagicMessage(apiErrorMessage(err, t('login.magicError')));
    } finally {
      setMagicBusy(false);
    }
  };
  const handleSubmit = async (values: { email: string; password: string }) => {
    try {
      const sessionEstablished = await login(values.email, values.password);
      setLoginError(null);
      if (sessionEstablished) {
        // login() may return a user without permissions — refresh from /auth/me before routing
        await fetchUser();
        navigateAfterAuth();
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
        {authBusy && <Spin data-testid="auth-busy" style={{ display: 'block', marginBottom: 16 }} />}

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

        {samlError && (
          <Alert
            type="error"
            showIcon
            message={t('login.samlFailed', { reason: samlError })}
            style={{ marginBottom: 16 }}
            data-testid="saml-error"
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
              autoComplete="username"
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
              autoComplete="current-password"
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
        {samlEnabled && (
          <a href="/api/v1/auth/saml/login" style={{ display: 'block' }} data-testid="saml-login">
            <Button block size="large" icon={<SafetyCertificateOutlined />}>
              {t('login.samlButton')}
            </Button>
          </a>
        )}

        {!magicOpen && !magicMessage && (
          <Button
            block
            size="large"
            type="text"
            icon={<MailOutlined />}
            onClick={() => setMagicOpen(true)}
            style={{ marginTop: samlEnabled ? 16 : 0 }}
            data-testid="magic-trigger"
          >
            {t('login.magicTrigger')}
          </Button>
        )}

        {magicOpen && !magicMessage && (
          <Form onFinish={handleMagicRequest} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="email"
              rules={[
                { required: true, message: t('login.emailRequired') },
                { type: 'email', message: t('login.emailInvalid') },
              ]}
            >
              <Input
                prefix={<MailOutlined />}
                placeholder={t('login.magicEmailPlaceholder')}
                size="large"
                autoComplete="username"
                data-testid="magic-email-input"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={magicBusy}
              block
              size="large"
              data-testid="magic-submit"
            >
              {t('login.magicSubmit')}
            </Button>
          </Form>
        )}

        {magicMessage && (
          <Alert
            type="success"
            showIcon
            message={magicMessage}
            style={{ marginTop: 16 }}
            data-testid="magic-success"
          />
        )}
      </Card>
    </div>
  );
}
