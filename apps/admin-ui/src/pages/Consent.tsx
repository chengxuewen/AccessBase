import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Checkbox, Space, Spin } from 'antd';
import { useAuthStore } from '../stores/auth';
import { getInteraction, postInteractionDecision, safeOidcRedirect } from '../api/oidc';
import type { OidcInteraction } from '../api/oidc';
import { apiErrorMessage } from '../api/errors';
import EmptyState from '../components/EmptyState';

const SCOPE_I18N = ['openid', 'profile', 'email', 'offline_access'] as const;

export default function Consent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const uid = searchParams.get('uid');
  const [interaction, setInteraction] = useState<OidcInteraction | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate(`/login?redirect=${encodeURIComponent(`/oidc/auth/${uid ?? ''}`)}`, { replace: true });
      return;
    }
    if (!uid) {
      setLoadError(t('consent.error'));
      return;
    }
    let cancelled = false;
    getInteraction(uid)
      .then((data) => {
        if (!cancelled) setInteraction(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(apiErrorMessage(err, t('consent.error')));
      });
    return () => {
      cancelled = true;
    };
  }, [token, uid, navigate, t]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!uid) return;
    setSubmitting(true);
    setDecisionError(null);
    try {
      await postInteractionDecision(uid, decision);
      setDone(true);
      // Full page navigation so the provider's interaction cookies ride along
      window.location.assign(`/oidc/auth/${uid}`);
    } catch (err: unknown) {
      setDecisionError(apiErrorMessage(err, t('consent.error')));
    } finally {
      setSubmitting(false);
    }
  };

  const resume = safeOidcRedirect(window.location.pathname + window.location.search);

  if (loadError) {
    return (
      <CenteredCard title={t('consent.title')}>
        <Card data-testid="consent-error">
          <EmptyState variant="error" action={<Button onClick={() => window.location.reload()}>{t('common.retry')}</Button>} />
        </Card>
      </CenteredCard>
    );
  }

  if (!interaction) {
    return (
      <CenteredCard title={t('consent.title')}>
        <Spin data-testid="consent-loading" />
      </CenteredCard>
    );
  }

  return (
    <CenteredCard title={t('consent.title')}>
      <Space direction="vertical" size="middle" style={{ display: 'flex', width: '100%' }}>
        {decisionError && (
          <Alert type="error" showIcon message={decisionError} data-testid="consent-decision-error" />
        )}
        {done && (
          <Alert type="info" showIcon message={t('consent.redirecting')} data-testid="consent-redirecting" />
        )}
        <div data-testid="consent-client-name">
          {t('consent.clientName')}: <strong>{interaction.clientName}</strong>
        </div>
        <div>
          <div style={{ marginBottom: 8 }}>{t('consent.requestedScopes')}:</div>
          <Space direction="vertical" data-testid="consent-scopes">
            {interaction.requestedScopes.map((scope) => (
              <Checkbox key={scope} checked disabled>
                {SCOPE_I18N.includes(scope as (typeof SCOPE_I18N)[number])
                  ? t(`scope.${scope}`)
                  : scope}
              </Checkbox>
            ))}
          </Space>
        </div>
        {resume && promptNameIsLogin(interaction) && (
          <Alert type="info" showIcon message={t('login.oidcRedirect')} />
        )}
        <Space>
          <Button
            type="primary"
            loading={submitting}
            onClick={() => decide('approve')}
            data-testid="consent-approve"
          >
            {t('consent.approve')}
          </Button>
          <Button
            danger
            loading={submitting}
            onClick={() => decide('deny')}
            data-testid="consent-deny"
          >
            {t('consent.deny')}
          </Button>
        </Space>
      </Space>
    </CenteredCard>
  );
}

function promptNameIsLogin(interaction: OidcInteraction): boolean {
  return interaction.promptName === 'login';
}

function CenteredCard({ title, children }: { title: string; children: React.ReactNode }) {
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
      <Card title={title} style={{ width: '100%', maxWidth: 400 }} styles={{ header: { textAlign: 'center' } }}>
        {children}
      </Card>
    </div>
  );
}
