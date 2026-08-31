import { Button, Divider, Space } from 'antd';
import { GithubOutlined, GoogleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

interface OAuthButtonsProps {
  authorizeBase?: string;
}

/** Provider buttons → browser navigates to backend authorize endpoint. */
export function OAuthButtons({ authorizeBase = '/api/v1/auth/oauth' }: OAuthButtonsProps) {
  const { t } = useTranslation();

  const go = (provider: string) => {
    window.location.href = `${authorizeBase}/${provider}/authorize`;
  };

  return (
    <>
      <Divider plain data-testid="oauth-divider">
        {t('oauth.or')}
      </Divider>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button block size="large" icon={<GithubOutlined />} onClick={() => go('github')} data-testid="oauth-github">
          {t('oauth.github')}
        </Button>
        <Button block size="large" icon={<GoogleOutlined />} onClick={() => go('google')} data-testid="oauth-google">
          {t('oauth.google')}
        </Button>
      </Space>
    </>
  );
}
