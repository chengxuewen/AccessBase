import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { mfaSetupWithToken, mfaEnableWithToken, type MfaEnrollSetup } from '../api/auth';
import { useAuthStore } from '../stores/auth';
import { landingPath } from '../utils/landing';

/**
 * Q3E-E3 enrollment wizard — reached when an enforced-MFA arm returns
 * {enroll:true, flowToken} (sessionStorage handoff). No session exists yet:
 * both steps ride the chained flow token; success installs the real session.
 * Cancel/expiry returns to /login (a dead token = sign in again — rev.2 F-B7).
 */
export default function EnrollMfa() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tokenRef = useRef<string | null>(sessionStorage.getItem('mfaEnrollToken'));
  const [phase, setPhase] = useState<'loading' | 'scan' | 'dead' | 'done'>('loading');
  const [setup, setSetup] = useState<MfaEnrollSetup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    const ft = tokenRef.current;
    if (!ft) {
      setPhase('dead');
      return;
    }
    mfaSetupWithToken(ft)
      .then((r) => {
        if (dead) return;
        setSetup(r);
        tokenRef.current = r.flowToken; // chained token from the wizard channel
        sessionStorage.setItem('mfaEnrollToken', r.flowToken);
        setPhase('scan');
      })
      .catch(() => {
        if (!dead) setPhase('dead');
      });
    return () => {
      dead = true;
    };
  }, []);

  const finish = (to: string) => {
    sessionStorage.removeItem('mfaEnrollToken');
    navigate(to, { replace: true });
  };

  const handleConfirm = async () => {
    const ft = tokenRef.current;
    if (!ft || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const pair = await mfaEnableWithToken(code.trim(), ft);
      if (!pair.accessToken || !pair.refreshToken) throw new Error('missing pair');
      useAuthStore.getState().setTokens(pair.accessToken, pair.refreshToken);
      await useAuthStore.getState().fetchUser();
      setPhase('done');
      const perms = useAuthStore.getState().user?.permissions ?? [];
      finish(landingPath(perms));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('enroll.failed'));
      // enrollment token burns on failed confirm only for wrong codes at the
      // server's verify step — a dead token routes back via the retry below
      setPhase('dead');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Card
        title={t('enroll.title')}
        style={{ width: '100%', maxWidth: 420 }}
        styles={{ header: { textAlign: 'center' } }}
      >
        {phase === 'loading' && <div data-testid="enroll-loading">{t('enroll.loading')}</div>}
        {phase === 'dead' && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type="error" showIcon message={t('enroll.dead')} data-testid="enroll-dead" />
            <Button block onClick={() => finish('/login')} data-testid="enroll-back">
              {t('enroll.back')}
            </Button>
          </Space>
        )}
        {phase === 'scan' && setup && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Typography.Paragraph type="secondary">{t('enroll.scan')}</Typography.Paragraph>
            <div style={{ textAlign: 'center' }} data-testid="enroll-qr">
              <img src={setup.qrDataUrl} alt="QR" style={{ width: 220, height: 220 }} />
            </div>
            <Typography.Paragraph copyable code style={{ fontSize: 12, wordBreak: 'break-all' }}>
              {setup.otpauthUrl}
            </Typography.Paragraph>
            <div style={{ fontSize: 12, color: '#888' }} data-testid="enroll-recovery">
              {t('enroll.recovery')}: {setup.recoveryCodes.slice(0, 3).join('  ')}
            </div>
            {error && <Alert type="error" showIcon message={error} data-testid="enroll-error" />}
            <Input
              size="large"
              maxLength={8}
              placeholder={t('enroll.codePlaceholder')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              data-testid="enroll-code"
              autoComplete="one-time-code"
            />
            <Button type="primary" size="large" block loading={busy} onClick={() => void handleConfirm()} data-testid="enroll-confirm">
              {t('enroll.confirm')}
            </Button>
            <Button type="text" block onClick={() => finish('/login')}>
              {t('enroll.cancel')}
            </Button>
          </Space>
        )}
      </Card>
    </div>
  );
}
