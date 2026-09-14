import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import { useEffect } from 'react';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { resolveLang } from '../utils/locale';
import { useUiStore } from '../stores/ui';

const ANT_LOCALES = { en: undefined, zh: zhCN } as const;

/** auto resolves against the OS preference at render time — never persisted. */
function useResolvedTheme() {
  const theme = useUiStore((s) => s.theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return theme === 'auto' ? (prefersDark ? 'dark' : 'light') : theme;
}

export function LocaleGate({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = resolveLang(i18n.language);
  const resolved = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  return (
    <ConfigProvider
      locale={ANT_LOCALES[lang]}
      theme={{ algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}

