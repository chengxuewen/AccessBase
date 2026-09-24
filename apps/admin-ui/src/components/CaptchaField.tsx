import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Space } from 'antd';
import { fetchCaptcha, fetchCaptchaStatus, type CaptchaChallenge } from '../api/auth';

/**
 * Q3E-E1 local captcha widget. Renders NOTHING while the feature is off
 * (status probe on mount) so the four mounted forms stay byte-identical in
 * default deployments. When on: SVG image (click to refresh) + answer input;
 * the parent passes `{...captcha.fields()}` into its POST body.
 */
export interface CaptchaHandle {
  captchaId?: string;
  captchaAnswer?: string;
}

export function useCaptchaField() {
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [answer, setAnswer] = useState('');
  const [on, setOn] = useState(false);
  const { t } = useTranslation();

  const refresh = useCallback(async () => {
    try {
      setChallenge(await fetchCaptcha());
    } catch {
      setChallenge(null);
    }
  }, []);

  useEffect(() => {
    let dead = false;
    void fetchCaptchaStatus().then((enabled) => {
      if (!dead) setOn(enabled);
    });
    return () => {
      dead = true;
    };
  }, []);

  // Q3E: fetch the first challenge once the feature is known-on
  useEffect(() => {
    if (on) void refresh();
  }, [on, refresh]);

  const fields = (): CaptchaHandle =>
    challenge ? { captchaId: challenge.id, captchaAnswer: answer } : {};

  const node = on ? (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} data-testid="captcha-field">
      {challenge ? (
        <span
          style={{ cursor: 'pointer', display: 'inline-block' }}
          // biome/mutation-safe: svg from OUR backend only (self-hosted challenge)
          dangerouslySetInnerHTML={{ __html: challenge.svg }}
          onClick={() => void refresh()}
          title={t('captcha.refresh')}
          data-testid="captcha-image"
        />
      ) : (
        <a onClick={() => void refresh()}>{t('captcha.load')}</a>
      )}
      <Input
        placeholder={t('captcha.placeholder')}
        maxLength={8}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        data-testid="captcha-answer"
        autoComplete="off"
      />
    </Space>
  ) : null;

  return { fields, node, reset: () => setAnswer('') };
}
