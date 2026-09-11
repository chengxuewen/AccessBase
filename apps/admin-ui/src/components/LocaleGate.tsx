import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { resolveLang } from '../utils/locale';

const ANT_LOCALES = { en: undefined, zh: zhCN } as const;

export function LocaleGate({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = resolveLang(i18n.language);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  return (
    <ConfigProvider locale={ANT_LOCALES[lang]}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
