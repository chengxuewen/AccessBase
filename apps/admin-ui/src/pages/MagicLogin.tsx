import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBranding } from '../branding';
import { Card, Alert, Spin, Button, theme, ConfigProvider } from 'antd';
import { useAuthStore } from '../stores/auth';
import { landingPath } from '../utils/landing';

/**
 * /login/magic — consumes the token from a magic sign-in link email.
 * One-shot on mount (double-fire guard mirrors the oauthCode effect): the
 * consume endpoint burns the token on first hit, a second call would 401.
 */
export default function MagicLogin() {
  const { t } = useTranslation();
  const branding = useBranding();
  const brandTheme = branding.primaryColor
    ? { token: { colorPrimary: branding.primaryColor } }
    : undefined;
  const { token: themeToken } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) return;
    // Double-fire guard: consuming again after an MFA branch set the flow token
    // would burn the (already single-use) token and 401.
    if (useAuthStore.getState().mfaFlowToken) return;
    setSearchParams({}, { replace: true });

    useAuthStore
      .getState()
      .consumeMagicLink(token)
      .then(() => {
        const { mfaFlowToken } = useAuthStore.getState();
        if (mfaFlowToken) {
          // MFA step-up: shared TOTP form lives on /login
          navigate('/login', { replace: true });
          return;
        }
        // consumeMagicLink only sets the token — user must be fetched before routing
        return useAuthStore
          .getState()
          .fetchUser()
          .then(() => navigate(landingPath(useAuthStore.getState().user?.permissions), { replace: true }));
      })
      .catch((err: unknown) => {
        const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
        setError(code === 'AUTH_004' ? 'suspended' : 'invalid');
      });
  }, [searchParams, setSearchParams, navigate]);

  return (
    <ConfigProvider theme={brandTheme}>
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: themeToken.colorBgLayout,
      }}
    >
      {branding.logoUrl && (
        <img src={branding.logoUrl} alt="logo" data-testid="branding-logo"
             style={{ display: 'block', margin: '0 auto 16px', maxHeight: 56, maxWidth: '80%', objectFit: 'contain' }} />
      )}
      <Card title={t('login.magicTitle')} style={{ width: '100%', maxWidth: 400 }}>
        {error ? (
          <>
            <Alert
              type="error"
              showIcon
              message={error === 'suspended' ? t('login.accountSuspended') : t('login.magicInvalid')}
              style={{ marginBottom: 16 }}
              data-testid="magic-error"
            />
            <Link to="/login" replace>
              <Button block size="large">
                {t('login.magicBackToLogin')}
              </Button>
            </Link>
          </>
        ) : (
          <Spin data-testid="magic-busy" style={{ display: 'block', margin: '24px auto' }} />
        )}
      </Card>
    </div>
    </ConfigProvider>
  );
}
