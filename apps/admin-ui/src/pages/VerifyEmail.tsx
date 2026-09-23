import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, Alert, Spin, theme } from 'antd';
import { verifyEmailToken } from '../api/auth';

/**
 * /verify-email?token= — one-shot consume of an email-verification link
 * (Q1-b2, closes design A4). Double-fire guard mirrors MagicLogin: the token
 * is single-use, a StrictMode re-run would burn it and 400 a valid link.
 */
export default function VerifyEmail() {
  const { t } = useTranslation();
  const { token: themeToken } = theme.useToken();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const consumed = useRef(false);
  const [state, setState] = useState<'busy' | 'ok' | 'fail'>(token ? 'busy' : 'fail');

  useEffect(() => {
    if (!token || consumed.current) return;
    consumed.current = true;
    verifyEmailToken(token)
      .then(() => setState('ok'))
      .catch(() => setState('fail'));
  }, [token]);

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
        title={t('verifyEmail.title')}
        style={{ width: '100%', maxWidth: 400 }}
        styles={{ header: { textAlign: 'center' } }}
      >
        {state === 'busy' && <Spin data-testid="verify-busy" />}
        {state === 'ok' && (
          <Alert
            type="success"
            showIcon
            message={t('verifyEmail.success')}
            data-testid="verify-success"
          />
        )}
        {state === 'fail' && (
          <Alert type="error" showIcon message={t('verifyEmail.fail')} data-testid="verify-fail" />
        )}
        <div style={{ marginTop: 16 }}>
          <Link to="/login">{t('verifyEmail.goLogin')}</Link>
        </div>
      </Card>
    </div>
  );
}
