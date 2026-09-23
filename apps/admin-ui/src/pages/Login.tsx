import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Form, Input, Button, Card, Alert, Spin, theme } from 'antd';
import {
  MailOutlined,
  LockOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
  MobileOutlined,
} from '@ant-design/icons';
import { fetchSmsStatus, requestSmsOtp, verifySmsOtp } from '../api/auth';
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
  const { token: themeToken } = theme.useToken();
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
  // SMS OTP (Q1-f4): strict enabled gate mirroring SAML + two-step form state.
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsToken, setSmsToken] = useState('');
  const [smsMessage, setSmsMessage] = useState<string | null>(null);

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

  // SMS OTP: strict enabled gate mirroring the SAML probe (Q1-f4).
  useEffect(() => {
    let cancelled = false;
    fetchSmsStatus()
      .then((enabled) => {
        if (!cancelled) setSmsEnabled(enabled);
      })
      .catch(() => {
        // Unreachable backend → keep the trigger hidden (strict gate)
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
  // credentials; the resume hop to oidcRedirect runs once the approve call resolves.
  // Consent prompts are never auto-approved — hand off to /consent.
  useEffect(() => {
    const { token, isAuthenticated } = useAuthStore.getState();
    if (!(token || isAuthenticated) || !oidcRedirect) return;
    const uid = oidcRedirect.replace('/oidc/auth/', '');
    if (!uid) return;
    let cancelled = false;
    getInteraction(uid)
      .then((details) => {
        if (details.promptName === 'login') return postInteractionDecision(uid, 'approve').then(() => true);
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

  const handleSmsRequest = async (values: { phone: string }) => {
    setSmsBusy(true);
    setSmsMessage(null);
    try {
      const tok = await requestSmsOtp(values.phone);
      setSmsToken(tok);
    } catch (err) {
      setSmsMessage(apiErrorMessage(err, t('login.smsInvalid')));
    } finally {
      setSmsBusy(false);
    }
  };

  const handleSmsVerify = async (values: { code: string }) => {
    if (!smsToken) return;
    setSmsBusy(true);
    setSmsMessage(null);
    try {
      const result = await verifySmsOtp(smsToken, values.code);
      if (result.mfaRequired && result.flowToken) {
        // Step-up arm: setting mfaFlowToken makes this page render the TOTP
        // card above everything else (PIT-052 uniform shape across issuers).
        useAuthStore.setState({ mfaFlowToken: result.flowToken });
        setSmsToken('');
        setSmsOpen(false);
        return;
      }
      if (!result.accessToken || !result.refreshToken) {
        throw new Error('missing token pair');
      }
      useAuthStore.getState().setTokens(result.accessToken, result.refreshToken);
      await useAuthStore.getState().fetchUser();
      navigateAfterAuth();
    } catch (err) {
      setSmsMessage(apiErrorMessage(err, t('login.smsInvalid')));
      setSmsToken(''); // burned token — force a fresh request (magic R13 semantics)
    } finally {
      setSmsBusy(false);
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

        {smsEnabled && !smsOpen && !smsToken && (
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

        {smsEnabled && smsOpen && !smsToken && (
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
            <Form.Item
              name="code"
              rules={[{ required: true, message: t('login.smsCodeRequired') }]}
            >
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

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
          <Link to="/forgot-password" data-testid="forgot-link">
            {t('login.forgotPassword')}
          </Link>
          <Link to="/register" data-testid="register-link">
            {t('login.register')}
          </Link>
        </div>
      </Card>
    </div>
  );
}
