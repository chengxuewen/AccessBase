import { useEffect, useState } from 'react';
import { Button, Divider, Space } from 'antd';
import { GithubOutlined, GoogleOutlined, KeyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { listOAuthProviders } from '../api/auth';

/** Backward-compat fallback when the providers endpoint is unreachable. */
const FALLBACK_PROVIDERS = ['github', 'google'];

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'github') return <GithubOutlined />;
  if (provider === 'google') return <GoogleOutlined />;
  return <KeyOutlined />;
}

interface OAuthButtonsProps {
  authorizeBase?: string;
}

/** Provider buttons → browser navigates to backend authorize endpoint. */
export function OAuthButtons({ authorizeBase = '/api/v1/auth/oauth' }: OAuthButtonsProps) {
  const { t } = useTranslation();
  // F1: seed with built-ins so loading shows buttons instead of an empty flash (R8: any
  // names the backend returns overwrite this list on success).
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS);

  useEffect(() => {
    let cancelled = false;
    listOAuthProviders()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setProviders(list);
      })
      .catch(() => {
        if (!cancelled) setProviders(FALLBACK_PROVIDERS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const go = (provider: string) => {
    window.location.href = `${authorizeBase}/${provider}/authorize`;
  };

  // F2: empty resolved list → no dangling "or" divider above nothing
  if (providers.length === 0) return null;
  return (
    <>
      <Divider plain data-testid="oauth-divider">
        {t('oauth.or')}
      </Divider>
      <Space direction="vertical" style={{ width: '100%' }}>
        {providers.map((provider) => (
          <Button
            key={provider}
            block
            size="large"
            icon={<ProviderIcon provider={provider} />}
            onClick={() => go(provider)}
            data-testid={`oauth-${provider}`}
          >
            {t(`oauth.${provider}`, { defaultValue: provider.toUpperCase() })}
          </Button>
        ))}
      </Space>
    </>
  );
}
